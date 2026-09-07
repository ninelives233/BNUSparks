# BNU Sparks 项目地图索引

这是项目地图的薄索引。面向维护者的完整、可阅读版本在
[`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md)。

## 当前基线（2026-09-07）

- `materials/models.py`：1030 行，28 个 Django 模型（另有 `CourseType` 枚举）
- `materials/urls.py`：152 行，118 个 `path()` 路由
- `materials/views/`：38 个 Python 文件，10689 行
- `materials/tests/`：34 个 Python 文件，7262 行，444 个 `test_*` 方法
- `materials/management/commands/`：8 个可执行管理命令
- `public/index.html`：1231 行
- `public/js/`：23 个文件，12309 行（按视图懒加载 explorer/QA/admin/timetable 模块）
- `public/css/`：10 个文件，7635 行（共享控件归入静态 components/files/user，页面专属样式再懒加载；新建课程控件在 course.css，我的课表在 timetable.css）

## 按任务定位

- 数据结构、约束、迁移：`materials/models.py`、`materials/migrations/`
- API 地址：`materials/urls.py`
- 认证、令牌、权限、限流：`materials/views/auth.py`、`utils_auth.py`、`utils_moderation.py`
- 文件上传/下载/删除：`materials/views/files_*.py`、`utils_upload.py`、`utils_security.py`、`utils_trash.py`
- 课程树/课程申请/审核：`courses.py`、`course_requests.py`、`moderation.py`
- 文件管理：`operations_*.py`
- 问答/举报/公告/通知/收藏：`qa*.py`、`reports.py`、`announcements.py`、`notifications.py`、`favorites.py`
- 我的课表跨设备同步：`materials/views/user_timetable.py`（GET/PUT/DELETE `/api/user/timetable/`，模型 `UserTimetable`；**写接口必须 `@csrf_exempt`，漏掉浏览器 PUT 会被 CSRF 403 且 Django 测试默认测不出来**）
- 文件访问分类、跨浏览器下载令牌、配额与统一路径边界：`materials/views/files_download.py`、`utils_auth.py`、`utils_quota.py`
- 总管理员用户监测与访问追溯：`materials/views/admin_monitoring.py`、`public/js/admin-users.js`、`public/js/views.js`
- 注册/个人身份三标签：`materials/views/auth.py`、`profile.py`、`public/js/auth.js`、`profile.js`
- 前端入口、启动时序与懒加载契约：`public/index.html`、`public/js/feature-loader.js`、`public/js/utils.js`、`public/js/app.js`
- 我的课表（教务 xls 导入 + 课程代码链回资料目录/自动建课申请 + 「切换视图」网格⇄列表 + 移动端满屏适配，管理员专属入口在侧边栏最底部）：`public/js/timetable.js`、`public/css/timetable.css`
- 设计系统与页面样式：`public/css/tokens.css`（青靛墨蓝/琥珀，首页上传入口保留历史蓝）及其余 CSS 模块
- 回归测试：`materials/tests/`
- 发布与运维：`deploy.sh`（固定 host key、停服后备份应用/SQLite/Nginx、校验重载 Nginx、失败回滚；tar 列表含 public/js、public/css、index.html、tt_tutorial 教程图）、`scripts/`、`bnusparks/settings_prod.py`
- GitHub 仓库创建与推送：`docs/GITHUB_REPO_AGENT_GUIDE.md`（Agent 的授权边界、`gh` 认证、新仓库创建、已有仓库接入、推送验证和安全排错）
- 新专业课程树种子：`scripts/seed_new5.py`（从 `tmp_seed_pdfs/新建5` 转录并幂等写入八个已有学院的专业树）

- 全站设计审查与三套独立静态方案：`docs/design-review-2026-09-06/REVIEW.md`（审查、取舍、迁移规则），同目录 `01-library.html` / `02-workbench.html` / `03-circulation.html`（不接入生产资源）

- 个性化学习空间静态样板：`docs/personal-home-prototype/index.html`（首页、我的课程、导入核对、课程目录与移动布局），第二版见同目录 `v2.html`（课程更新首页与课程列表）；说明见 `brand-spec.md`。

完整地图、调用链、权限边界和“什么时候改哪里”见 [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md)。
