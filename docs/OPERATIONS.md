---
status: current
audience: operator
purpose: deployment backup and recovery source of truth
---

# 运维手册

> 只记录「无法从代码直接推导、但日常运维必需」的事实。本文件不含任何密钥与站点专属地址。

## 部署

- 日常发布：仅由维护者从已审查并合并的固定 commit/tag 运行受控 `deploy.sh`。脚本以归档方式传输应用文件，再执行迁移、缓存表创建、静态收集和 Django 检查。
- 部署参数：`source deploy.sh.template` 后按需导出 `BNUSPARKS_DEPLOY_HOST` / `BNUSPARKS_DEPLOY_ROOT` / `BNUSPARKS_KNOWN_HOSTS`
- 部署后验证：`bash scripts/deploy_verify.sh https://站点域名`
- 各校区使用相同代码 tag，但部署参数、域名、`.env`、数据库、上传目录和备份完全独立。
- 不从个人功能分支部署，也不把服务器真实配置回传仓库。
- 首次建站：空库 `python3 manage.py migrate` → `createcachetable django_cache` → `collectstatic` → Nginx 用 `deploy/nginx/bnusparks.conf.example` 模板 → gunicorn：
  `gunicorn bnusparks.wsgi:application --env DJANGO_SETTINGS_MODULE=bnusparks.settings_prod --bind 127.0.0.1:8000 --workers 2 --timeout 120`

## 生产配置（settings_prod.py）

仓库内为无密钥模板版，真实值全部来自环境变量 / 服务器 `.env`（解析要求 `KEY="值"` 双引号）：

- `SECRET_KEY`：必填（`bnusparks/settings.py` 强制校验）
- `DJANGO_ALLOWED_HOSTS`：必填，逗号分隔；缺省只允许 localhost

## 定时任务（服务器 `crontab -e`）

```cron
# 每日 03:00 数据库备份，保留 30 天（SQLite 建议低峰期；更稳妥用 sqlite3 ".backup"）
0 3 * * * cp /opt/bnusparks/data/db.sqlite3 /opt/bnusparks/backups/db_$(date +\%Y\%m\%d).sqlite3 && find /opt/bnusparks/backups -name "db_*.sqlite3" -mtime +30 -delete

# 每日 06:00 问答区「我要提问」点击日报（通知超管 + 问答区版主）
0 6 * * * /opt/bnusparks/venv/bin/python /opt/bnusparks/manage.py qa_daily_report --settings=bnusparks.settings_prod >> /opt/bnusparks/logs/qa_cron.log 2>&1

# 每日 06:10 硬删软删除超过 48h 的问答内容（兜底；漏配会导致只软删不真删）
10 6 * * * /opt/bnusparks/venv/bin/python /opt/bnusparks/manage.py qa_purge --settings=bnusparks.settings_prod >> /opt/bnusparks/logs/qa_cron.log 2>&1
```

## 资料删除暂存区（trash）

软删除把物理文件移入 `data/trash/`，48h 内可恢复；超期由 `purge_trash` 兜底硬删：

```bash
python3 manage.py purge_trash --settings=bnusparks.settings_prod
```

各删除/恢复端点正常路径已顺带清理，本命令建议按日 cron 兜底。

## 其他维护命令 / 脚本

| 命令 | 用途 |
|---|---|
| `python3 manage.py aggregate_monitoring_events` | 聚合监控埋点（管理后台「运行事件」数据源，按需） |
| `python3 manage.py clean_ghost_materials` | 清理无物理文件的幽灵资料记录 |
| `python3 scripts/clean_stale_data.py` | 清理孤立数据（无主文件/记录） |
| `bash scripts/security-audit.sh` | 服务器只读安全审计（`BNUSPARKS_DEPLOY_HOST` 必填） |
| `python3 manage.py import_pyfa --list-colleges` | 从培养方案 JSON 导入课程（数据文件本地自备） |
| `python3 manage.py cleanup_invalid_courses` | 幂等清理无效课程节点 |

## 数据备份与恢复

- 备份：低峰期 `sqlite3 /opt/bnusparks/data/db.sqlite3 ".backup '/opt/bnusparks/backups/db.sqlite3'"`（在线安全）；`data/materials/` 用户上传文件随机器快照同步
- 恢复：停 gunicorn → 替换 db 文件 → `python3 manage.py migrate --settings=bnusparks.settings_prod` → 启动
- 恢复前确认代码版本、迁移状态和文件备份属于同一站点；不得把一个校区的数据恢复到另一个校区。
- 数据库已经执行的破坏性迁移不能仅靠回退代码撤销，必须使用经过验证的数据恢复方案。
