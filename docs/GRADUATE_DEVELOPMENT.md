# 研究生资料板块开发入口

本页记录可复用的产品约定、源码入口和验收路径。课程数据、调查证据、阶段数量及发布状态放在本地专项档案，不把它们当作共享代码配置。

## 从这里开始

1. 先读 [项目规则](../AGENTS.md) 和 [任务索引](../project-map.md)，检查当前源码与工作区。
2. 本地资料齐全时，打开 [研究生调查与建设索引](../tmp_seed_pdfs/硕士/研究生板块开发索引.md)。该目录被 Git 忽略，公开仓库的全新克隆不包含这些资料。
3. 按下表进入对应模块；若要写入课程树，先准备来源清单、目标树盘点和逐路径变更预览。
4. 发布、备份及回滚统一遵循 [运维文档](OPERATIONS.md)。本地更新成功不代表线上已更新。

## 产品约定

- 基于课程树组织，以资料广场呈现；课程目录和广场共用课程、资料、搜索、审核与上传链路。浏览方式设置继续复用现有偏好。
- 专业课默认落在身份标签对应的专业；信息或目录缺失时逐层回退。通识入口保留既有行为，只有一个可进入子目录的层级继续跳过。
- 用户按培养层次浏览对应目录，不增加用于查看另一层次的切换入口。硕士方案明确引用的课程，即使大纲标为博士或代码看似博士码，也可以出现在硕士目录中。
- 有可靠培养方案时按方案建树；缺方案时先保留专业入口，让用户创建课程后上传。“本地没有 PDF”不等于官方没有培养方案，还应核查在线方案。
- 广场面包屑支持同级切换；切换祖先节点时回退到该范围。非课程叶子可以展开课程树，移动端沿用现有适配；普通目录模式保留原交互。
- 研究生专业课代码未知时使用站内占位代码；用户在上传时可填写真实代码，也可以留空。同学院同名课程按现有规则复用；存在多个无法区分的候选时需补代码或人工核对。公共课建课仍按现有表单与后端限制处理，不把这条留空规则扩大到所有目录。
- 新版方案优先用于确认当前目录；不同历史代码不能只因同名就合并，已上传资料和旧入口需要保留。

## 模型边界与源码

`CourseCategory` 表示目录中的位置，`Course` 承载课程，`Material.course_id` 承载资料归属。多个目录叶子可以指向同一个课程；身份选择器中的 `Major` 是独立模型，建课程树不会自动同步身份专业。

| 要处理的事 | 入口与关键行为 |
|---|---|
| 模型和培养层次标记 | [models.py](../materials/models.py)：`CourseCategory.education_level`、`Course.merged_into`；[迁移](../materials/migrations/0062_coursecategory_education_level_and_more.py) |
| 身份过滤与默认浏览方式 | [course_visibility.py](../materials/services/course_visibility.py)：`education_for_user`、`visible_category_ids`、`browse_mode_for_profile`；[auth.py](../materials/views/auth.py)、[profile.py](../materials/views/profile.py) 返回浏览偏好 |
| 占位代码与安全补码 | [course_codes.py](../materials/services/course_codes.py)：`placeholder_code`、`is_placeholder`、`adopt_course_code` |
| 课程树输出与列表 | [utils_course_tree.py](../materials/views/utils_course_tree.py)、[courses.py](../materials/views/courses.py)；JSON 中的标记为 `educationLevel` |
| 广场范围、默认专业与路径 | [plaza.py](../materials/views/plaza.py)：`_visible_catalog`、`_default_category_id`、`_with_scoped_leaves`、`_scoped_course_ids` |
| 广场交互与公共排序 | [materials-plaza.js](../public/js/materials-plaza.js)、[plaza.css](../public/css/plaza.css)、[plaza_ranking.py](../materials/services/plaza_ranking.py) |
| 课程申请、复用与审核 | [course_requests.py](../materials/views/course_requests.py)：`_graduate_target_college`、`_graduate_name_course`；[newcourse.js](../public/js/newcourse.js) |
| 上传时补充代码 | [files_upload.py](../materials/views/files_upload.py)、[explorer-upload.js](../public/js/explorer-upload.js)：可选请求字段 `teaching_code` |
| 搜索过滤与占位码展示 | [search.py](../materials/views/search.py)、[search.js](../public/js/search.js)、[explorer-render.js](../public/js/explorer-render.js) |
| 课表课程到资料入口 | [timetable.js](../public/js/timetable.js)、[user_timetable.py](../materials/views/user_timetable.py)；已知代码先在当前可见树中定位 |
| 导航、偏好与身份变更 | [views.js](../public/js/views.js)、[explorer-core.js](../public/js/explorer-core.js)、[profile.js](../public/js/profile.js)、[appearance.js](../public/js/appearance.js) |
| 身份专业数据 | [seed_majors.py](../materials/management/commands/seed_majors.py)、[migrate_grad_identity_majors.py](../materials/management/commands/migrate_grad_identity_majors.py)；执行前另行核对数据范围 |

API 地址以 [materials/urls.py](../materials/urls.py) 为准。常用入口是 `/api/courses/tree/`、`/api/courses/navigation/`、`/api/materials/`、`/api/courses/request/`、`/api/files/upload/`、`/api/files/upload-text/` 和 `/api/search/`。

## 数据契约和调查结论的使用方式

- **目录归属与开课单位分开判断。** 不能用 `Course.college` 或某个学院的当学期课表，替代培养方案中的专业归属；广场范围统一由后端解析目录。
- **代码不是适用层次规则。** 不依据前缀、数字位、大纲列表上的层次，独立决定是否向某培养层次展示；方案对具体课程的明确引用更有针对性。
- **课程中心和课表互相补充。** 优先从目标版本培养方案的课程一览表追到大纲，保留方案、大纲及课程代码之间的证据；名称搜索用于找候选，课表用于核对具体学期。
- **教务类别与修读要求分开。** “公共选修”可能承担选择性必修或综合素养要求；不能把系统类别直接变成个人毕业结论。学术学位指导也不直接覆盖专业学位。
- **共享要有证据。** 同码先核对名称、学院、别名链、其他引用和资料；同名异码、同尾号异前缀只生成待核对候选。部分本科课允许研究生跨选，不代表全部同名本研课程可以合并。
- **课程目录不是当学期排课表。** 列表有课程或大纲，不代表本学期开课；当学期未排课也不代表课程不存在。
- **空链接不是不存在。** 课程中心部分方案链接没有文件；异步页面需等待加载并核对筛选、分页后，才能记录本次查询结果。

## 补码和增量导入的保护点

- 占位码由学院标识与规范化课程名确定；`BNUX` 是站内保留前缀。真实代码仍可能有历史重复，不能假定整个 `Course.code` 字段唯一；目前唯一约束仅针对站内前缀。
- `adopt_course_code` 在 SQLite 事务中先取得写锁再检查冲突，保留课程 ID，并建立旧占位码别名。既有文件路径保持原值；不要为了补码移动文件或重新创建资料。
- 文件及文本上传复用同一补码函数；数据库失败需清理本次已写入的文件，不能只回滚数据库。
- 定向更新前盘点目标完整路径、共享引用、资料数量和目标代码冲突；不把本地节点 ID 带到生产，也不批量重建学院子树。
- 树的层次标记按入口和子节点的实际范围设置；身份过滤后的搜索、广场范围、课表链接及缓存均需一致。保留现有缓存失效、私有响应和 ETag 逻辑。
- 本地一次性脚本的适用范围与校验不能省略。普通代码部署不会同步本地数据库或本地课程清单；数据发布必须独立核对并按运维流程执行。

## 验收入口

核心回归见 [test_graduate_courses.py](../materials/tests/test_graduate_courses.py)、[test_plaza.py](../materials/tests/test_plaza.py)、[test_course_requests_shell.py](../materials/tests/test_course_requests_shell.py)、[test_plaza_group_browser.py](../materials/tests/test_plaza_group_browser.py) 和 [test_search_browser.py](../materials/tests/test_search_browser.py)。可先运行：

```bash
bash materials/tests/run_tests.sh materials.tests.test_graduate_courses materials.tests.test_plaza materials.tests.test_course_requests_shell
```

数据改动另在隔离数据库验证：逐路径核对来源、重复运行无额外变化、代码冲突整批回滚、资料/旧链接/文件路径保留、共享课程的其他入口不受误改。一次性数据脚本的演练结果与共享自动回归是不同的验证。

页面至少覆盖：身份默认专业及逐层回退、同级面包屑与单子目录跳过、公共课层次过滤、空专业建课后上传、留空及补充代码、补码后旧课表入口，以及桌面/窄屏、键盘、暗色、reduced-motion。搜索和直接深链也要核对。

准备发布时按 [项目规则](../AGENTS.md) 做完整检查，按 [运维文档](OPERATIONS.md) 验收目标校区。不要把本地完成、历史发布和本次线上核验混成同一个状态。
