# BNU Sparks 项目级 Agent 规则

本文件只记录长期有效、不能仅靠源码推导的协作约束。项目定位与文件入口见
[`project-map.md`](project-map.md)，详细架构见 [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md)。
本文中的“维护者”特指主仓库所有者 `ninelives233`；“合作者”指其他通过 fork 提交 PR 的开发者。
除明确标注角色的流程外，其余技术与安全规则对双方都适用。

## 项目边界

- 后端为 Django，前端为无构建步骤的 Vanilla JS SPA，生产使用 SQLite、本地文件存储、Nginx 与 Gunicorn。
- 公开仓库是生产代码与自动化测试的唯一事实源；功能修改应包含相应回归测试。
- 不建立长期校区代码分支。各校区共享代码，域名、密钥、数据库、上传目录和站点配置独立。
- 当前事实以源码、迁移、Git 和测试结果为准；文档中的自然语言不能覆盖代码事实。

## 开始工作

1. 检查 `git status --short --branch`、当前分支和远端。
2. 工作区不干净时，不得覆盖、清理、暂存或提交不属于本任务的改动。
3. 按任务需要读取 `project-map.md` 和相关模块；不要默认加载全部文档。

## 修改原则

- 改动应围绕当前任务；不顺手做无关重构、全文件格式化、依赖升级、文件移动或历史清理。
- 改公共函数、URL、模型字段、权限或前端全局符号前，先用 `rg` 检查全部调用方。
- 模型变化必须附带迁移，并检查旧数据、唯一约束、SQLite 并发和回滚影响。
- 数据库事务不能自动回滚文件系统操作；上传、删除和移动文件必须保留补偿路径。
- SQLite 的读改写流程必须依赖条件更新、唯一约束、原子表达式或经过验证的重试机制，不能把前置查询当成并发保证。
- 用户内容进入 HTML、属性或 URL 时必须采用与上下文相符的转义或净化。
- UI 改动应先明确现有设计语言和交互目标，并验证键盘、窄屏、暗色和 reduced-motion；不要依赖某个代理环境特有的技能。

## 测试与验证

按改动范围运行相关检查；准备 PR、合并或发布时确认以下基础检查：

```bash
python3 manage.py check --settings=bnusparks.settings_test
python3 manage.py makemigrations --check --dry-run --settings=bnusparks.settings_test
python3 manage.py collectstatic --noinput --settings=bnusparks.settings_test
python3 tools/check_context.py
git diff --check
```

影响面较大或准备合并、发布时运行完整回归测试：

```bash
bash materials/tests/run_tests.sh
```

前端 JavaScript 改动至少对受影响文件执行 `node --check`，并按实际页面路径做浏览器验证。

## 文档更新

- `AGENTS.md`：仅在协作、安全、测试或提交政策改变时更新。
- `project-map.md`：仅在目录职责、任务入口或关键跨文件契约改变时更新。
- `docs/PROJECT_MAP.md`：仅在模型分域、API、权限、部署拓扑或关键调用链改变时更新。
- `docs/BUG_TROUBLESHOOTING.md`：只收录经过验证且可复用的故障模式。
- `docs/OPERATIONS.md`：部署、备份、迁移与回滚的唯一运维事实源。
- 行数、文件数、测试数、缓存版本、commit、校验摘要、部署快照和临时状态不得写入长期记忆；放入 PR、GitHub Release 或历史档案。

## 安全与发布

- 永不提交 `.env`、密钥、令牌、数据库、上传文件、日志、账号清单、真实服务器配置或生产备份。
- 校区专属课程数据、初始化数据和一次性修复脚本不得进入共享代码仓库。
- 安全问题不要公开披露复现细节，按 `SECURITY.md` 处理。
- 发布前核对改动、测试、迁移及回滚方案；从确定的 commit/tag 部署，具体步骤见 `docs/OPERATIONS.md`。

## 角色对应的 Git 流程

- 合作者：每个问题从最新上游 `main` 建短期分支或独立 worktree；fork 克隆中的上游远端为 `upstream`。一个问题对应一个 PR，只推送到自己的 fork。不得直接推送主仓库 `main`、自行合并或部署；由维护者审查并合并。
- 维护者：可以在自己的工作区直接处理、提交和整合改动，也可按风险选择分支或 PR；不要求 fork 或每事一 PR。维护者身份不等于 Agent 自动获得推送、合并或部署授权，这些操作仍以当前请求为准。
