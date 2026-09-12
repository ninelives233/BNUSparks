# BNU Sparks 项目地图索引

这是项目地图的薄索引。面向维护者的完整、可阅读版本在
[`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md)。

## 当前基线（2026-09-12）

- `materials/models.py`：1123 行，30 个 Django 模型（另有 `CourseType` 枚举；UserProfile 增加外观偏好字段含 `mobile_nav`/`default_view`，`color_theme` 支持跟随系统；CampusLink 提供校园快捷入口；迁移 0038–0042；根路径按账号偏好进入首页或我的课程）
- `materials/urls.py`：166 行，126 个 `path()` 路由（新增校园入口与资料推荐接口）
- `materials/views/`：41 个 Python 文件，11964 行（新增 `campus_links.py` 校园入口配置、`recommendations.py` 可解释推荐；推荐接口支持刷新时切换候选窗口；总管理员可读取用户课表；用户名单按当前页分组统计，公告支持首页限量读取；认证与个人资料回传默认打开位置）
- `materials/tests/`：37 个 Python 文件，8012 行，491 个 `test_*` 方法
- `materials/management/commands/`：9 个可执行管理命令（含 `merge_same_name_courses` 同名重复课程回填）
- `public/index.html`：1435 行（v9 紧凑首页、统一课程导航、五项移动底部导航、其他聚合页视图和外观抽屉；登录/注册按学号与可选邮箱后缀组合完整邮箱；外观抽屉支持设置打开时进入“首页”或“我的课程”；全部课程紧凑目录使用单行面包屑与右侧操作组，不再重复渲染“专业课/通识课”大标题；主题首屏在样式加载前恢复，支持按系统偏好解析暗色并避免闪烁；v17 紧凑首页标题改为“首页”，推荐区保留四张卡并以“查看更多”进入独立推荐索引页，独立页在资料索引栏提供可重复请求的“刷新推荐”按钮；热门资料区新增下载/收藏完整榜单入口，完整榜单页复用同一套列表样式并支持两类榜单切换，页面骨架与缓存版本入口同步更新）
- `public/js/`：25 个文件，16067 行（新增 appearance/home；按视图懒加载 explorer/QA/admin/timetable 模块；外观偏好包含账号级 `default_view` 并在根路径认证后按配置进入首页或我的课程；色彩氛围支持跟随系统，监听浏览器 `prefers-color-scheme` 自动切换实际主题；首页在信息密度切换时按当前布局自动补拉对应数据；移动管理后台归入“其他”导航态；我的课程对所有已登录用户开放；总管理员可在用户主页内嵌只读查看用户课表；紧凑首页统计避免重复请求，推荐列表非阻塞加载；推荐区窄屏不再折叠并支持独立推荐索引页路由/渲染，独立页请求并展示最多 13 条资料且不复用首页四条缓存；推荐页刷新按钮带递增刷新序号，切换当前推荐候选窗口并规避浏览器缓存；首页热门资料与完整下载/收藏排行榜共用榜单数据和导航状态，返回课程后保留榜单类型；紧凑目录统一等宽卡片、专业课学院直接子节点统计专业数并保留键盘导航；课程子目录不再重复渲染当前目录控件；首页最近上传显示上传者；课表教程步骤图随懒加载模块版本更新并带资源版本参数，替换图片时可立即绕过浏览器缓存）
- `public/css/`：10 个文件，10520 行（新增主题 token、v9 紧凑首页（画布令牌分三主题）、v12 紧凑首页以主题专属低饱和纸面区分校园入口，并为推荐区增加唯一左侧书脊；v13 窄屏合并后去掉校园底色和公告残留书脊，推荐书脊改为跟随卡片圆角的左侧边框；v14 书脊上下各微延伸 2px，暖色校园入口改为由画布底衍生的低彩度淡纸面；v15 书脊收回推荐卡真实左边框并由圆角外框自然收口；v17 增加“资料索引”独立推荐页、编号/首条突出/响应式分栏、面包屑与页面标题及索引板外沿对齐、低干扰“刷新推荐”控件，并把首页推荐入口在窄屏移至卡片底部；榜单页新增与首页同款的下载/收藏类型切换；v11 层叠纸页式版式层级仍负责公告/入口/推荐/榜单/动态流的基础取舍、紧凑通识/专业一级目录的学术索引式等宽横向卡片与书脊线、课程切换、窄屏面包屑与切换控件同排底对齐并隐藏大标题、五项移动导航、其他聚合页样式和软键盘矮视口适配；共享控件归入静态 components/files/user，页面专属样式再懒加载；v207 起管理后台监测卡片、图表和筛选控件统一使用暗色语义表面，v209 起各页面面包屑跟随本页主内容左边缘，v210 起松散目录短行按内容组真正居中，v211 起暗色目录资料数徽章提亮；首页最近上传显示上传者；松散目录卡片标题与数量说明共享视觉中线；跟随系统选项使用明暗分割色板提示自适应行为）

## 按任务定位

- 数据结构、约束、迁移：`materials/models.py`、`materials/migrations/`
- API 地址：`materials/urls.py`
- 认证、令牌、权限、限流：`materials/views/auth.py`、`utils_auth.py`、`utils_moderation.py`
- 文件上传/下载/删除：`materials/views/files_*.py`、`utils_upload.py`、`utils_security.py`、`utils_trash.py`
- 课程树/课程申请/审核：`courses.py`、`course_requests.py`、`moderation.py`
- 文件管理：`operations_*.py`
- 问答/举报/公告/通知/收藏：`qa*.py`、`reports.py`、`announcements.py`、`notifications.py`、`favorites.py`
- 我的课表跨设备同步：`materials/views/user_timetable.py`（GET/PUT/DELETE `/api/user/timetable/`，模型 `UserTimetable`；**写接口必须 `@csrf_exempt`，漏掉浏览器 PUT 会被 CSRF 403 且 Django 测试默认测不出来**）；课表资料数量走 `courses/timetable-summary/` 轻量接口，完整课程树按需加载；前端入口会等待认证完成，刷新/移动底栏/懒加载共用同一条课表路由
- 文件访问分类、跨浏览器下载令牌、配额与统一路径边界：`materials/views/files_download.py`、`utils_auth.py`、`utils_quota.py`
- 总管理员用户监测与访问追溯：`materials/views/admin_monitoring.py`、`public/js/admin-users.js`、`public/js/views.js`；身份分布页含用户数量趋势，课表导入监测按用户合并并全量展开，用户主页在管理视图下方内嵌只读课表
- 注册/个人身份三标签：`materials/views/auth.py`、`profile.py`、`public/js/auth.js`、`profile.js`
- 外观偏好与首页布局：`UserProfile.home_layout`/`color_theme`/`mobile_nav`/`default_view`（迁移 0038/0040/0041/0042）、`materials/views/profile.py` + `auth.py` 的 GET/PATCH/登录回传，`public/js/appearance.js` 的游客设备缓存与账号隔离、外观抽屉；设置分组使用“信息密度”，选项为“松散/紧凑”，色彩氛围增加“跟随系统”，监听浏览器 `prefers-color-scheme` 在暗色/浅色间自动切换；布局切换时首页自动补拉当前布局所需数据；默认「松散首页 + 暖色 + 底部导航 + 首页入口」，登录账号以服务端配置为准，根路径认证后按 `default_view` 进入首页或我的课程；移动端导航可选「汉堡菜单」（`html[data-bnu-nav=burger]`：顶栏左上汉堡按钮取代星火图标、隐藏底部导航，抽屉栏目克隆桌面侧边栏）
- 紧凑首页与校园入口：`materials/models.py` 的 `CampusLink`（迁移 0039）、`materials/views/campus_links.py` 的公开读取/总管理员 CRUD，`materials/views/recommendations.py` 的真实行为推荐，`public/js/home.js` 的统计、公告、校园入口管理、推荐与 v9 h8 分区渲染（窄屏三榜合并进「资料动态」卡）；v17 起首页标题为“首页”，推荐区不再显示解释性半句、窄屏始终展示四张卡，并由“查看更多”进入 `/recommendations` 独立索引页；独立页请求并展示最多 13 条推荐，不复用首页四条缓存，桌面首条横跨一行后以三列补齐最后一行；`public/css/base.css` 保留 v15 贴合推荐卡外沿的书脊与暖色淡纸面并增加 v17 索引页排版（书脊使用卡片真实左边框并由圆角外框收口，面包屑与页面标题及索引板外沿对齐，暖色入口底色改由 `--bg` 派生，移动端仍保持透明）；无数据时保持可靠空状态，不估算数字
- 全部课程与移动导航：`public/js/views.js`、`explorer-core.js` 统一 `allCourses` 入口、通识/专业根页签与按需分类面板，`public/index.html` 的 `courseNavBar`、紧凑目录标题容器、五项移动底部导航/其他聚合页视图和 `compactHomeLayout`
- 前端入口、启动时序与懒加载契约：`public/index.html`、`public/js/feature-loader.js`、`public/js/utils.js`、`public/js/app.js`；根路径有登录会话时等待认证结果，再按账号默认入口显示首页或我的课程，显式深链保持原路由优先级
- 我的课程（原「我的课表」，所有已登录用户可用，v=240 起侧栏位于「首页」与「通识课」之间；v=242 起对学号前四位为 2026 且存在待建课程的用户显示大类招生培养方案提醒；v=236 起课程为主体、课表为一种视图：「课程列表/周课表」分段默认列表并记忆上次选择；列表行突出课程名+资料签+「查看资料」，上课安排为辅助行；v=237 头部仅一个「管理」按钮——编辑课程/重新导入课表/课程配色全收进菜单，编辑态下按钮变「完成」一键退出；v=238 「管理」菜单再收「导入教程」入口，且只接受「按列表方式显示」明细导出——`ttParseImport` 检测到 `xkinfo` 网格模板（按周方式显示/选课结果网格：无课程代码、一格堆多个教学班）即拒收，重弹教程并在顶部渲染 danger 横幅说明原因，网格解析代码已删除；v=239 菜单再收「意见反馈」（`ttShowFeedbackModal` → POST `/api/feedback/` 广播全部超管 `Notification.Type.FEEDBACK`，缓存限流 60s 冷却 + 每日 5 条，弹窗右下角邮箱链接引导附图/文件走邮件）；v=251 管理菜单按重要度分三层（眉标 课表[重新导入课表·加重/编辑课程]｜外观[课程配色]｜帮助[导入教程/意见反馈]，组间细线），其中重导入副标题为「用教务文件一键生成课表」、反馈副标题为「意见直达开发者」；另 `ttNormalizeMeetings` 统一为存量课程补 `teachers` 数组（缺字段曾致列表渲染崩溃）；v=252 增「切换课表」多学期槽（slots/activeId 挂活动表 blob 随信封云同步、整表换入换出、bump importedAt 防回滚、导入可落新槽、上限 8 份）；v=256 非本科身份（identity_education≠本科）导入不链接不建课（ttIsUndergrad 双短路）；v=250 `ttFindPathByCode` 形势与政策特例不再要求代码含 GEN09——凡课名以「形势与政策」开头（不论尾号/代码/无代码）一律按名字直连思政大类「形势与政策」（GEN09001-GEN09008）叶子目录，此时跳过代码匹配，不再误报「未建目录」；手动添加课程带 `src:'manual'` 标记，重导入确认弹窗检测到手动课程时由用户勾选保留/覆盖（默认保留，同代码/同名以导入为准，`ttApplyImport` 的 `parsed.keepManual`），无排课课程只进列表不进网格。教务 xls 导入 + 课程代码链回资料目录/自动建课申请 + 「编辑模式」课程编辑/手动建课/从本周移除/颜色覆盖 + 移动端满屏适配；导入解析带 `ttMergeMeetings` 时段合并；专业课建课用真实课程树层级选择器 `ttOpenLevelPicker`，非 GEN 的公共选修课可在「学院」下拉选「通识课」归入通识树（确认弹窗顶部有提醒，请求体走 general + `general_category_id`）；刷新/移动底栏入口等待认证并先激活课表路由，课程树未就绪时点击课程自动补载后再跳转）：`public/js/timetable.js`、`public/css/timetable.css`、设计草案 `docs/课表编辑功能草案.md`
- 同名同位不同码课程合并显示：模型 `Course.merged_into`（迁移 0035）、提交流程 `views/course_requests.py`（同名同位自动合并免审核 + `MERGE_ALERT` 通报辖区/总管）、树/搜索/文件列表按别名解析到主课程（`utils_course_tree.py` `_follow_merge`/`_merged_codes_map`、`courses.py`）、回填命令 `management/commands/merge_same_name_courses.py`、测试 `tests/test_course_merge.py`；前端叶子节点 `courseCodes` 双代码展示在 `explorer-render.js`/`explorer-core.js`。**`courseCodes` 是位置级标注**：只有别名叶子与主叶子同层共现的目录，主叶子才带双代码（别名叶子同层隐藏）；别名叶子单独出现的位置显示自己单码（courseId=别名代码，资料仍跟随主课程）——跨学院/层级不串台
- 搜索/首页卡片/排行榜/个人页跳转课程：统一走 `explorer-core.js` 的 `navToCourse(type, code)`（内部先确保 explorer 懒加载模块与课程树就绪再定位；**勿再手写 `showExplorer(...);navToLast(...)` 成对调用——两者异步渲染会互相覆盖**）
- 设计系统与页面样式：`public/css/tokens.css`（编辑式学习工作台的中性纸白/墨蓝/细铜色及 warm/cool/dark OKLCH 实际主题、系统跟随的浅/暗色方案）、`base.css`（紧凑首页/课程切换/移动导航）及其余 CSS 模块
- 回归测试：`materials/tests/`
- 本次版本实施记录：`docs/version-update-checklist.md`
- 全站加载速度优化计划（2026-09-12 审查定稿，仅计划未实施）：`docs/performance-optimization-plan.md`（三阶段：服务端配置层 10 项/前端传输层 8 项/架构级 6 项，含场景覆盖矩阵与预期效果）
- Astra 审查报告：`docs/version-update-review-report.md`
- 发布与运维：`deploy.sh`（固定 host key、停服后备份应用/SQLite/Nginx、校验重载 Nginx、失败回滚；tar 列表含 public/js、public/css、index.html、tt_tutorial 教程图）、`scripts/`、`bnusparks/settings_prod.py`
- GitHub 仓库创建与推送：`docs/GITHUB_REPO_AGENT_GUIDE.md`（Agent 的授权边界、`gh` 认证、新仓库创建、已有仓库接入、推送验证和安全排错）
- 新专业课程树种子：`scripts/seed_new5.py`（从 `tmp_seed_pdfs/新建5` 转录并幂等写入八个已有学院的专业树）

- 全站设计审查与三套独立静态方案：`docs/design-review-2026-09-06/REVIEW.md`（审查、取舍、迁移规则），同目录 `01-library.html` / `02-workbench.html` / `03-circulation.html`（不接入生产资源）

- 个性化学习空间静态样板：`docs/personal-home-prototype/index.html`（首页、我的课程、导入核对、课程目录与移动布局），第二版见同目录 `v2.html`（课程更新首页与课程列表）；第三版 `v3.html` 为中性白灰/墨蓝配色、日期分组与精简课程列表；第四版 `v4.html` 按实际课表能力重做周网格/列表、多时段编辑与整表覆盖导入；第五版 `v5.html` 以本地真实课程树快照重做首页与全部课程（逐层导航、路径搜索）；第六版 `v6.html` 去除第二侧栏，以当前层级、按需路径和手机单列优化目录（课程体系采用轻量文字页签）；第七版 `v7.html` 重构首页公告、规模数据、课程更新与按身份显示的帮助入口；第八版 `v8.html` 按用户三行构想独立设计公告快捷区、横向推荐与双榜单；第九版 `v9.html` 收紧侧栏留白，强化三行首页分区与阅读层次；说明见 `brand-spec.md`。

完整地图、调用链、权限边界和“什么时候改哪里”见 [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md)。
