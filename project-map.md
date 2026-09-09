# BNU Sparks 项目地图索引

这是项目地图的薄索引。面向维护者的完整、可阅读版本在
[`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md)。

## 当前基线（2026-09-09）

- `materials/models.py`：1040 行，28 个 Django 模型（另有 `CourseType` 枚举；Course 新增 `merged_into` 同名合并字段，迁移 0035）
- `materials/urls.py`：153 行，119 个 `path()` 路由
- `materials/views/`：38 个 Python 文件，11115 行
- `materials/tests/`：35 个 Python 文件，7656 行，466 个 `test_*` 方法
- `materials/management/commands/`：9 个可执行管理命令（含 `merge_same_name_courses` 同名重复课程回填）
- `public/index.html`：1235 行
- `public/js/`：23 个文件，13769 行（按视图懒加载 explorer/QA/admin/timetable 模块）
- `public/css/`：10 个文件，7987 行（共享控件归入静态 components/files/user，页面专属样式再懒加载；新建课程控件在 course.css，我的课表在 timetable.css）

## 按任务定位

- 数据结构、约束、迁移：`materials/models.py`、`materials/migrations/`
- API 地址：`materials/urls.py`
- 认证、令牌、权限、限流：`materials/views/auth.py`、`utils_auth.py`、`utils_moderation.py`
- 文件上传/下载/删除：`materials/views/files_*.py`、`utils_upload.py`、`utils_security.py`、`utils_trash.py`
- 课程树/课程申请/审核：`courses.py`、`course_requests.py`、`moderation.py`
- 文件管理：`operations_*.py`
- 问答/举报/公告/通知/收藏：`qa*.py`、`reports.py`、`announcements.py`、`notifications.py`、`favorites.py`
- 我的课表跨设备同步：`materials/views/user_timetable.py`（GET/PUT/DELETE `/api/user/timetable/`，模型 `UserTimetable`；**写接口必须 `@csrf_exempt`，漏掉浏览器 PUT 会被 CSRF 403 且 Django 测试默认测不出来**）；课表资料数量走 `courses/timetable-summary/` 轻量接口，完整课程树按需加载；前端入口会等待认证完成，刷新/汉堡菜单/懒加载共用同一条课表路由
- 文件访问分类、跨浏览器下载令牌、配额与统一路径边界：`materials/views/files_download.py`、`utils_auth.py`、`utils_quota.py`
- 总管理员用户监测与访问追溯：`materials/views/admin_monitoring.py`、`public/js/admin-users.js`、`public/js/views.js`；身份分布页含用户数量趋势
- 注册/个人身份三标签：`materials/views/auth.py`、`profile.py`、`public/js/auth.js`、`profile.js`
- 前端入口、启动时序与懒加载契约：`public/index.html`、`public/js/feature-loader.js`、`public/js/utils.js`、`public/js/app.js`
- 我的课程（原「我的课表」，v=236 起课程为主体、课表为一种视图：「课程列表/周课表」分段默认列表并记忆上次选择；列表行突出课程名+资料签+「查看资料」，上课安排为辅助行；配色/重新导入收进「管理」菜单；手动添加课程带 `src:'manual'` 标记，重导入时保留（同代码/同名以导入为准），无排课课程只进列表不进网格。教务 xls 导入 + 课程代码链回资料目录/自动建课申请 + 「编辑模式」课程编辑/手动建课/从本周移除/颜色覆盖 + 移动端满屏适配；导入解析带 `ttMergeMeetings` 时段合并；专业课建课用真实课程树层级选择器 `ttOpenLevelPicker`，非 GEN 的公共选修课可在「学院」下拉选「通识课」归入通识树（确认弹窗顶部有提醒，请求体走 general + `general_category_id`）；刷新/汉堡菜单入口等待认证并先激活课表路由，课程树未就绪时点击课程自动补载后再跳转）：`public/js/timetable.js`、`public/css/timetable.css`、设计草案 `docs/课表编辑功能草案.md`
- 同名同位不同码课程合并显示：模型 `Course.merged_into`（迁移 0035）、提交流程 `views/course_requests.py`（同名同位自动合并免审核 + `MERGE_ALERT` 通报辖区/总管）、树/搜索/文件列表按别名解析到主课程（`utils_course_tree.py` `_follow_merge`/`_merged_codes_map`、`courses.py`）、回填命令 `management/commands/merge_same_name_courses.py`、测试 `tests/test_course_merge.py`；前端叶子节点 `courseCodes` 双代码展示在 `explorer-render.js`/`explorer-core.js`。**`courseCodes` 是位置级标注**：只有别名叶子与主叶子同层共现的目录，主叶子才带双代码（别名叶子同层隐藏）；别名叶子单独出现的位置显示自己单码（courseId=别名代码，资料仍跟随主课程）——跨学院/层级不串台
- 搜索/首页卡片/排行榜/个人页跳转课程：统一走 `explorer-core.js` 的 `navToCourse(type, code)`（内部先确保 explorer 懒加载模块与课程树就绪再定位；**勿再手写 `showExplorer(...);navToLast(...)` 成对调用——两者异步渲染会互相覆盖**）
- 设计系统与页面样式：`public/css/tokens.css`（青靛墨蓝/琥珀，首页上传入口保留历史蓝）及其余 CSS 模块
- 回归测试：`materials/tests/`
- 发布与运维：`deploy.sh`（固定 host key、停服后备份应用/SQLite/Nginx、校验重载 Nginx、失败回滚；tar 列表含 public/js、public/css、index.html、tt_tutorial 教程图）、`scripts/`、`bnusparks/settings_prod.py`
- GitHub 仓库创建与推送：`docs/GITHUB_REPO_AGENT_GUIDE.md`（Agent 的授权边界、`gh` 认证、新仓库创建、已有仓库接入、推送验证和安全排错）
- 新专业课程树种子：`scripts/seed_new5.py`（从 `tmp_seed_pdfs/新建5` 转录并幂等写入八个已有学院的专业树）

- 全站设计审查与三套独立静态方案：`docs/design-review-2026-09-06/REVIEW.md`（审查、取舍、迁移规则），同目录 `01-library.html` / `02-workbench.html` / `03-circulation.html`（不接入生产资源）

- 个性化学习空间静态样板：`docs/personal-home-prototype/index.html`（首页、我的课程、导入核对、课程目录与移动布局），第二版见同目录 `v2.html`（课程更新首页与课程列表）；第三版 `v3.html` 为中性白灰/墨蓝配色、日期分组与精简课程列表；第四版 `v4.html` 按实际课表能力重做周网格/列表、多时段编辑与整表覆盖导入；第五版 `v5.html` 以本地真实课程树快照重做首页与全部课程（逐层导航、路径搜索）；第六版 `v6.html` 去除第二侧栏，以当前层级、按需路径和手机单列优化目录（课程体系采用轻量文字页签）；说明见 `brand-spec.md`。

完整地图、调用链、权限边界和“什么时候改哪里”见 [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md)。
