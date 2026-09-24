# BNU Sparks 协作规则

本文件只记录长期有效、不能仅靠源码推导的协作约束。项目定位与文件入口见
[`project-map.md`](project-map.md)，详细架构见 [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md)。

## 项目边界

- 后端为 Django，前端为无构建步骤的 Vanilla JS SPA，生产使用 SQLite、本地文件存储、Nginx 与 Gunicorn。
- 公开仓库是生产代码与自动化测试的唯一事实源；功能修改与对应回归测试在同一个 PR 提交。
- 不建立长期校区代码分支。各校区共享代码，域名、密钥、数据库、上传目录和站点配置独立。
- 当前事实以源码、迁移、Git 和测试结果为准；文档中的自然语言不能覆盖代码事实。

## 开始工作

1. 检查 `git status --short --branch`、当前分支和远端。
2. 工作区不干净时，不得覆盖、清理、暂存或提交不属于本任务的改动。
3. 每个问题使用从最新 `origin/main` 创建的短期分支或独立 worktree。
4. 先读 `project-map.md`，再按任务只读取相关模块；不要默认加载全部文档。

## 修改原则

- 一个问题对应一个分支和一个 PR；只提交解决该问题所需的最小改动。
- 不顺手做无关重构、全文件格式化、依赖升级、文件移动或历史清理。
- 改公共函数、URL、模型字段、权限或前端全局符号前，先用 `rg` 检查全部调用方。
- 模型变化必须附带迁移，并检查旧数据、唯一约束、SQLite 并发和回滚影响。
- 数据库事务不能自动回滚文件系统操作；上传、删除和移动文件必须保留补偿路径。
- SQLite 的读改写流程必须依赖条件更新、唯一约束、原子表达式或经过验证的重试机制，不能把前置查询当成并发保证。
- 用户内容进入 HTML、属性或 URL 时必须采用与上下文相符的转义或净化。
- UI 改动应先明确现有设计语言和交互目标，并验证键盘、窄屏、暗色和 reduced-motion；不要依赖某个代理环境特有的技能。

## 测试与验证

公开仓库基础检查：

```bash
python manage.py check --settings=bnusparks.settings_test
python manage.py makemigrations --check --dry-run --settings=bnusparks.settings_test
python manage.py collectstatic --noinput --settings=bnusparks.settings_test
python tools/check_context.py
git diff --check
```

完整回归测试：

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
- 协作者不得直接推送 `main`、自行合并或部署；由仓库维护者审查 PR，并从合并后的固定 commit/tag 发布。
