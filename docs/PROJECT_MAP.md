# BNU Sparks · 木铎星火项目地图

> 给人看的维护地图，不是 API 文档的替代品。需要精确路由或字段时，以代码为准。
>
> 基线日期：2026-09-12。行号来自当前工作树；修改代码后只更新本图中受影响的数字和入口。

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
| `materials/models.py` | 1123 行，30 个 Django 模型；另有 `CourseType` 枚举；UserProfile 含外观偏好（`home_layout`/`color_theme`/`mobile_nav`/`default_view`，`color_theme` 支持 `system` 跟随系统，迁移 0038–0042），`CampusLink` 为校园快捷入口；Course 带 `merged_into` 同名合并字段（迁移 0035）；`TimetableImportRecord` 记录主动导入行为（迁移 0037） | `class` 总数不要直接当模型数 |
| `materials/urls.py` | 166 行，126 个 `path()` 路由 | 新增 API 先改路由，再补测试和前端调用 |
| `materials/views/` | 41 个 Python 文件，11964 行 | facade 与子模块一起看，推荐/校园入口等新业务放子模块；推荐接口支持刷新时切换候选窗口；用户名单按当前页分组统计，公告支持首页限量读取；认证与个人资料回传默认打开位置 |
| `materials/tests/` | 37 个 Python 文件，8012 行，491 个 `test_*` 方法 | 改权限/状态机/文件系统时同步补测试；首页外观/校园入口/推荐/默认入口见 test_personal_home.py，同名合并用例见 test_course_merge.py |
| `materials/management/commands/` | 9 个可执行管理命令，另有 `__init__.py`（含 `merge_same_name_courses` 同名重复课程回填） | 清理或数据标注类命令运行前确认 dry-run/备份策略 |
| `public/index.html` | 1435 行 | 页面骨架、表单、弹窗、课程/学院/首页入口、外观抽屉、汉堡导航抽屉（`#navDrawer`）、v9 紧凑首页、五项移动底部导航/其他聚合页视图及核心/懒加载脚本入口都在这里；登录/注册按学号与可选邮箱后缀组合完整邮箱；外观抽屉支持设置打开时进入“首页”或“我的课程”；全部课程紧凑目录使用单行面包屑与右侧操作组，不再重复渲染“专业课/通识课”大标题；首屏在样式加载前恢复主题，按系统偏好解析暗色并避免闪烁；v17 紧凑首页标题改为“首页”，推荐区“查看更多”进入独立 `/recommendations` 索引页，独立页资料索引栏新增可重复请求的“刷新推荐”按钮；热门资料区新增下载/收藏完整榜单入口，完整榜单页复用同一套列表样式并支持两类榜单切换，页面骨架与缓存版本入口同步更新 |
| `public/js/` | 25 个文件，16084 行 | 顶层函数是跨文件契约，改名前全局搜索；appearance/home 为首页与偏好核心，`default_view` 在根路径认证后决定首页或我的课程，`color_theme=system` 监听 `prefers-color-scheme` 实时切换实际主题，explorer/QA/admin/timetable 按视图懒加载；课表懒加载缓存键当前为 v257，用于淘汰曾以 v256 发布的损坏课表包；紧凑首页统计避免重复请求，推荐列表非阻塞加载；推荐区窄屏完整展示四张卡，`home.js` 提供独立推荐索引页加载、渲染、刷新和收藏事件，独立页请求并展示最多 13 条且不复用首页四条缓存，刷新请求带递增序号切换当前推荐候选窗口并规避浏览器缓存，`utils.js`/`views.js`/`app.js` 维护 `/recommendations` 路由与首页导航高亮；首页热门资料与完整下载/收藏排行榜共用榜单数据和导航状态，返回课程后保留榜单类型；移动管理后台归入“其他”导航态；用户主页可内嵌只读课表；紧凑目录统一等宽卡片，专业课一级按直接子节点统计专业数并支持键盘导航；课程子目录不再重复渲染当前目录控件；首页最近上传显示上传者 |
| `public/css/` | 10 个文件，10520 行 | `tokens.css` 先加载并提供三套实际主题；选择跟随系统时由前端在浅色/暗色间切换 `data-bnu-theme`，v9 紧凑首页（画布令牌分三主题）/v12 紧凑首页以主题专属低饱和纸面区分校园入口，并为推荐区增加唯一左侧书脊；v13 窄屏合并后去掉校园底色和公告残留书脊，推荐书脊改为跟随卡片圆角的左侧边框；v14 书脊上下各微延伸 2px，暖色校园入口改为由画布底衍生的低彩度淡纸面；v15 书脊收回推荐卡真实左边框并由圆角外框自然收口；v17 增加“资料索引”独立推荐页的首条突出、编号分栏、面包屑与页面标题及索引板外沿对齐、低干扰“刷新推荐”控件，并把首页入口移至窄屏卡片底部；榜单页新增与首页同款的下载/收藏类型切换；v11 层叠纸页式版式层级仍负责公告、入口、推荐、榜单与动态流的基础取舍/紧凑通识与专业一级目录的学术索引式等宽横向卡片与书脊线/课程切换/窄屏面包屑与切换控件同排底对齐并隐藏大标题/五项移动导航/其他聚合页/软键盘适配在 `base.css`，松散目录卡片标题与数量说明共享视觉中线，公共控件在静态 `components/files/user.css`，页面专属样式再懒加载；v207 起管理后台监测卡片、图表和筛选控件统一使用暗色语义表面，v209 起各页面面包屑跟随本页主内容左边缘，v210 起松散目录短行按内容组真正居中，v211 起暗色目录资料数徽章提亮；首页最近上传显示上传者 |
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
| 通知/公告/校园入口 | `Notification`、`Announcement`、`CampusLink` | 审核、删除、举报、公告和首页校园快捷入口；Type 含 `merge_alert`（同名合并待复核）；CampusLink 由总管理员维护 |
| 行为统计 | `DownloadRecord`、`DownloadQuotaReservation`、`TimetableImportRecord` | 访问流水区分正式下载/预览/旧记录，并以令牌行为编号幂等去重；资料删除后保留快照；按“用户+资料+日期”唯一占位，原子去重每日配额；课表主动导入按用户+事件编号幂等留痕 |
| 收藏 | `Favorite`、`CourseFavorite` | 资料、课程收藏；唯一约束吸收并发重复创建 |
| 课程申请 | `CourseCreationRequest` | 新课程和随附资料申请、审批与迁移；同名同位不同码自动合并显示（免审核 + MERGE_ALERT 通报） |
| 举报 | `Report` | 材料、问答、用户举报及候选审核人；非总管理员的读取/处理/历史统一受 candidates 限制 |
| 问答 | `QaTag`、`QaQuestion`、`QaAnswer`、`QaAnswerLike`、`QaFavorite`、`QaEditHistory`、`QaViewLog`、`QaAskClickDaily`、`QaConfig`、`QaDeleteRequest` | 标签、问题、回答、点赞/收藏、编辑、浏览、日报、配置和删除申请；每题最多一个最佳回答由条件唯一约束保证 |

迁移目录：`materials/migrations/`。不要只改模型不补迁移；不要把物理文件移动误认为可由数据库事务回滚。

## 5. API 与后端模块

精确路由唯一事实源：[`materials/urls.py`](../materials/urls.py)。下表是按维护任务归类的导航，不重复列出 126 条路径。

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
| 个人资料、公开主页、排行、上传/下载历史、外观偏好 | `views/profile.py`、`views/auth.py`、`public/js/appearance.js` | 用户公开信息和统计变化；公开主页实时聚合已审核未删除资料的上传/下载/收藏数据；`home_layout`/`color_theme`/`mobile_nav`/`default_view` 支持 GET/PATCH，`color_theme=system` 按浏览器 `prefers-color-scheme` 实时解析为暗色或浅色，未配置账号使用默认值且不串号；根路径按 `default_view` 决定登录后的默认视图 |
| 我的课表跨设备同步（GET/PUT/DELETE `/api/user/timetable/`，GET 支持 `since` 增量检查，`@csrf_exempt`+JWT，200KB 上限） | `views/user_timetable.py`、模型 `UserTimetable`（迁移 0034）、测试 `test_user_timetable.py`（含条件拉取、乱序覆盖和 `enforce_csrf_checks` 回归护栏） | 同步格式/上限/版本冲突变化；**新建写接口必须带 `@csrf_exempt`（JWT 无 cookie），漏掉会被 CSRF 中间件 403 且本地测试发现不了** |
| 收藏 | `views/favorites.py`、`qa_public.py` | 资料/课程/问答收藏、分页、计数及唯一键并发冲突变化；资料收藏会使上传者公开页统计缓存失效 |
| 公告 | `views/announcements.py` | 管理员发布、纯文本约束、公告列表变化；GET 支持 `limit`，首页仅取最新一条并预加载发布者资料 |
| 校园快捷入口 | `views/campus_links.py`；`/api/campus-links/`、`/api/campus-links/create/`、`/api/campus-links/<id>/`、`/api/campus-links/reorder/` | GET 对普通用户只返回启用项；总管理员可新增、编辑、启停和排序，网址仅接受 http/https |
| 资料推荐 | `views/recommendations.py`；`/api/recommendations/` | 结合课表、课程收藏、可靠预览/下载与课程身份信号，叠加资料质量/新鲜度/类型偏好；排除已获取资料，默认首页请求四条、独立推荐页最多请求十三条，默认返回稳定排序，刷新请求通过序号切换候选窗口并保留结构化理由；无可靠信号时回退热门 |
| 通知 | `views/notifications.py` | 未读、已读、删除、跳转数据变化 |
| 意见反馈（POST `/api/feedback/`，直达超管消息中心） | `views/feedback.py`：广播全部超管 `Notification.Type.FEEDBACK`（排除自己），缓存限流 60s 冷却 + 每日 5 条（**勿按通知行数计数——一份反馈复制 N 份给 N 位超管**），测试 `test_feedback.py`（本地保留） | 反馈限流、广播范围、通知类型变化 |
| 举报 | `views/reports.py` | 举报对象、候选版主、对象级 candidates 权限、处理和历史作用域变化 |
| 问答 | `views/qa.py` facade、`qa_public.py`、`qa_user.py`、`qa_admin.py`、`qa_tasks.py`、`qa_helpers.py` | 问题/回答、净化、置顶锁、最佳回答唯一约束、删除申请冲突和任务变化 |
| 管理员用户/板块/自动审核 | `views/admin.py` | 角色、管辖范围、管理员设置变化；用户列表先分页，再对当前页做上传/下载/预览分组统计，避免多表联结放大 |
| 总管理员用户监测/访问追溯 | `views/admin_monitoring.py`；`/api/admin/monitoring/`、`/api/admin/users/<uid>/downloads/`、`/api/admin/users/<uid>/timetable/` | 正式下载趋势、预览统计、用户注册数量趋势、三项身份分布、课表导入趋势与按用户合并的全量记录、全站访问流水筛选、运行状态、单用户访问记录与只读课表 |

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

入口：[`public/index.html`](../public/index.html)。核心脚本使用 `defer`，非核心模块由 `feature-loader.js` 按视图顺序加载；入口区在 `public/index.html:1420-1432`：

```text
  utils → appearance → auth → profile → notifications → admin-core → views → explorer-core
→ explorer-file → explorer-preview → home → feature-loader → app

按需模块：
  explorer → explorer-upload → explorer-mgmt → explorer-render → newcourse
  qa → qa → qa-editor → qa-compose
  admin → qa → qa-editor → qa-compose → admin-pending → admin-records → admin-users → qa-admin
  timetable → timetable
```

| 文件/组 | 负责什么 | 什么时候改 |
|---|---|---|
| `public/js/utils.js` | `api`、token 清理、HTML/JS 转义、文件徽章/分页、文件删除、路由解析、下载、弹窗滚动/焦点、跨模块浮层清理；包含 `/recommendations` 静态视图路由 | 公共 API、令牌、路由、文件公共工具、dialog 或跨页工具变化 |
| `public/js/appearance.js` | 暖/冷/暗三套实际主题及“跟随系统”偏好（监听 `prefers-color-scheme` 并实时解析为暖色/暗色）、松散/紧凑首页偏好、信息密度设置文案、移动端导航方式（`mobile_nav`：bottom/burger）、默认打开位置（`default_view`：home/timetable）、游客设备缓存与账号隔离、外观抽屉和服务端 PATCH 同步；首页布局切换时自动补拉当前布局所需数据 | 外观设置、主题 token、导航方式、首页布局或启动入口偏好变化 |
| `public/js/auth.js` | 注册、登录、验证、未验证账号重发入口、改密、找回、token 持久化；按角色显示管理后台，并向所有已登录用户显示「我的课程」；认证后应用账号外观偏好并为根路径启动决策提供用户配置 | 认证前端变化 |
| `public/js/views.js` | 普通视图、公告、排行、搜索、公开用户页及管理模式下载追溯；总管理员用户主页在原管理视图内嵌只读课表；`pushViewState`；资料下载/收藏排行榜共用完整榜单列表与类型切换，课程返回保留当前榜单类型；`allCourses` 统一通识/专业入口；移动五项底部导航与其他聚合页视图（showOther，v181 起替代底部弹层）；管理后台与 `/recommendations` 映射到“其他”导航态但保留首页高亮；我的课程入口统一处理认证等待、路由激活和懒加载失败 | 页面导航和公共视图变化 |
| `public/js/profile.js` | 个人中心、公开资料、上传/下载/收藏页 | 用户模块变化 |
| `public/js/notifications.js` | 通知抽屉、通知中心、管理/平民模式及外观调整入口 | 通知和用户菜单变化 |
| `public/js/admin-*.js` | 管理概览、待审、记录、用户；`admin-users.js` 含活动趋势/用户数量趋势/课表导入监测（按用户合并全量展开）/三项身份/访问流水筛选/运行状态/用户名单 | 后台 tab、用户监测和管理动作变化 |
| `public/js/explorer-*.js` | 课程树、课程/学院卡片 SVG 名称映射、上传、文件列表、管理、预览；explorer-core 提供 `navToCourse(type, code)` 统一跳转入口、通识/专业根页签和按需分类面板（先确保懒加载模块与课程树就绪再定位，勿手写 `showExplorer+navToLast` 成对调用）；课程根页使用单行面包屑承载当前层级，根目录页签和管理操作收进右侧操作组，子目录不再渲染重复的当前目录/切换分类控件，也不再额外渲染重复的大类标题；专业课一级目录卡片按学院直接子节点统计「专业」数量，通识课沿用课程分区统计；紧凑目录卡片为等宽行式索引并支持键盘进入；同名合并叶子 `courseCodes` 双代码展示与路径匹配；移动端 PDF 预览不创建 iframe，改为显式下载兜底 | 课程浏览、卡片图标和文件操作变化；新增课程跳转入口一律走 navToCourse |
| `public/js/home.js` | v9 紧凑首页真实统计、公告、校园快捷入口、可解释推荐、桌面热门/最近上传双栏及窄屏「资料动态」三榜合并卡（最近上传/下载榜/收藏榜 Tab 切换，桌面双栏在窄屏退场）；v17 首页标题改为“首页”，推荐区不再输出解释性半句，四张卡在窄屏完整纵排；`showRecommendations`/`loadRecommendationsPage`/`renderRecommendationsPage` 负责 `/recommendations` 独立资料索引页、请求并展示最多 13 条、真实信号、刷新和收藏交互；刷新按钮带递增序号重新请求并切换当前 13 条推荐候选窗口，同时规避浏览器缓存；首页统计避免与通用首页重复请求，推荐列表在首屏刚需数据之后非阻塞加载且独立页不复用首页四条缓存；最近上传显示上传者；总管理员可在首页管理校园入口，普通用户只见启用项；无数据保留空状态 | 首页数据、推荐渲染或校园入口管理变化 |
| `public/js/feature-loader.js` | 按视图串行加载 explorer/QA/admin/timetable 脚本和对应 CSS，并复用脚本/CSS 加载 Promise；失败资源可重试；当前懒加载缓存键为 v257，模块版本同时用于课表教程步骤图资源缓存刷新 | 首屏资源、模块依赖顺序、错误恢复或懒加载入口变化 |
| `public/js/newcourse.js` | 新课程申请和附带资料 | 新课申请变化 |
| `public/js/qa*.js` | 问答列表、编辑器、管理、提问、浏览器侧 HTML 白名单 | 问答与富文本变化 |
| `public/js/timetable.js` | 我的课程（所有已登录用户可用，v=240 起侧栏位于「首页」与「通识课」之间，v=242 起学号前四位为 2026 且存在待建课程时显示大类招生培养方案提醒，当前 2914 行）：解析教务导出「学生选课课程表」**仅限「按列表方式显示」明细表**（GBK HTML 伪装 `.xls`，纯前端 `ttParseImport`；检测到 `xkinfo` 按周网格模板即拒收——重弹教程 + 顶部 danger 横幅说明原因，网格版无课程代码且一格堆多个教学班，「管理」菜单有「导入教程」入口），周次/单双周/节次过滤渲染周网格（`ttState`+localStorage `bnusparks_timetable_v1_u<uid>` 按账号分储）；4 套配色方案 × 资料丰度冷暖对比三档；进入课表先调用 `/api/courses/timetable-summary/` 按代码显示资料数量，点击课程/编辑/导入时再加载完整课程树；按课程代码链接课程树（`ttFindPathByCode`：精确/区段代码；v=250 形势与政策特例改为按名字强制路由——课名以「形势与政策」开头即直连思政大类同名叶子目录并跳过代码匹配（各分册教务代码五花八门，不再误报「未建目录」），其余课程身份入口优先，点击直达课程目录，树未就绪时 `ttEnsureCourseTree` 自愈、懒加载竞态与失败重试）；跨设备同步 `ttSyncPull`/`ttSyncUpload`（本地保存后立即串行上传，5 秒条件轮询，切回页面/聚焦立即检查，GET `since` 未变化时不传课表数据，服务端拒绝旧版本覆盖）；接口 `/api/user/timetable/` 按 `importedAt` 取较新；未建课确认时选位置自动 POST `/api/courses/request/` 记入 `pendingCodes`，批准前不可跳转；v=256 非本科身份（`identity_education`≠本科，含未设置）导入一律不链接不建课：`ttShowConfirmModal` 入口 `ttIsUndergrad` 短路——跳过确认弹窗直接纯导入（keepManual 默认保留）+ toast「硕、博板块正在筹备中，暂无资料目录」（建课申请入口仅在弹窗内，跳过即天然阻断 `/api/courses/request/`），`ttResolveCourseLinks` 渲染层同步短路（历史已导入课表一并置为未链接）；v=257 编辑器同步收敛：`ttEditRenderLink` 非本科直接显示筹备中提示（不渲染建课位置控件），`ttEditSave` 的建课申请加 `ttIsUndergrad()` 前置（手动添加/编辑带代码课程不再 POST `/api/courses/request/`），手动建课空态文案按身份分支；非本科课程代码照常随课程本地+云端保存，板块上线后 `ttResolveCourseLinks` 自动接入；「切换视图」`ttToggleView` 周网格 ⇄ 课程列表（`ttRenderList`+`ttStatusTag`，偏好 `bnusparks_timetable_view_u<uid>`；`ttCompactSched` 紧凑安排行含教室——同段多教室以 `ttCompactRooms` 收敛，仅周次细节留悬停提示）；v=237 起头部单「管理」按钮（菜单：v=251 起按重要度分三层（课表：重新导入课表·加重/编辑课程｜外观：课程配色｜帮助：导入教程/意见反馈），其中重导入副标题为「用教务文件一键生成课表」、反馈副标题为「意见直达开发者」，编辑态按钮变「完成」；v=252 菜单增「切换课表」（`ttShowSlotPop`，副标题显示当前表名）：多学期槽 `slots/activeId` 挂在活动表 blob 上随 `ttSaveStore`/`ttSyncUpload` 整信封云同步（服务端零改动，契约见 test_user_timetable::test_slots_envelope_roundtrip），`ttSwitchSlot` 整表换入换出并 bump `importedAt` 防云端回滚，`ttEnsureSlotsShape` 在 `ttLoadStore`/`ttAdoptCloudTimetable` 统一补齐存量单表，导入落点由 `ttState.importTarget` 区分「覆盖当前表/导入为新课表」（上限 8 份，重命名 ✎ 行内输入、删除 🗑 两步 armed）；`ttShowFeedbackModal` 弹窗带字数计、提交走 `/api/feedback/`、右下角邮箱链接引导附图/文件走邮件）：`ttOpenCourseEditor` 课程编辑弹窗（名称/教师/代码/8 色相覆盖/多时间段增删复制/仅本周）、`ttStripCurrentWeek` 从本周移除拆段、空位点击新建课程（手动建课+选位置提申请）、`ttEnsureIds` 存量补 id、删除两步确认，保存即 bump importedAt 走云同步；重导入检测手动课程（`src:'manual'`）由用户勾选保留/覆盖；移动端网格满屏（`tt-w5` 无周末课自动收列，cqh 字体缩放）；`ttMergeMeetings` 时段合并（多教室同段合一、碎片周次并段、连堂并块，`ttLoadStore`/云端拉取时对存量数据归一化）；专业课建课层级选择器 `ttOpenLevelPicker`（真实课程树只到「直接含课程的文件夹」，选择暂存 `ttLocPicks`，导入确认与编辑器共用）；从移动底栏/刷新进入时等待认证并先激活课表路由，课程点击在目录树未就绪时自动补载后再跳转；列表视图渲染后使用列表节点事件委托，避免课程行无响应；教程步骤图 URL 带资源版本参数，替换后可立即绕过静态缓存 | 教务导出格式变化（改 `ttParseMeetings`/`ttParseMeeting`；拒收逻辑在 `ttParseImport` 的 `.xkinfo` 探测）、课表 UI/配色/同步/编辑/视图切换/课程链接或教程素材变化 |
| `public/js/app.js` | 启动、移动底栏矮视口兼容、滚动阴影、`popstate`、刷新恢复、底部导航/课程导航的游客点击放行；根路径有登录会话时等待认证并按 `default_view` 进入首页或我的课程；恢复与深链 `/recommendations`；汉堡导航抽屉 `openNavDrawer`/`closeNavDrawer`/`renderNavDrawer`（克隆桌面侧边栏栏目，可见性/高亮随侧栏联动） | 启动顺序、默认入口、浏览器返回、深链或汉堡导航变化 |
| `public/css/tokens.css` | OKLCH 色彩、编辑式学习工作台的纸白/墨蓝/细铜色基础及 warm/cool/dark 实际主题覆盖、系统跟随的浅/暗色方案、字体、间距、动效变量 | 设计系统或主题变化 |
| `public/css/base.css` | 全局布局、表单、弹窗、首页搜索上传入口、v9 紧凑首页（画布/描边令牌分三主题）、v15 紧凑首页书脊贴合推荐卡外沿与暖色淡纸面（v13 窄屏合并卡片收束作为基础，书脊使用卡片真实左边框并由圆角外框自然收口，暖色校园入口底板由 `--bg` 派生，移动端校园入口/公告保持透明与无残线）、v17 “资料索引”独立推荐页（首条突出、编号分栏、面包屑与索引板内侧对齐、窄屏单列、低干扰刷新控件）和首页推荐入口在窄屏卡片底部；资料下载/收藏排行榜复用同一套榜单行，并在完整榜单页提供同款类型切换；紧凑布局下通识/专业一级目录的学术索引式等宽横向卡片（书脊线、80px 桌面/78px 移动行高、固定阅读顺序）、松散目录卡片标题与数量说明共享视觉中线、课程根页签/子目录切换统一小圆角控件、窄屏面包屑与切换控件同排底对齐并隐藏大标题、五项移动底部导航（激活态为伪元素圆角方形软底 `--radius-md`，非胶囊；`html[data-bnu-nav=burger]` 时隐藏底栏并由 `.hl-burger` 取代星火图标 + 左滑 `.nav-drawer` 导航抽屉（与 `.notif-drawer` 全量镜像：380px/max-90vw 同宽、圆角阴影动画同规格反向、页头复用 `notif-drawer-header`+`dm-eyebrow`、`.nd-item` 与 `.dm-item` 同度量且强调线/位移镜像；图标单色 currentColor；`.nav-drawer-overlay` 为 0.18 轻遮罩、不用 backdrop-filter——blur 在部分手机内核会把整屏渲染成灰雾））、移动端「其他」聚合页（ov-*）、网站标识占位及软键盘矮视口适配 | 基础 UI、首页布局、课程导航或移动基础变化 |
| `public/css/admin.css` | 审核/管理后台；暗色主题下统计卡、监测图表、数据卡、筛选输入和分页控件统一使用 `--raised`/`--surface`/`--border` 语义令牌 | 管理 UI 变化 |
| `public/css/user.css` | 个人中心、用户页、通知抽屉、外观设置抽屉（`#drawerAppearance` 为可滚动 flex 页，面板内容超高时在页头下方滚动；包含“打开时进入”首页/我的课程选项和“跟随系统”色彩选项）及我的上传操作；暗色主题语义表面兜底覆盖通知、排行、资料类型块 | 用户 UI、外观设置或暗色状态变化 |
| `public/css/files.css` | 文件列表、详情、预览、举报、上传下载和管理模式文件控件；详情页 `.fd-meta-file` 超长文件名省略号截断（`.fd-meta-file-text` 收缩裁切）；暗色主题覆盖高亮行及预览/举报弹窗表面 | 文件 UI 或暗色弹窗适配变化 |
| `public/css/course.css` | 课程树、课程页面及新建课程控件；暗色主题覆盖查重提示色块 | 课程浏览、新建课程或暗色状态变化 |
| `public/css/announcement.css` | 公告 UI；暗色主题覆盖筛选悬停与选中底色 | 公告页面或暗色状态变化 |
| `public/css/qa.css` | 问答与编辑器 UI；≤640px 发布/编辑页收紧（`.qa-compose-card` 留白、`.qa-l1-chip`/`.qa-theme-card` 缩小圆角、`.qa-editor-content` 加高至 260px、`.qe-btn` 工具栏紧凑）与列表提密（`.qa-card` 内边距/字号/徽章缩小、精选区 `.qa-pinned-section` 收紧，媒体块须置于全部卡片基础规则之后）；暗色主题覆盖精选底板与筛选高亮，避免浅色闪光块 | 问答 UI 或暗色状态变化 |
| `public/css/timetable.css` | 我的课表（「纸墨 × 中国色」卡片、4 套配色 `.tt-sch-*` + 资料丰度 `.tt-rich-*` 色阶、周网格与导入/教程弹窗、列表视图 `.tt-list/.tt-lrow/.tt-tag` 的独立卡片与桌面双栏排课信息、桌面卡片垂直留白/多行课程名/稳定可读字号与目录失败重试签、编辑模式 `.tt-editing`（空位 `＋`/表单 `.tt-fld`/时间段 `.tt-seg`/色板 `.tt-swatch`/危险按钮 `.danger.armed`）、移动端标题/操作/分段/周次工具栏重排与满屏 `:not(.tt-mode-list)` flex 链 `#ttBody→.tt-scroll` + 容器查询 cqh 字体；窄屏隐藏大标题、恢复桌面端分段控件并让工具条/标签/周次栏/网格共享 12px 左右边距，列表卡片收紧且网格课程卡缩小、卡片底部小字恢复教室显示（`.tt-card-meta .r` 省略号，教师移步列表视图）；按当前周自适应 5/7 日列，移动端显式清零 `min-width` 并用 `minmax(0, 1fr)` 防止窄屏裁切；所有移动端宽度统一 `.pc-seg` 桌面分段样式；层级选择器 `.tt-lp-*` 与位置控件 `.tt-loc-lv/.tt-loc-path`） | 课表 UI、配色方案、编辑器或移动端适配变化 |
| `public/css/components.css` | 跨页面按钮、弹窗基座、分段控件、开关、空态/加载态及全站文字输入焦点状态；暗色主题覆盖管理弹窗和分段控件底色 | 共享组件、输入焦点或暗色状态变化 |

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
| `docs/personal-home-prototype/v9.html` | 411 行 | v8 层次优化：收紧正文边距、墨蓝公告、白底推荐与独立榜单、手机单列推荐 |
| `docs/personal-home-prototype/brand-spec.md` | 148 | 设计规则、体验路径、示例范围与验证记录 |
| `docs/version-update-checklist.md` | 109 | 本次外观偏好、紧凑首页、移动导航、全部课程、校园入口和推荐版本更新的实施与验证记录 |
| `docs/version-update-review-report.md` | 159 | 供 Astra 审查本轮版本更新的范围、实现、API 权限、验证证据和风险重点 |

## 8. 测试与运维定位

| 目标 | 入口/文件 | 说明 |
|---|---|---|
| 全量回归 | `bash scripts/run_tests.sh` | 使用 `bnusparks/settings_test.py`；改安全/状态机后必须跑 |
| 认证/权限 | `test_auth_registration.py`、`test_permissions.py`、`test_hardening_v167.py`、`test_audit_fixes.py` | 停用用户、限流、CSRF/Bearer 边界 |
| 文件生命周期 | `test_upload_text.py`、`test_delete_restore.py`、`test_xaccel_download.py`、`test_zip_structure.py`、`test_audit_fixes.py` | 大小上限、失败清理、磁盘补偿、fallback containment |
| 审核/课程 | `test_review_*.py`、`test_course_*.py`、`test_auto_approve.py` | 追加批量审核保护、迁移失败、同名合并 |
| 问答/举报 | `test_qa.py`、`test_reports.py`、`test_audit_fixes.py` | 净化器、候选人越权（含目标删除后）、历史作用域、删除申请与最佳回答并发一致性 |
| 用户监测/追溯 | `test_admin_monitoring.py`、`test_user_timetable.py` | 总管理员权限、活动/用户数量/课表导入趋势桶、按用户合并的全量记录、只读课表权限、三项身份聚合、预览/下载筛选、导入事件幂等、资料删除后留痕和运行状态 |
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

最后更新时间：2026-09-12。若目录、路由、模型或模块拆分改变，先更新本文件和根目录 `project-map.md`，再更新 AGENTS/README 中的摘要数字。
