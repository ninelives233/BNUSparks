---
status: current
audience: collaborator
purpose: repeatable diagnosis workflow
---

# BNU Sparks 排障手册
本文件只保留当前可复用的排查顺序。历史事故、版本流水和一次性修复不放在这里。

## 1. 先确认问题边界

记录以下事实：

- 环境：本地、测试服务器或生产服务器；
- 操作路径：什么身份，在什么页面，执行了什么操作；
- 预期结果与实际结果；
- 是否稳定复现；
- 浏览器 Console、Network 和后端日志中的第一条异常。

不要在没有证据时先改代码，也不要用清缓存掩盖服务端错误。

## 2. 确认版本

```bash
git status --short --branch
git rev-parse HEAD
git log -1 --oneline
```

生产问题先由维护者确认服务器实际部署 commit、静态资源版本和服务状态。协作者不得自行登录生产服务器或部署个人分支。

## 3. 前端问题

按顺序检查：

1. Console 第一条错误及其文件、行号；
2. Network 中失败请求的 URL、方法、状态码和响应体；
3. `public/index.html` 是否加载了正确资源；
4. `feature-loader.js` 是否成功加载对应功能；
5. 页面恢复时 history state、认证状态和 DOM 是否一致。

常见判断：

- `401`：令牌缺失、过期或账号失效；
- `403`：CSRF、权限或管理范围不满足；
- `404`：路由、对象可见范围或课程别名解析错误；
- `409`：revision 或状态竞争；
- `429`：配额或限流；
- `5xx`：查看服务端第一条异常，避免只处理前端提示。

JavaScript 修改后执行：

```bash
node --check public/js/受影响文件.js
```

涉及跨文件全局函数时，用 `rg '函数名' public/` 检查入口、调用方和内联事件。

## 4. 后端和 API

本地复现优先使用独立开发数据库和测试数据：
```bash
python manage.py check --settings=bnusparks.settings_test
python manage.py makemigrations --check --dry-run --settings=bnusparks.settings_test
```

检查顺序：

1. `materials/urls.py` 中是否存在真实路由；
2. 请求方法、JSON/FormData 和认证头是否符合接口；
3. 视图是否使用统一账号有效性与权限作用域；
4. ORM 查询是否遗漏状态、所有者或管辖范围；
5. 异常处理是否把真实错误错误地转换成成功响应。

生产日志的读取命令、服务名称和权限由维护者按 `docs/OPERATIONS.md` 执行。
## 5. 模型与迁移

出现 `no such column`、约束缺失或字段不一致时：

```bash
python manage.py showmigrations
python manage.py makemigrations --check --dry-run
python manage.py migrate --plan
```

不要手工改生产数据库来绕过迁移。并发写入问题还要检查：

- 是否使用条件更新、`F()`、唯一约束或经过验证的重试；
- 前置查询与最终写入之间是否存在竞态；
- 失败后计数、配额和通知是否回退或保持幂等；
- SQLite busy/locked 是否被转换成明确的可重试响应。

## 6. 上传、下载与删除

同时检查数据库和文件系统：

- 上传失败后是否残留临时文件或 Material；
- 文件路径是否经过统一 containment 检查；
- 下载/预览是否错误扣除配额；
- X-Accel 路径是否与 Nginx internal location 一致；
- 删除是否进入 trash，恢复和超期清理是否幂等；
- 数据库回滚后物理文件是否得到补偿。

严禁用生产上传目录做普通调试。

## 7. 权限与审核

复现时明确用户角色、学院/板块范围、对象状态和对象所有者。重点检查：

- 停用账号能否继续使用旧令牌；
- 版主是否越过管辖范围；
- 举报候选人与实际可处理范围是否一致；
- 批量操作是否重新验证每个对象；
- 对象删除后历史查询是否仍受作用域约束。

权限修复必须补负向测试，不能只验证管理员成功路径。

## 8. 缓存与静态资源

先区分服务端缓存、浏览器缓存和旧部署文件。检查：

- HTML 引用的资源是否与实际文件一致；
- 功能懒加载失败是否有可见错误；
- 数据变更后是否执行了对应缓存失效；
- 多进程环境是否误用只在单进程生效的状态；
- `collectstatic` 后目标文件是否存在。

不要通过无限增加缓存版本号代替根因调查。

## 9. 验证修复

至少执行：

```bash
python manage.py check --settings=bnusparks.settings_test
python tools/check_context.py
git diff --check
```

获得私密测试仓库后，运行相关测试和：
```bash
bash materials/tests/run_tests.sh
```

最后复查 `git diff`，确认没有调试输出、临时数据、凭据或无关格式化。

## 10. 报告模板

```text
环境：
身份与操作路径：
预期结果：
实际结果：
复现频率：
Console 第一条异常：
失败请求及响应：
后端第一条异常：
当前 commit：
已执行测试：
```
