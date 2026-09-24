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

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # 填入 SECRET_KEY
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

## 提交规范

- 一个 PR 聚焦一件事；改动 `materials/models.py` 必须附带 migration（CI 会用 `makemigrations --check` 拦截）
- 前端改动注意 `public/index.html` / `feature-loader.js` 的 `?v=` 缓存版本号约定
- 不要提交：`.env`、任何密钥、生产数据、`data/` 下任何内容、宣传素材与设计原型
- 涉及审核流/权限的改动请在 PR 描述中写明影响面与测试情况

## 安全问题

请勿公开 Issue，遵循 [SECURITY.md](SECURITY.md) 的私有漏洞披露流程。

## 分校区说明

各校区复用同一套架构，但使用独立服务器、域名、数据库与课程目录数据——不要把校区专属数据（课程种子、培养方案、账号清单）提交到本仓库。
