# BNU Sparks · 木铎星火项目地图

> 给人看的维护地图，不是 API 文档的替代品。需要精确路由或字段时，以代码为准。
>
> 基线日期：2026-09-09。行号来自当前工作树；修改代码后只更新本图中受影响的数字和入口。

## 1. 先看这张总图

```text
浏览器
  └─ public/index.html
       ├─ CSS：tokens → base → admin/user/files/course/announcement/qa → components
       └─ JS：utils → auth → profile → notifications → admin-* → views
                    → explorer-* → newcourse → qa* → app
                          │ fetch /api/
                          ▼
                    bnusparks/urls.py
                          ├─ /api/ → materials/urls.py → materials/views/
                          ├─ SPA fallback → public/index.html
                          └─ 媒体/受保护文件出口
                          ▼
                    SQLite + data/materials/
```

最常见的生命周期：

```text
注册/登录 → JWT → 浏览课程/搜索 → 上传资料 → 待审核
                                  ↓
                        版主按管辖范围审核
                         ↙                  ↘
                     驳回+通知             通过+可下载
                                             ↓
                      下载配额/记录 → 收藏/举报 → 删除/恢复
```

## 2. 当前仓库基线

| 区域 | 当前事实 | 维护提示 |
|---|---:|---|
| `materials/models.py` | 1040 行，28 个 Django 模型；另有 `CourseType` 枚举；Course 带 `merged_into` 同名合并字段（迁移 0035） | `class` 总数不要直接当模型数 |
| `materials/urls.py` | 153 行，119 个 `path()` 路由 | 新增 API 先改路由，再补测试和前端调用 |
| `materials/views/` | 38 个 Python 文件，11109 行 | facade 与子模块一起看，勿把薄 facade 当业务实现 |
| `materials/tests/` | 35 个 Python 文件，7600 行，463 个 `test_*` 方法 | 改权限/状态机/文件系统时同步补测试；同名合并用例见 test_course_merge.py |
| `materials/management/commands/` | 9 个可执行管理命令，另有 `__init__.py`（含 `merge_same_name_courses` 同名重复课程回填） | 清理或数据标注类命令运行前确认 dry-run/备份策略 |
| `public/index.html` | 1235 行 | 页面骨架、表单、弹窗、课程/学院/首页入口及侧边栏 SVG 符号表和核心/懒加载脚本入口都在这里 |
| `public/js/` | 23 个文件，13769 行 | 顶层函数是跨文件契约，改名前全局搜索；explorer/QA/admin/timetable 按视图懒加载 |
| `public/css/` | 10 个文件，7987 行 | `tokens.css` 先加载，公共控件在静态 `components/files/user.css`，页面专属样式再懒加载 |
| `data/` | SQLite、媒体文件、课程映射等运行数据 | 不提交、不用清理脚本替代备份 |

## 3. 入口、配置与部署

| 文件 | 负责什么 | 什么时候改 |
|---|---|---|
| `manage.py` | Django 管理命令入口 | 新增管理命令或改变启动配置 |
| `bnusparks/urls.py` | 根路由、`/api/` 前缀、SPA fallback、媒体入口 | 新增根级入口、静态策略或受保护文件出口 |
| `bnusparks/settings.py` | 开发基础配置、SQLite、邮件、缓存、媒体、CORS | 修改本地运行、存储、邮件或基础限制 |
| `bnusparks/settings_prod.py` | 生产 DEBUG、Host、安全头、X-Accel、Cookie | 发布前安全策略、反代行为变化 |
| `bnusparks/settings_test.py` | 测试数据库/密码哈希等测试配置 | 改测试隔离或测试速度 |
| `requirements.txt` | Python 依赖，当前声明 Django 6.x | 升级 Django、Pillow、pypdf 或 Gunicorn |
| `deploy.sh` | 严格校验 SSH host key；停服冻结 SQLite 后用 Python 标准库备份代码/数据库与 Nginx 配置，再同步、校验并重载 Nginx、迁移、验证；失败自动回滚 | 发布流程变化；首次使用先可信核对服务器指纹；不依赖服务器安装 sqlite3 CLI |
| `scripts/deploy_verify.sh` | 部署后在线检查 | 修改检查路径或线上验证行为 |
| `scripts/security-audit.sh` | 生产安全审计命令 | 修改检查项；禁止输出密钥/`.env` 内容 |
| `scripts/seed_new5.py` | 按既有课程树规范写入 `tmp_seed_pdfs/新建5` 的八个新增专业；同码课程全局复用，原文同码冲突保留目录名称 | 新增/修订培养方案或课程树导入规则 |
| `docs/GITHUB_REPO_AGENT_GUIDE.md` | 面向其他 Agent 的 GitHub 仓库创建、认证、提交推送、已有仓库接入和安全排错指南 | 需要让其他项目 Agent 创建 GitHub 仓库或上传项目文件时 |

## 4. 数据模型地图

主文件：[`materials/models.py`](../materials/models.py)。字段和约束变更后必须检查 migrations、序列化、权限和测试。

| 领域 | 模型 | 用途 |
|---|---|---|
| 用户 | `UserProfile` | 角色、管辖学院/专业、自动审核、下载计数、培养层次/学院/专业身份及公开开关、问答审核能力 |
| 课程 | `College`、`Course`、`CourseCategory`、`CourseType` | 学院、课程、导航树、通识/专业类型；`Course.college` 可为空 |
| 资料 | `Material`、`MaterialType` | 文件元数据、课程归属、审核状态、置顶、下载数；同时存在 `is_approved` 与 `review_status` |
| 文件操作 | `FolderOperation`、`DeletionRecord` | 管理模式下的移动/改名/批量操作、软删除暂存与恢复 |
| 审核 | `ReviewComment` | 驳回、异议和审核说明 |
| 通知/公告 | `Notification`、`Announcement` | 审核、删除、举报、公告等站内通知；Type 含 `merge_alert`（同名合并待复核） |
| 行为统计 | `DownloadRecord`、`DownloadQuotaReservation` | 访问流水区分正式下载/预览/旧记录，并以令牌行为编号幂等去重；资料删除后保留快照；按“用户+资料+日期”唯一占位，原子去重每日配额 |
| 收藏 | `Favorite`、`CourseFavorite` | 资料、课程收藏；唯一约束吸收并发重复创建 |
| 课程申请 | `CourseCreationRequest` | 新课程和随附资料申请、审批与迁移；同名同位不同码自动合并显示（免审核 + MERGE_ALERT 通报） |
| 举报 | `Report` | 材料、问答、用户举报及候选审核人；非总管理员的读取/处理/历史统一受 candidates 限制 |
| 问答 | `QaTag`、`QaQuestion`、`QaAnswer`、`QaAnswerLike`、`QaFavorite`、`QaEditHistory`、`QaViewLog`、`QaAskClickDaily`、`QaConfig`、`QaDeleteRequest` | 标签、问题、回答、点赞/收藏、编辑、浏览、日报、配置和删除申请；每题最多一个最佳回答由条件唯一约束保证 |

迁移目录：`materials/migrations/`。不要只改模型不补迁移；不要把物理文件移动误认为可由数据库事务回滚。

## 5. API 与后端模块

精确路由唯一事实源：[`materials/urls.py`](../materials/urls.py)。下表是按维护任务归类的导航，不重复列出 117 条路径。

| API/业务域 | 主要实现文件 | 什么时候改 |
|---|---|---|
| 注册、重发验证邮件、登录、邮箱验证、改密、找回/重置 | `views/auth.py`、`views/utils_auth.py` | 认证、JWT、密码、邮件和 IP/账号限流策略变化 |
| 课程列表、课程树、课表摘要、课程文件、搜索、统计、学院 | `views/courses.py`、`utils_course_tree.py` | 课程查询、树结构、课表按代码批量聚合已审核资料数、缓存、ETag 变化；同名合并的 `courseCodes` 为**位置级标注**：仅别名叶子与主叶子同层共现的目录显示双代码（别名叶子同层隐藏），别名叶子单独出现时单码展示自己、资料仍跟随主课程 |
| 文件上传、文字录入 | `views/files_upload.py`、`utils_upload.py`、`utils_security.py` | 服务端硬限额、临时写入、失败清理、类型、文件名、EXIF 变化 |
| 文件下载、预览、下载令牌、X-Accel | `views/files_download.py`、`utils_auth.py`、`utils_quota.py` | 正式下载/预览分类、同 IP 跨浏览器移交令牌、幂等留痕、响应头、权限、配额和 X-Accel/FileResponse 共用的路径边界变化 |
| 单删、批删、软删除、恢复 | `views/files_delete.py`、`utils_trash.py`、`operations_records.py` | 文件生命周期和恢复策略变化 |
| 文件详情、更新、置顶、批量编辑 | `views/operations_manage.py`、`operations_batch.py` | 管理模式、元数据或批量操作变化 |
| 文件夹创建、删除、移动、操作记录 | `views/operations_folder.py`、`operations_records.py` | 课程目录和文件操作日志变化 |
| 待审、通过、驳回、重分配、历史、统计 | `views/moderation.py`、`utils_moderation.py` | 审核范围、并发幂等、自动审核变化 |
| 新课程申请及随附资料迁移 | `views/course_requests.py` | 课程创建、审批、物理文件迁移变化；提交端同名同位不同码自动合并（`_find_same_name_sibling`/`_notify_course_merged`），查重经 `_find_existing_course` 别名跟随 |
| 个人资料、公开主页、排行、上传/下载历史 | `views/profile.py` | 用户公开信息和统计变化；公开主页实时聚合已审核未删除资料的上传/下载/收藏数据 |
| 我的课表跨设备同步（GET/PUT/DELETE `/api/user/timetable/`，GET 支持 `since` 增量检查，`@csrf_exempt`+JWT，200KB 上限） | `views/user_timetable.py`、模型 `UserTimetable`（迁移 0034）、测试 `test_user_timetable.py`（含条件拉取、乱序覆盖和 `enforce_csrf_checks` 回归护栏） | 同步格式/上限/版本冲突变化；**新建写接口必须带 `@csrf_exempt`（JWT 无 cookie），漏掉会被 CSRF 中间件 403 且本地测试发现不了** |
| 收藏 | `views/favorites.py`、`qa_public.py` | 资料/课程/问答收藏、分页、计数及唯一键并发冲突变化；资料收藏会使上传者公开页统计缓存失效 |
| 公告 | `views/announcements.py` | 管理员发布、纯文本约束、公告列表变化 |
| 通知 | `views/notifications.py` | 未读、已读、删除、跳转数据变化 |
| 举报 | `views/reports.py` | 举报对象、候选版主、对象级 candidates 权限、处理和历史作用域变化 |
| 问答 | `views/qa.py` facade、`qa_public.py`、`qa_user.py`、`qa_admin.py`、`qa_tasks.py`、`qa_helpers.py` | 问题/回答、净化、置顶锁、最佳回答唯一约束、删除申请冲突和任务变化 |
| 管理员用户/板块/自动审核 | `views/admin.py` | 角色、管辖范围、管理员设置变化 |
| 总管理员用户监测/访问追溯 | `views/admin_monitoring.py`；`/api/admin/monitoring/`、`/api/admin/users/<uid>/downloads/` | 正式下载趋势、预览统计、用户注册数量趋势、三项身份分布、全站访问流水筛选、运行状态、单用户访问记录变化 |

### 后端 facade 关系

```text
views/__init__.py  ← 旧 import / 路由兼容出口，并导出 admin_monitoring API
views/files.py     → files_upload / files_download / files_delete / files_zip
views/operations.py→ operations_helpers / folder / records / batch / manage
views/qa.py        → qa_helpers / qa_public / qa_user / qa_admin / qa_tasks
views/utils.py     → utils_auth / security / quota / trash / course_tree / moderation
```

facade 变更规则：保留旧导入路径；新增业务放子模块；拆分后跑全量测试并检查管理命令、URL 和测试中的私有 import。

## 6. 权限与关键调用链

### 角色

| 角色/能力 | 作用 |
|---|---|
| `user` | 上传、下载、搜索、个人中心 |
| `sub_moderator` | 指定学院/专业范围审核，可自动审核 |
| `moderator` | 主责板块审核，通常含通识/专业范围 |
| `super_admin` | 全局审核、用户/板块/自动审核管理、用户监测与下载追溯 |
| `can_moderate_qa` | 问答管理能力，不能只用课程审核角色替代 |
| 未登录 guest | 浏览公开内容；不等于数据库角色 |

### 关键链路

1. 课程树：`api_course_tree()` → 缓存 → `CourseCategory` 分组 → 课程/已审核资料聚合 → `_build_tree_node()` → ETag JSON；课表资料标签：`api_course_timetable_summary()` → 按课表代码批量 `Count` → 小响应，完整树在点击课程/编辑/导入时按需加载。
2. 上传：登录用户 → 元数据/硬大小校验 → 同目录临时文件原子落盘 → `Material` 入库（失败删文件）→ `pending` 或自动通过 → best-effort 通知。
3. 审核：待审查询 → `_get_moderated_material_qs()` → 单条或批量更新 → 上传者通知。
4. 新课程：申请查重/范围校验 → 审批 → 事务内解析课程并迁移随附 `Material`；失败时逆向恢复物理文件。
5. 下载：Bearer/JWT 或短时令牌（已审核资料可同 IP 跨浏览器移交，待审核资料仍绑 session）→ 可见性/权限 → `DownloadQuotaReservation` 唯一占位 → `DownloadRecord` 按行为编号幂等留痕；仅正式下载增加资料下载量，预览独立统计；删除资料后快照仍可追溯。
6. 删除：对象权限 → 物理文件移入 trash → `DeletionRecord`/数据库变更；数据库失败时文件移回原位 → 管理员恢复或清理。
7. 前端导航：`switchView()` → `pushViewState()` → URL/sessionStorage 恢复；弹窗历史同时管理焦点陷阱、Esc 和焦点归还。
8. 举报受理：角色门槛 → `_report_accessible_qs()`（非总管理员必须在 `candidates`）→ 对象读取/聚合处理/历史；升级后的用户举报仅总管理员可见并收尾。
9. 问答并发：收藏/点赞由唯一约束吸收重复创建；置顶通过 `QaConfig` 单例写锁串行化“计数→写入”；最佳回答由事务加条件唯一约束保证每题最多一条。

## 7. 前端地图

入口：[`public/index.html`](../public/index.html)。核心脚本使用 `defer`，非核心模块由 `feature-loader.js` 按视图顺序加载；入口区在 `public/index.html:1220-1232`：

```text
utils → auth → profile → notifications → admin-core → views → explorer-core
→ explorer-file → explorer-preview → feature-loader → app

按需模块：
  explorer → explorer-upload → explorer-mgmt → explorer-render → newcourse
  qa → qa → qa-editor → qa-compose
  admin → qa → qa-editor → qa-compose → admin-pending → admin-records → admin-users → qa-admin
  timetable → timetable
```

| 文件/组 | 负责什么 | 什么时候改 |
|---|---|---|
| `public/js/utils.js` | `api`、token 清理、HTML/JS 转义、文件徽章/分页、文件删除、路由解析、下载、弹窗滚动/焦点、跨模块浮层清理 | 公共 API、令牌、路由、文件公共工具、dialog 或跨页工具变化 |
| `public/js/auth.js` | 注册、登录、验证、未验证账号重发入口、改密、找回、token 持久化 | 认证前端变化 |
| `public/js/views.js` | 普通视图、公告、排行、搜索、公开用户页及管理模式下载追溯、`pushViewState`；我的课表入口统一处理认证等待、路由激活和懒加载失败 | 页面导航和公共视图变化 |
| `public/js/profile.js` | 个人中心、公开资料、上传/下载/收藏页 | 用户模块变化 |
| `public/js/notifications.js` | 通知抽屉、通知中心、管理/平民模式 | 通知和用户菜单变化 |
| `public/js/admin-*.js` | 管理概览、待审、记录、用户；`admin-users.js` 含活动趋势/用户数量趋势/三项身份/访问流水筛选/运行状态/用户名单 | 后台 tab、用户监测和管理动作变化 |
| `public/js/explorer-*.js` | 课程树、课程/学院卡片 SVG 名称映射、上传、文件列表、管理、预览；explorer-core 提供 `navToCourse(type, code)` 统一跳转入口（先确保懒加载模块与课程树就绪再定位，勿手写 `showExplorer+navToLast` 成对调用）；同名合并叶子 `courseCodes` 双代码展示与路径匹配；移动端 PDF 预览不创建 iframe，改为显式下载兜底 | 课程浏览、卡片图标与文件操作变化；新增课程跳转入口一律走 navToCourse |
| `public/js/feature-loader.js` | 按视图串行加载 explorer/QA/admin/timetable 脚本和对应 CSS，并复用脚本/CSS 加载 Promise；失败资源可重试 | 首屏资源、模块依赖顺序、错误恢复或懒加载入口变化 |
| `public/js/newcourse.js` | 新课程申请和附带资料 | 新课申请变化 |
| `public/js/qa*.js` | 问答列表、编辑器、管理、提问、浏览器侧 HTML 白名单 | 问答与富文本变化 |
| `public/js/timetable.js` | 我的课表（管理员专属入口，侧边栏最底部，2350 行）：解析教务导出「学生选课课程表」（支持 GBK HTML 伪装 `.xls` 的课程明细表和按星期网格布局，纯前端 `ttParseImport`），周次/单双周/节次过滤渲染周网格（`ttState`+localStorage `bnusparks_timetable_v1_u<uid>` 按账号分储）；4 套配色方案 × 资料丰度冷暖对比三档；进入课表先调用 `/api/courses/timetable-summary/` 按代码显示资料数量，点击课程/编辑/导入时再加载完整课程树；按课程代码链接课程树（`ttFindPathByCode`：精确/区段代码/形势与政策特例，身份入口优先，点击直达课程目录，树未就绪时 `ttEnsureCourseTree` 自愈、懒加载竞态与失败重试）；跨设备同步 `ttSyncPull`/`ttSyncUpload`（本地保存后立即串行上传，5 秒条件轮询，切回页面/聚焦立即检查，GET `since` 未变化时不传课表数据，服务端拒绝旧版本覆盖）；接口 `/api/user/timetable/` 按 `importedAt` 取较新；未建课确认时选位置自动 POST `/api/courses/request/` 记入 `pendingCodes`，批准前不可跳转；「切换视图」`ttToggleView` 周网格 ⇄ 课程列表（`ttRenderList`+`ttStatusTag`，偏好 `bnusparks_timetable_view_u<uid>`）；「编辑模式」`ttToggleEdit`（工具栏第 3 按钮）：`ttOpenCourseEditor` 课程编辑弹窗（名称/教师/代码/8 色相覆盖/多时间段增删复制/仅本周）、`ttStripCurrentWeek` 从本周移除拆段、空位点击新建课程（手动建课+选位置提申请）、`ttEnsureIds` 存量补 id、删除两步确认，保存即 bump importedAt 走云同步；移动端网格满屏（`tt-w5` 无周末课自动收列，cqh 字体缩放）；`ttMergeMeetings` 时段合并（多教室同段合一、碎片周次并段、连堂并块，`ttLoadStore`/云端拉取时对存量数据归一化）；专业课建课层级选择器 `ttOpenLevelPicker`（真实课程树只到「直接含课程的文件夹」，选择暂存 `ttLocPicks`，导入确认与编辑器共用）；从汉堡菜单/刷新进入时等待认证并先激活课表路由，课程点击在目录树未就绪时自动补载后再跳转；列表视图渲染后使用列表节点事件委托，避免课程行无响应 | 教务导出格式变化（改 `ttParseMeetings`/`ttParseMeeting`）、课表 UI/配色/同步/编辑/视图切换/课程链接跳转变化 |
| `public/js/app.js` | 启动、移动抽屉、滚动阴影、`popstate`、刷新恢复 | 启动顺序、浏览器返回、深链变化 |
| `public/css/tokens.css` | OKLCH 色彩（青靛墨蓝/琥珀）、首页上传入口专用色、字体、间距、动效变量 | 设计系统变化 |
| `public/css/base.css` | 全局布局、表单、弹窗、首页搜索上传入口、首页入口/课程卡片图标底框、侧边栏图标和移动基础 | 基础 UI 或首页入口/卡片/侧栏图标变化 |
| `public/css/admin.css` | 审核/管理后台 | 管理 UI 变化 |
| `public/css/user.css` | 个人中心、用户页、通知抽屉及我的上传操作 | 用户 UI 变化 |
| `public/css/files.css` | 文件列表、详情、预览、举报、上传下载和管理模式文件控件 | 文件 UI 变化 |
| `public/css/course.css` | 课程树、课程页面及新建课程控件 | 课程浏览或新建课程 UI 变化 |
| `public/css/announcement.css` | 公告 UI | 公告页面变化 |
| `public/css/qa.css` | 问答与编辑器 UI | 问答 UI 变化 |
| `public/css/timetable.css` | 我的课表（「纸墨 × 中国色」卡片、4 套配色 `.tt-sch-*` + 资料丰度 `.tt-rich-*` 色阶、周网格与导入/教程弹窗、列表视图 `.tt-list/.tt-lrow/.tt-tag` 的独立卡片与桌面双栏排课信息、桌面卡片垂直留白/多行课程名/稳定可读字号与目录失败重试签、编辑模式 `.tt-editing`（空位 `＋`/表单 `.tt-fld`/时间段 `.tt-seg`/色板 `.tt-swatch`/危险按钮 `.danger.armed`）、移动端标题/操作/分段/周次工具栏重排与满屏 `:not(.tt-mode-list)` flex 链 `#ttBody→.tt-scroll` + 容器查询 cqh 字体；窄屏隐藏大标题、恢复桌面端分段控件并让工具条/标签/周次栏/网格共享 12px 左右边距，列表卡片收紧且网格课程卡缩小；按当前周自适应 5/7 日列，移动端显式清零 `min-width` 并用 `minmax(0, 1fr)` 防止窄屏裁切；所有移动端宽度统一 `.pc-seg` 桌面分段样式；层级选择器 `.tt-lp-*` 与位置控件 `.tt-loc-lv/.tt-loc-path`） | 课表 UI、配色方案、编辑器或移动端适配变化 |
| `public/css/components.css` | 跨页面按钮、弹窗基座、分段控件、开关、空态/加载态及全站文字输入焦点状态 | 共享组件或输入焦点反馈变化 |

跨文件契约：顶层函数和全局变量被大量内联 `onclick` 与其他模块调用；改名/删除前必须 `rg` 全仓库。SPA 深链当前覆盖静态页、explorer、用户、文件、问答编辑，但问答编辑参数需要重点回归。

### 独立设计审查与样稿（2026-09-06）

以下文件不属于生产 CSS/JS 加载链；仅用于设计评审。原有图标优化可独立继续。

| 文件 | 当前行数 | 职责 |
|---|---:|---|
| `docs/design-review-2026-09-06/REVIEW.md` | 205 | 全站视觉/动效/交互审查、源码定位、三个方向取舍与迁移验收 |
| `docs/design-review-2026-09-06/brand-spec.md` | 28 | 识别元素、三套 OKLCH token、字体/布局/动效约定 |
| `docs/design-review-2026-09-06/01-library.html` | 94 | 静读资料馆：搜索优先、学术排版、四个代表页面与弹窗 |
| `docs/design-review-2026-09-06/02-workbench.html` | 118 | 课程工作台：持久目录、资料列表、桌面并排预览与手机弹窗 |
| `docs/design-review-2026-09-06/03-circulation.html` | 97 | 校园传阅：品牌/搜索并排、课程书架与代表页面 |

同目录三个 `*-desktop.jpg` 为浏览器渲染截图。HTML 可直接本地打开，无外部依赖或 API 请求。

### 个性化学习空间样板（2026-09-07）

| 文件 | 当前行数 | 职责 |
|---|---:|---|
| `docs/personal-home-prototype/index.html` | 68 | 独立静态个性化首页、课程管理、示例课表核对、搜索收藏、移动导航；不接入生产资源 |
| `docs/personal-home-prototype/v2.html` | 80 | 第二版：无右侧身份及继续查看，资料更新首页、课程列表与固定管理、统一添加入口 |
| `docs/personal-home-prototype/v3.html` | 94 | 第三版：中性白灰/墨蓝学习空间，日期分组首页、精简课程列表与示例导入交互 |
| `docs/personal-home-prototype/v4.html` | 279 | 第四版：按已实现课表能力重做周网格/列表、多时段编辑、教务格式解析与整表替换；独立内存样稿，不接生产接口 |
| `docs/personal-home-prototype/v5.html` | 310 | 第五版：内嵌只读课程树快照，首页目录入口及已审资料快照、全部课程分层浏览与路径搜索；独立静态稿 |
| `docs/personal-home-prototype/v6.html` | 328 行 | 专注目录静态稿：取消第二侧栏、逐层返回、按需路径、分类选择器及移动端单列 |
| `docs/personal-home-prototype/v7.html` | 341 行 | 首页静态稿：公告、真实本地规模、示例课程更新、按身份显示招生说明与可收起教程 |
| `docs/personal-home-prototype/v8.html` | 352 行 | 用户三行首页方案：公告快捷入口、横向个性化推荐、下载/收藏切换榜与最近上传 |
| `docs/personal-home-prototype/brand-spec.md` | 110 | 设计规则、体验路径、示例范围与验证记录 |

## 8. 测试与运维定位

| 目标 | 入口/文件 | 说明 |
|---|---|---|
| 全量回归 | `bash scripts/run_tests.sh` | 使用 `bnusparks/settings_test.py`；改安全/状态机后必须跑 |
| 认证/权限 | `test_auth_registration.py`、`test_permissions.py`、`test_hardening_v167.py`、`test_audit_fixes.py` | 停用用户、限流、CSRF/Bearer 边界 |
| 文件生命周期 | `test_upload_text.py`、`test_delete_restore.py`、`test_xaccel_download.py`、`test_zip_structure.py`、`test_audit_fixes.py` | 大小上限、失败清理、磁盘补偿、fallback containment |
| 审核/课程 | `test_review_*.py`、`test_course_*.py`、`test_auto_approve.py` | 追加批量审核保护、迁移失败、同名合并 |
| 问答/举报 | `test_qa.py`、`test_reports.py`、`test_audit_fixes.py` | 净化器、候选人越权（含目标删除后）、历史作用域、删除申请与最佳回答并发一致性 |
| 用户监测/追溯 | `test_admin_monitoring.py` | 总管理员权限、活动/用户数量趋势桶、三项身份聚合、预览/下载筛选、资料删除后留痕和运行状态 |
| 管理命令 | `materials/management/commands/` | 数据标注/清理任务必须先 dry-run；`handle_bounced_registration` 默认预览且仅允许确认删除未激活退信账号 |
| 部署 | `deploy.sh`、`deploy.sh.template`、`scripts/deploy_verify.sh` | 发布前必须有备份、失败即停、回滚和固定 host key |

## 9. 维护者最先检查的风险入口

这不是漏洞清单，而是改动时的风险导航：

- 富文本：`materials/views/qa_helpers.py` → `public/js/qa.js`/`qa-editor.js`。必须保证文本、属性和 URL 协议的安全序列化。
- 身份失效：`materials/views/utils_auth.py`。停用用户、token_version、下载令牌要用同一套有效性规则。
- 文件写入：`files_upload.py`、`utils_upload.py`、`course_requests.py`、`operations_manage.py`、`utils_trash.py`。数据库事务不能自动回滚文件系统移动，新增路径必须沿用补偿模式。
- 管辖权限：`utils_moderation.py`、`moderation.py`、`reports.py`。举报入口统一复用 `_report_accessible_qs()`；新增入口不得只检查角色。
- 并发状态：`utils_quota.py`、`favorites.py`、`qa_public.py`、`qa_admin.py`、`qa_user.py`。唯一约束、条件更新或锁才是最终保证，前置查询只用于友好提示。
- 前端模板：所有 `innerHTML`、内联事件和用户内容必须明确区分纯文本与已净化 HTML。

最后更新时间：2026-09-09。若目录、路由、模型或模块拆分改变，先更新本文件和根目录 `project-map.md`，再更新 AGENTS/README 中的摘要数字。
