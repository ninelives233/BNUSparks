---
status: current
audience: collaborator
purpose: current architecture and risk map
---

# BNU Sparks 架构地图

本文件记录当前稳定结构和跨模块关系。它不记录发布历史、行数、缓存版本、commit、
部署快照或临时工作区状态。路径和行为若与源码冲突，以源码、迁移和测试为准。

## 1. 总体结构

```text
Browser
  └─ public/index.html + public/js/*.js + public/css/*.css
       └─ /api/*
            └─ bnusparks/urls.py
                 └─ materials/urls.py
                      └─ materials/views/*
                           ├─ materials/models.py
                           ├─ SQLite
                           ├─ data/materials/  用户上传
                           └─ data/trash/      删除暂存
```

- Django 提供 API、认证、管理后台接口和静态入口。
- 前端是无框架 SPA；基础模块静态加载，较大功能按视图懒加载。
- 生产由 Nginx 终止 HTTPS、提供静态文件，并通过 internal 路径发送受保护文件。
- 各校区使用同一代码版本，但环境、数据库、上传文件、域名和密钥独立。

## 2. 配置与入口

| 路径 | 职责 |
|---|---|
| [`../manage.py`](../manage.py) | Django 命令入口 |
| [`../bnusparks/settings.py`](../bnusparks/settings.py) | 通用配置、开发数据库、缓存、上传和邮件基线 |
| [`../bnusparks/settings_test.py`](../bnusparks/settings_test.py) | 测试加速配置 |
| [`../bnusparks/settings_prod.py`](../bnusparks/settings_prod.py) | 无密钥生产配置模板 |
| [`../bnusparks/urls.py`](../bnusparks/urls.py) | 顶层 URL 和 SPA fallback |
| [`../materials/urls.py`](../materials/urls.py) | API 路由唯一事实源 |
| [`../public/index.html`](../public/index.html) | SPA 骨架和基础资源入口 |
| [`OPERATIONS.md`](OPERATIONS.md) | 部署、备份、恢复事实源 |

## 3. 数据域

模型定义以 [`../materials/models.py`](../materials/models.py) 为准，迁移以
`materials/migrations/` 为准。

| 数据域 | 主要对象 | 关键风险 |
|---|---|---|
| 用户与权限 | UserProfile、角色、管理范围 | 停用账号、token 失效、作用域越权 |
| 课程目录 | College、Major、Course、CourseCategory | 同名课程、别名合并、层级与学院归属 |
| 资料 | Material、收藏、下载记录、删除记录 | 路径穿越、配额、数据库与文件系统一致性 |
| 审核与举报 | ReviewComment、Report、课程申请 | 管辖范围、并发状态、通知幂等 |
| 问答 | Question、Answer、点赞、收藏、编辑历史、删除申请 | 富文本净化、可见范围、计数一致性 |
| 课表 | UserTimetable | revision 冲突、旧客户端写入、跨设备覆盖 |
| 监测 | MonitoringEvent、MonitoringAggregate | 隐私、幂等、保留期和查询成本 |
| 内容运营 | Announcement、CampusLink、Notification | 管理权限、排序和缓存失效 |

## 4. 后端模块

`materials/views/__init__.py` 作为兼容 facade 重导出视图符号。新增实现优先放入职责明确的
子模块，不要重新堆回 facade。

| 模块族 | 职责 |
|---|---|
| `auth.py`、`utils_auth.py` | 注册、登录、验证、JWT、账号有效性、下载令牌 |
| `profile.py`、`majors.py` | 个人资料、身份选项、专业目录 |
| `courses.py`、`utils_course_tree.py` | 课程树、课程资料、别名解析和缓存 |
| `course_requests.py` | 新课程申请、状态和合并 |
| `recommendations.py` | 首页及独立页的个性化推荐 |
| `files_upload.py`、`utils_upload.py` | 上传校验、落盘和失败补偿 |
| `files_download.py`、`utils_quota.py` | 浏览/下载、令牌、配额、X-Accel |
| `files_delete.py`、`utils_trash.py` | 软删除、恢复和物理清理 |
| `operations_*.py` | 管理员目录、批量操作和记录查询 |
| `utils_moderation.py`、`moderation.py` | 审核作用域、分配、批准与驳回 |
| `reports.py` | 资料和问答举报、候选处理人和限额 |
| `qa_*.py` | 问答公开接口、用户操作、管理操作和任务 |
| `user_timetable.py` | 课表同步、revision 仲裁和权限 |
| `admin_monitoring.py`、`monitoring_events.py` | 健康状态、活动聚合和隐私化事件 |

## 5. 前端结构

基础链路由 `public/index.html` 声明，启动和路由集中在：

- `utils.js`：API、缓存、转义、弹窗和共用工具；
- `auth.js`：认证状态和账号入口；
- `views.js`：视图切换、静态页面和 history state；
- `feature-loader.js`：按功能加载 JS/CSS；
- `app.js`：启动、全局事件、移动导航和返回处理。

按功能模块：

| 模块 | 主要文件 |
|---|---|
| 首页与推荐 | `home.js`、`appearance.js`、`base.css` |
| 课程与资料 | `explorer-*.js`、`course.css`、`files.css` |
| 个人中心 | `profile.js`、`user.css` |
| 后台管理 | `admin-*.js`、`admin.css` |
| 问答 | `qa*.js`、`qa.css` |
| 我的课程 | `timetable.js`、`timetable.css` |
| 公告 | `announcement.css` 和对应视图逻辑 |
| 设计令牌与组件 | `tokens.css`、`components.css` |

前端没有模块打包器，跨文件公共函数是运行时契约。修改函数名、加载顺序、全局状态或缓存
策略时，必须同时检查 HTML 入口、懒加载器、内联事件和所有调用方。

## 6. 关键调用链

### 认证

```text
auth.js → /api/auth/* → auth.py → utils_auth.py → User/UserProfile
```

停用账号、密码变化和令牌版本必须通过统一账号有效性检查。

### 上传和下载

```text
explorer-upload.js → files_upload.py → 校验 → 临时/正式文件 → Material
explorer-file.js   → files_download.py → 身份/令牌/配额 → Django 或 Nginx
```

数据库事务不会撤销文件移动；所有异常路径都要检查磁盘补偿和幽灵记录。

### 审核与举报

```text
admin-pending.js → moderation.py → utils_moderation.py → 状态/通知
qa 或资料页面  → reports.py    → 统一可见作用域 → 候选处理人
```

新增管理入口必须复用作用域查询，不能只判断用户角色。

### 课程树与跳转

```text
explorer-core.js → /api/courses/tree/ → courses.py → utils_course_tree.py
```

课程别名和合并最终跟随主课程。前端从搜索、榜单、收藏或课表进入课程时，应复用既有统一
导航入口，避免异步渲染互相覆盖。

### 课表同步

```text
timetable.js → /api/user/timetable/ → user_timetable.py → UserTimetable.revision
```

写入必须携带并校验 revision；SQLite 上不能假定行锁能解决并发覆盖。

## 7. 权限原则

- 普通用户只能操作自己的资料、收藏、课表和问答内容。
- 版主能力受学院、课程类型、板块或问答授权范围约束。
- 总管理员能力也必须通过统一认证入口，不能绕过停用账号检查。
- 用户主页和管理员内嵌视图要区分“查看者”和“被查看者”的身份数据。
- 所有用户内容输出到 HTML 时必须明确区分纯文本与已净化富文本。

## 8. 测试与维护

- 公开 CI 负责 Django system check、迁移完整性、静态收集和上下文文档校验。
- 完整测试在 `materials/tests/` 中随源码维护，通过 `run_tests.sh` 统一运行。
- 改模型、权限、审核、文件生命周期、令牌或并发逻辑时必须补相应回归。
- 普通功能修复不更新本地图；只有本文件所描述的结构或契约改变时才更新。
