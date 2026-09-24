# 贡献指南（CONTRIBUTING）

感谢参与 BNU Sparks（木铎星火）！这是一个由校内同学共同维护的课程资料共享平台。

## 技术栈

- 后端：Django（见 `requirements.txt`）+ SQLite
- 前端：纯 Vanilla JS SPA（无构建步骤），入口 `public/index.html`
- 部署：Supervisor + Nginx（模板见 `deploy/nginx/bnusparks.conf.example`）

## 开始改代码前

- 先读 [AGENTS.md](AGENTS.md) 了解协作边界和验证要求；
- 用 [project-map.md](project-map.md) 按任务定位文件；
- 架构与关键流程见 [docs/PROJECT_MAP.md](docs/PROJECT_MAP.md)，排障顺序见 [docs/BUG_TROUBLESHOOTING.md](docs/BUG_TROUBLESHOOTING.md)。

这些文件只记录当前稳定事实。任务进度、临时调查结论和发布记录应留在 Issue、PR 或 Release 中。

## 本地开发

本校区协作者需先获得公开仓库的写入权限；分校区协作者可以 fork 后提出 PR。
以下命令在全新 clone 中执行，测试不依赖生产数据或服务器：

```bash
git clone https://github.com/ninelives233/BNUSparks.git
cd BNUSparks
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
bash materials/tests/run_tests.sh
```

需要启动本地网站时，再创建仅供开发使用的 `.env` 与本地数据库：

```bash
cp .env.example .env        # 将 SECRET_KEY 改成随机生成的本地值
python3 manage.py migrate
python3 manage.py createsuperuser
python3 manage.py runserver
```

首次课程数据可运行：`python3 manage.py seed_majors`；更多初始化命令见 `docs/OPERATIONS.md`。

## 测试

完整测试套件随源码维护：

```bash
bash materials/tests/run_tests.sh                          # 全量回归
bash materials/tests/run_tests.sh materials.tests.test_pin # 单文件
```

功能修复应在同一个 PR 中包含对应回归测试；测试只能使用合成账号、临时目录和测试数据库。

## 从问题到 PR

每个问题从最新 `main` 建一个短期分支；不要直接在 `main` 上改：

```bash
git switch main
git pull --ff-only origin main
git switch -c fix/简短问题名
# 修改代码和对应测试
bash materials/tests/run_tests.sh
git add 相关文件
git commit -m "fix: 简述问题"
git push -u origin fix/简短问题名
```

在 GitHub 上选择「Compare & pull request」，目标分支为本仓库的 `main`。
没有本仓库写权限的贡献者先 fork，将分支推到自己的 fork，再向本仓库 `main` 提 PR。
PR 应写明问题、改动、测试结果和可能影响的数据/权限；CI 通过后由仓库维护者审核并合并。

合并后由维护者在本地执行 `git pull --ff-only origin main`，再按
[运维手册](docs/OPERATIONS.md) 部署固定提交。协作者无须接触服务器或生产配置。

## 提交规范

- 一个 PR 聚焦一件事；改动 `materials/models.py` 必须附带 migration（CI 会用 `makemigrations --check` 拦截）
- 前端改动注意 `public/index.html` / `feature-loader.js` 的 `?v=` 缓存版本号约定
- 不要提交：`.env`、任何密钥、生产数据、`data/` 下任何内容、宣传素材与设计原型
- 涉及审核流/权限的改动请在 PR 描述中写明影响面与测试情况

## 安全问题

请勿公开 Issue，遵循 [SECURITY.md](SECURITY.md) 的私有漏洞披露流程。

## 分校区说明

各校区复用同一套架构，但使用独立服务器、域名、数据库与课程目录数据——不要把校区专属数据（课程种子、培养方案、账号清单）提交到本仓库。
