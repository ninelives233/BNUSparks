# BNU 资料库 · 木铎星火

## 项目架构

### 项目概述
BNU Sparks（木铎星火）是一个面向北京师范大学同学的课程资料共享平台。支持上传/下载资料、五级管理员审核、课程浏览、搜索、通知等功能。

### 技术栈
- **后端**：Django 6.x（以 requirements.txt 依赖声明为准，Python 3.12+）, SQLite (开发/生产), JWT 认证
- **前端**：纯 Vanilla JS SPA（无框架）, HTML5, CSS3 (OKLCH 色彩系统)
- **存储**：本地文件系统 `data/materials/`, MEDIA_ROOT = `BASE_DIR/'data'`
- **部署**：Supervisor + Nginx + uv（生产），详见 [[deployment-operations.md]]

### 目录结构（全量文件/行号速查 → [`project-map.md`](project-map.md)，2026-08-28 基线）
```
bnusparks/    # Django 项目配置（settings.py / settings_prod.py / urls.py）
materials/    # 核心应用：models.py(960行,27模型) / views/(37文件,10176行,v179 facade+子模块) / urls.py(117条路由) / tests/(32文件,411测试)
public/       # 前端 SPA：index.html(1162行) + js/(21文件,10656行) + css/(9文件,7265行,tokens最先/components最后)
data/         # 上传文件存储（MEDIA_ROOT = data/materials/）
```

### 数据模型（完整字段 → 记忆 [[project-map-models-api]]）

核心模型一览：
- **UserProfile** OneToOne→User：role / moderated_sections(M2M) / managed_majors(M2M) / 自动托管 / 每日限额计数 / can_moderate_qa
- **College** 学院 / **Course** 课程（college FK + course_type: GENERAL|MAJOR）
- **Material** 资料（核心）：course FK + title/teacher/material_type + file_path/file_name/file_size/file_type + uploader + is_approved/review_status(pending/approved/rejected) + is_pinned 置顶 + download_count
- **CourseCategory** 导航树节点（parent self-FK + is_divider + college + code_prefix/wildcard）
- **Notification** 通知（type: approved/rejected/disagree/report/file_deleted/NEW_PENDING/report_alert...）
- **DeletionRecord** 删除档案（trash_path 软删除暂存）/**ReviewComment** 审核异议 /**DownloadRecord** 下载记录 / **DownloadQuotaReservation** 每日不同资料配额占位
- v142+：**CourseCreationRequest** 课程申请 / **CourseFavorite** 课程收藏
- v172：**Report** 举报（双 kind + candidates M2M + 条件唯一约束）
- v174+：**问答区 10 模型**（QaTag/QaQuestion/QaAnswer/QaAnswerLike/QaFavorite/QaEditHistory/QaViewLog/QaAskClickDaily/QaConfig/QaDeleteRequest）

### API 路由（/api/ 前缀）

| 分组 | Endpoints |
|---|---|
| **认证** | register, verify-email, login, me, change-password, forgot-password, reset-password |
| **课程** | courses, courses/tree/, courses/{code}/files/ |
| **文件** | files/upload/, files/{id}/download/, files/{id}/delete/ |
| **通知** | auth/notifications/, auth/notifications/{id}/read/ |
| **用户** | auth/profile/, auth/avatar/, user/uploads/, user/downloads/ |
| **搜索/统计** | search/, stats/, colleges/ |
| **审核** | moderation/pending/, moderation/{id}/approve\|reject\|reassign/, batch-approve/, {id}/comments/, history/, deletions/, stats/ |
| **管理** | admin/users/, admin/users/{id}/role/, admin/sections/, admin/users/{id}/auto-approve/ |

> 上表是核心路由摘要，不是完整清单；当前完整路由以 `materials/urls.py` 的 117 个 `path()` 定义和 [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md) 的分类地图为准。

### 前端架构（public/js/ 21 个文件、10656 行，v=179 拆分）

模块加载顺序：utils → auth → profile → notifications → admin-core/pending/records/users → views → explorer-core/upload/mgmt/render/file/preview → newcourse → qa → qa-editor → qa-admin → qa-compose → app
入口文件 `app.js` 包含移动端抽屉、头部滚动阴影、popstate 监听器和启动初始化。**跨文件公共全局函数契约见记忆 [[js-global-inventory]]，改名/删除前必查**。

**视图系统**（SPA）：switchView → pushViewState（支持浏览器返回）
- home, explorer（课程浏览器, 核心视图）, profile, notif, admin, about, tutorial, rankings, recentAll, announcements, broad
- 刷新后从 sessionStorage('bnusparks_view') 恢复视图
- **必须**调用 pushViewState 才能支持返回 [[view-history-pushstate-pattern.md]]

**管理后台 Tab**：overview → pending → history → deletions → users → fileman

**认证流程**：学号 + @mail.bnu.edu.cn → JWT token
- token 双存: sessionStorage（当前标签页）+ localStorage（跨会话恢复）[[session-storage-over-localstorage.md]]

**每日下载限额**：15 次/天（v148 由 60 下调），仅普通用户生效（v152 非 USER 角色豁免），梯度提醒

**核心函数**：
- `api(url, opts)` — 统一 API 调用（自动 token + JSON/FormData 适配）
- `doDirectDownload(fileId)` — 原生下载（无内存缓冲）
- `lockScroll()/unlockScroll()` — 弹窗滚动锁
- `_pushModalHistory()/_popModalHistory()` — 弹窗历史栈

### 权限系统

| 角色 | 能力 |
|---|---|
| **user**（普通用户） | 上传、下载、搜索、个人中心 |
| **sub_moderator**（小版主） | 审核管辖学院资料，可 auto_approve |
| **moderator**（版主） | 审核主责板块，通识课/专业课 |
| **super_admin**（总管理员） | 全部权限 + 用户管理/角色分配/自动托管开关 |

## 设计规范

- **在修改任何 CSS/HTML/UI 之前**，必须先调用前端设计技能确定设计方向
- 优先调用顺序：`/frontend-design` (Anthropic) → `/web-design-engineer` (确定风格) → `/emil-design-eng` (精细化)
- 禁止产出 "AI 模板风"（浅蓝按钮、圆角卡片、灰色渐变等默认样式）
- 每次设计前先确定一个明确的审美锚点（编辑风、工业风、复古未来风、有机风等），锁定后再写代码
- 使用 OKLCH 色彩空间，维护 CSS 变量体系（--brand-hue 控制全局调性）
  - 主色: `oklch(0.40 0.09 250)`, 强调色: `oklch(0.52 0.13 45)`, 成功色: `oklch(0.48 0.12 150)`
  - 全套变量见 public/css/tokens.css `:root`（v179 起拆分为 9 个 CSS 文件）
- 动效使用 `/animation-vocabulary` 确定方案，用 `/review-animations` 审核实现

## 开发流程

1. 需求讨论 → 确定设计方案 → 调设计 skill → 写代码
2. 不要直接写 UI 代码而不经过设计阶段
3. 重要 UI 改动先出方案再动手

## 项目地图 — 开新对话前必读

**新对话的启动流程**（v180 起薄索引模式）：
1. 读根目录 [`project-map.md`](project-map.md) 薄索引 → 再读人类版 [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md)
2. **按任务只拉对应源码**：后端 → `materials/views/` 与 `materials/models.py`；模型/API → `materials/models.py`、`materials/urls.py`；前端 → `public/js/`、`public/css/`
3. 精确指向需要修改的文件和行号，避免全量重读代码

### 项目地图维护规则
**触发时机**：每次修改代码后 + 每次会话结束/`/compact` 前，必须：
1. 更新根目录 `project-map.md` 薄索引和 `docs/PROJECT_MAP.md` 中受影响的行数/入口
2. 增加/修改的文件如果 >= 50 行，同步更新 `docs/PROJECT_MAP.md` 的职责表
3. 新 API 端点加入 `docs/PROJECT_MAP.md` 的路由分类，并以 `materials/urls.py` 为唯一事实源
4. 如果拆分 views.py 或 app.js，更新 `docs/PROJECT_MAP.md` 的 facade/加载顺序表
5. 新增记忆文件 → 加入 `MEMORY.md` 索引；删除 → 移除索引

## 问题报告模板

**描述功能异常时请包含**：
- 环境：本地开发 | 生产服务器
- 操作路径：什么人做了什么事（如"普通用户登录→上传→审核"）
- 预期结果 vs 实际结果
- 浏览器 Console 是否有报错（F12 → Console）
- 后端日志末 20 行：`journalctl -u bnusparks --no-pager -n 20`

> 完整的排查流程和常见 Bug 对照见 [[docs/BUG_TROUBLESHOOTING.md]]

## 已知坑 & 模式固化

1. **rsync 部署**：`rsync -avz --delete public/` 会把 `public/js/app.js` 放到 `public/app.js`——部署后必须 `curl` 验证 [[deployment-gotchas.md]]
2. **同名校验**：同名课程用 code_prefix/code_wildcard 按学院分拆 [[split-mechanism.md]] | [[split-mechanism.md]]
3. **课程树**：后端 `/api/courses/tree/` 动态构建，前端 `loadCourseTree()` → `renderExplorer()`
4. **审核分配**：`_calculate_review_assignment()` 逻辑复杂，涉及 college + course_type 匹配 [[scope-assignment-bug-root-cause.md]]
5. **SQLite 并发（关键）**：凡涉及「读→改→写」（配额递增、下载计数）必须用 `F()` 表达式或 `select_for_update` 事务，否则并发丢失 [[sqlite-concurrency-pattern.md]]
6. **记忆文件需主动维护**：`project-map.md` 行号在每次改代码后会过时，会话结束时需更新；新增文件需加入 `MEMORY.md` 索引 [[memory-maintenance-policy.md]]
7. **Token 浪费根因 = 粒度不匹配**：`views.py` 和 `app.js` 已拆分为按功能分组的模块。改某个功能时只需加载 `views/utils.py` + 对应模块 (~800 行)，而非整文件 (8000 行) [[token-savings.md]]
8. **问题排查有最优顺序**：确认部署版本 → F12 Console → Network Tab → 后端日志，不跳步 [[docs/BUG_TROUBLESHOOTING.md]]
9. **测试账号需隐藏**：排行榜需排除 seed/手动创建的测试号，总管理员除外 [[test-accounts-hide-policy.md]]
10. **巨型文件拆分 SOP（v=179）**：后端用「原文件名薄 facade 重导出」保所有 import 路径（urls/管理命令/测试私有符号）；前端全局函数名=跨文件契约勿改；拆分后**必须跑全量测试**（目标冒烟可能漏路径，如 files_delete 缺 import）；deploy.sh 已改通配符 `public/js/*.js public/css/*.css` 根治新增文件遗漏 [[js-global-inventory]] [[session-token-split]]

## 常用命令

- `python manage.py runserver` — 开发服务器
- `python manage.py collectstatic --clear` — 收集静态文件
- `python manage.py shell` — Django shell
- `python seed.py` — 种子数据
- `python seed_tree.py` — 课程导航树种子
- `scripts/clean_stale_data.py` — 清理孤立数据
- `bash scripts/run_tests.sh` — **全量回归（~32s，v=184 优化）**：走 `bnusparks/settings_test.py`（MD5 密码哈希替代 PBKDF2，省掉每个 BnuTestCase setUp 的 ~2s 慢哈希；原 323s → 32s 十倍提速）。参数可传测试路径做单文件/单类回归。勿用 `--parallel`——SQLite 并行各 worker 重跑迁移，MD5 后无收益
