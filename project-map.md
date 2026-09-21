# BNU Sparks 任务索引

这是项目的轻量导航，不是发布日志。开始任务时先读本页，再只打开对应源码。
详细架构见 [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md)，排障见
[`docs/BUG_TROUBLESHOOTING.md`](docs/BUG_TROUBLESHOOTING.md)。

## 入口

| 任务 | 主要文件 |
|---|---|
| Django 配置、启动、安全头 | `bnusparks/settings.py`、`bnusparks/settings_prod.py`、`bnusparks/urls.py` |
| 模型与约束 | `materials/models.py`、`materials/migrations/` |
| API 路由 | `materials/urls.py` |
| 认证、令牌、个人资料 | `materials/views/auth.py`、`utils_auth.py`、`profile.py` |
| 权限、审核、举报 | `utils_moderation.py`、`moderation.py`、`reports.py` |
| 课程树、课程申请、推荐 | `courses.py`、`utils_course_tree.py`、`course_requests.py`、`recommendations.py` |
| 上传、下载、预览、删除 | `files_*.py`、`utils_upload.py`、`utils_security.py`、`utils_trash.py` |
| 文件与目录管理 | `operations_*.py` |
| 通知、公告、收藏、反馈 | `notifications.py`、`announcements.py`、`favorites.py`、`feedback.py` |
| 问答区 | `qa_*.py`、`qa_helpers.py`、`qa_tasks.py` |
| 我的课程/课表 | `user_timetable.py`、`public/js/timetable.js`、`public/css/timetable.css` |
| 监测与管理员状态 | `monitoring_events.py`、`admin_monitoring.py`、`public/js/admin-*.js` |
| 前端启动与路由 | `public/index.html`、`public/js/app.js`、`views.js`、`feature-loader.js` |
| 前端 API、认证与共用工具 | `public/js/utils.js`、`auth.js`、`profile.js`、`notifications.js` |
| 课程浏览和资料详情 | `public/js/explorer-*.js`、`public/css/course.css`、`files.css` |
| 首页、外观和推荐 | `public/js/home.js`、`appearance.js`、`public/css/base.css`、`tokens.css` |
| 测试 | 私密仓库克隆到 `materials/tests/` 后使用其 `run_tests.sh` |
| 部署、备份和回滚 | `docs/OPERATIONS.md`、`deploy.sh.template`、`deploy/nginx/`、`scripts/deploy_verify.sh` |

## 关键契约

- `materials/views/__init__.py` 是后端 facade；拆分模块时保持既有导入路径兼容。
- `materials/urls.py` 是 API 地址的唯一事实源。
- `public/index.html` 决定静态脚本基础加载顺序；按视图模块由 `feature-loader.js` 加载。
- 前端使用跨文件全局函数和内联事件；改名或删除前必须全仓搜索。
- SPA 导航必须通过现有 history/state 封装，不能只切换 DOM。
- 文件下载、预览、配额和令牌逻辑必须共用既有认证与路径边界。
- 审核、举报和管理员查询必须复用统一作用域，不能只检查角色名。
- 模型写入和文件移动需要分别处理失败补偿。
- 生产数据位于各服务器本地，不属于代码仓库，也不用于普通开发测试。

## 按需文档

- 当前架构和调用链：`docs/PROJECT_MAP.md`
- 故障定位：`docs/BUG_TROUBLESHOOTING.md`
- 部署与恢复：`docs/OPERATIONS.md`
- 贡献流程：`CONTRIBUTING.md`
- 安全披露：`SECURITY.md`

版本历史、部署证明和阶段性审查应从 Git、PR、Release 或专项档案读取，不进入本索引。
