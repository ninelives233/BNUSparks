# BNU Sparks 部署指南

> 从零到线上 — 完整部署文档

---

## 目录

1. [准备工作：域名 & 服务器](#1-准备工作域名--服务器)
2. [服务器初始化](#2-服务器初始化)
3. [部署应用](#3-部署应用)
4. [Nginx 反向代理](#4-nginx-反向代理)
5. [HTTPS 证书](#5-https-证书)
6. [进程守护（Supervisor）](#6-进程守护supervisor)
7. [一键部署脚本](#7-一键部署脚本)
8. [日常运维](#8-日常运维)
9. [附录：费用估算](#9-附录费用估算)

---

## 1. 准备工作：域名 & 服务器

### 1.1 域名注册

推荐注册商（按推荐度排序）：

| 注册商 | 价格 | 备案 | 特点 |
|--------|------|------|------|
| **Cloudflare** | 成本价（~¥50-80/年） | 可选 | 自带 DNS + CDN + DDoS 防护，管理最好 |
| **Namesilo** | ~¥60-90/年 | 不可 | 免费隐私保护，老牌稳定 |
| **阿里云 / 腾讯云** | ~¥40-60/年 | 需备案 | 国内访问最快，但备案需 2-3 周 |

**域名推荐（检查是否可注册）：**

- `bnusparks.cn` — 首选，.cn 在国内解析最好
- `bnusparks.com` — 国际通用
- `bnusparks.social` / `bnusparks.org`
- `木铎星火.cn`（中文域名，但兼容性略差）

> ⚠️ **备案说明**：如果服务器在香港/海外，域名**不需要备案**。如果服务器在 mainland（大陆），域名需要 ICP 备案，耗时约 2-3 周。

### 1.2 服务器选择

#### 方案 A：腾讯云轻量应用服务器（推荐 · 国内线路）

| 配置 | 价格 | 适合 |
|------|------|------|
| 2C 2G 40GB SSD | ~¥50/月 | 初期运营 |
| 2C 4G 80GB SSD | ~¥80/月 | 用户增长后 |
| 学生优惠 | ~¥15/月 | 学生认证后折扣价 |

- 优点：国内访问速度快，腾讯云管理面板友好
- 缺点：需要域名备案（若用大陆节点）
- 操作系统：Ubuntu 22.04 LTS

#### 方案 B：华为云香港节点（免备案）

| 配置 | 价格 |
|------|------|
| 2C 2G 40GB | ~¥60-80/月 |

- 优点：**不需要备案**，国内访问速度尚可
- 适合：想快速上线、不想走备案流程

#### 方案 C：Hetzner（德国 / 芬兰）

| 配置 | 价格 |
|------|------|
| CX22 (2C 2G) | €3.99/月 |

- 优点：极便宜，配置自由
- 缺点：国内直连慢，需搭配 Cloudflare CDN
- 适合：预算紧张 + 用户主要在海外

#### 方案 D：阿里云 ECS 学生优惠

| 配置 | 价格 |
|------|------|
| 2C 2G 40GB | ~¥10-15/月（学生认证） |

- 优点：最便宜的大陆服务器
- 缺点：需要备案，学生优惠有时限

### 1.3 我的推荐

```
首选：腾讯云轻量 2C2G + Cloudflare 域名 (免备案用香港节点，备案用大陆节点)
次选：Hetzner + Cloudflare CDN (¥28/月，性价比最高但国内慢)
``` 

---

## 2. 服务器初始化

> 以下所有步骤在服务器上以 root 用户执行。

### 2.1 连接服务器

```bash
ssh root@<服务器 IP>
```

### 2.2 系统更新 & 安装依赖

```bash
apt update && apt upgrade -y
apt install -y python3 python3-pip python3-venv nginx git supervisor certbot python3-certbot-nginx
```

### 2.3 创建非 root 用户（安全）

```bash
adduser deploy          # 设置密码，其他一路回车
usermod -aG sudo deploy
su - deploy
```

### 2.4 配置防火墙

```bash
# 如果服务器有 ufw
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw enable
```

### 2.5 配置 Git

```bash
git config --global user.name "BNU Sparks"
git config --global user.email "bnusparks@163.com"
```

---

## 3. 部署应用

### 3.1 克隆代码

```bash
cd /home/deploy
git clone git@github.com:ninelives233/BNUSparks.git bnusparks
cd bnusparks
```

> 如果 SSH 密钥未配置，改用 HTTPS：
> ```bash
> git clone https://github.com/ninelives233/BNUSparks.git bnusparks
> ```

### 3.2 创建 Python 虚拟环境

```bash
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install django gunicorn
```

### 3.3 配置 Django 生产设置

创建生产配置文件：

```bash
nano bnusparks/settings_prod.py
```

写入：

```python
"""
BNU Sparks — 生产环境配置
"""
from .settings import *

DEBUG = False
ALLOWED_HOSTS = [
    "你的域名",           # 如 "bnusparks.com"
    "www.你的域名",
    "服务器公网IP",         # 如 "1.2.3.4"
]

# 安全密钥 — 生产环境必须重新生成！
# 用以下命令生成： python3 -c "import secrets; print(secrets.token_urlsafe(50))"
SECRET_KEY = "粘贴上面生成的密钥"

# 静态文件收集目录
STATIC_ROOT = BASE_DIR / "staticfiles"

# 媒体文件（上传的资料）
MEDIA_ROOT = BASE_DIR / "data" / "materials"

# 安全配置
SECURE_SSL_REDIRECT = True     # HTTP → HTTPS 自动跳转
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
```

测试配置是否正确：

```bash
python3 manage.py check --settings=bnusparks.settings_prod
```

### 3.4 迁移数据库 & 收集静态文件

```bash
# 数据库迁移
python3 manage.py migrate --settings=bnusparks.settings_prod

# 收集静态文件（Django Admin 等）
python3 manage.py collectstatic --settings=bnusparks.settings_prod --noinput

# 创建管理员账号
python3 manage.py createsuperuser --settings=bnusparks.settings_prod
```

### 3.5 导入课程数据

```bash
# 先 seed 课程结构（如果数据库为空）
python3 seed.py

# seed 导航树
python3 seed_tree.py

# 导入已有资料（如果有的话）
# python3 manage.py import_pyfa --settings=bnusparks.settings_prod
```

### 3.6 迁移已有数据库文件（可选）

如果你在本地已有 `data/db.sqlite3` 和 `data/materials/`，用 scp 传到服务器：

```bash
# 在本地执行
scp data/db.sqlite3 deploy@<服务器IP>:/home/deploy/bnusparks/data/
scp -r data/materials/* deploy@<服务器IP>:/home/deploy/bnusparks/data/materials/
```

### 3.7 测试 Gunicorn 启动

```bash
cd /home/deploy/bnusparks
source venv/bin/activate
gunicorn bnusparks.wsgi:application \
  --env DJANGO_SETTINGS_MODULE=bnusparks.settings_prod \
  --bind 0.0.0.0:8000 \
  --workers 2 \
  --timeout 120
```

打开浏览器访问 `http://<服务器IP>:8000` 确认站点正常。
按 `Ctrl+C` 停止，接下来配置 Nginx + Supervisor 持久运行。

---

## 4. Nginx 反向代理

### 4.1 创建 Nginx 配置

```bash
sudo nano /etc/nginx/sites-available/bnusparks
```

写入：

```nginx
server {
    listen 80;
    server_name 你的域名 www.你的域名 服务器IP;

    # 前端 SPA 主入口
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 上传文件大小限制（最大 50MB）
    client_max_body_size 60M;

    # Django 静态文件（Admin 界面等）
    location /static/ {
        alias /home/deploy/bnusparks/staticfiles/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # 资料文件下载（避免直接暴露存储路径）
    location /data/ {
        internal;
        alias /home/deploy/bnusparks/data/;
    }
}
```

### 4.2 启用配置

```bash
sudo ln -s /etc/nginx/sites-available/bnusparks /etc/nginx/sites-enabled/
sudo nginx -t              # 测试配置
sudo systemctl restart nginx
```

### 4.3 如果遇到 502 错误

检查 Gunicorn 是否运行，确认 `proxy_pass` 地址一致。

---

## 5. HTTPS 证书

### 方案 A：Certbot（Let's Encrypt，推荐）

```bash
# 安装 certbot（前面已装）
sudo certbot --nginx -d 你的域名 -d www.你的域名

# 按照提示输入邮箱，同意条款
# 证书会自动续期（检查续期服务）
sudo certbot renew --dry-run
```

### 方案 B：Cloudflare（如果使用 Cloudflare DNS）

1. 在 Cloudflare 添加域名
2. 将 DNS 指向你的服务器 IP（代理状态选「Proxied」橙色云朵）
3. SSL/TLS 设置为「Full (strict)」
4. Nginx 配置同上，certbot 不需要

所有配置完成后，Nginx 中 80 端口配置会自动加上 SSL 重定向。

---

## 6. 进程守护（Supervisor）

保证 Gunicorn 始终运行、开机自启。

### 6.1 创建 Supervisor 配置

```bash
sudo nano /etc/supervisor/conf.d/bnusparks.conf
```

写入：

```ini
[program:bnusparks]
directory=/home/deploy/bnusparks
command=/home/deploy/bnusparks/venv/bin/gunicorn bnusparks.wsgi:application \
    --env DJANGO_SETTINGS_MODULE=bnusparks.settings_prod \
    --bind 127.0.0.1:8000 \
    --workers 2 \
    --timeout 120 \
    --access-logfile /home/deploy/bnusparks/logs/gunicorn_access.log \
    --error-logfile /home/deploy/bnusparks/logs/gunicorn_error.log
user=deploy
autostart=true
autorestart=true
stopasgroup=true
killasgroup=true
stdout_logfile=/home/deploy/bnusparks/logs/supervisor_out.log
stderr_logfile=/home/deploy/bnusparks/logs/supervisor_err.log
```

### 6.2 创建日志目录

```bash
mkdir -p /home/deploy/bnusparks/logs
```

### 6.3 启动

```bash
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl status bnusparks
# 应该显示：bnusparks RUNNING pid XXXX uptime X:XX:XX
```

### 6.4 常用管理命令

```bash
sudo supervisorctl stop bnusparks       # 停止
sudo supervisorctl start bnusparks      # 启动
sudo supervisorctl restart bnusparks    # 重启
sudo supervisorctl tail bnusparks       # 看日志
```

---

## 7. 一键部署脚本

首次配置完成后，日常更新只需要三步：

将以下内容保存为 `deploy.sh`（已存在于项目根目录 `scripts/deploy.sh`）：

```bash
#!/usr/bin/env bash
set -e

echo "=== BNU Sparks 部署脚本 ==="

cd /home/deploy/bnusparks

# 1. 拉取最新代码
echo "[1/4] 拉取最新代码..."
git pull origin main

# 2. 更新依赖
echo "[2/4] 更新 Python 依赖..."
source venv/bin/activate
pip install -r requirements.txt 2>/dev/null || true
# 如果没有 requirements.txt，上面的命令跳过即可

# 3. 数据库迁移
echo "[3/4] 数据库迁移..."
python3 manage.py migrate --settings=bnusparks.settings_prod

# 4. 重启服务
echo "[4/4] 重启服务..."
sudo supervisorctl restart bnusparks

echo "=== 部署完成！==="
```

> 也可以配合 Git Webhook 实现推送代码自动部署（后续可配置）。

---

## 8. 日常运维

### 8.1 查看日志

```bash
# 应用日志
sudo supervisorctl tail bnusparks
sudo supervisorctl tail bnusparks stderr

# Nginx 日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# Gunicorn 日志
tail -f /home/deploy/bnusparks/logs/gunicorn_error.log
```

### 8.2 备份数据库

```bash
# 手动备份
cp /home/deploy/bnusparks/data/db.sqlite3 /home/deploy/backups/db_$(date +%Y%m%d).sqlite3

# 建议添加到 crontab，每天自动备份
crontab -e
# 添加一行（每天凌晨 3 点备份，保留最近 30 天）：
# 0 3 * * * cp /home/deploy/bnusparks/data/db.sqlite3 /home/deploy/backups/db_$(date +\%Y\%m\%d).sqlite3 && find /home/deploy/backups -name "db_*.sqlite3" -mtime +30 -delete
```

### 8.3 更新内容

```bash
# 方式一：本地编辑 → git push
# 登录服务器运行：
cd /home/deploy/bnusparks && git pull && sudo supervisorctl restart bnusparks

# 方式二：直接在 Django Admin 后台管理
# 浏览器访问 https://你的域名/admin/
```

### 8.4 安全提醒

- 定期更新系统：`sudo apt update && sudo apt upgrade -y`
- 定期检查日志异常
- 不要将 `.git` 目录暴露到公网（Nginx 配置已避免）
- 生产环境 `DEBUG = False`

---

## 9. 附录：费用估算

### 最低成本方案（Hetzner + Cloudflare）

| 项目 | 月费 |
|------|------|
| Hetzner CX22 | €3.99 (~¥31) |
| 域名 .com | ¥5.5/月 (¥66/年) |
| **合计** | **~¥36/月** |

### 推荐方案（腾讯云轻量 + 域名）

| 项目 | 月费 |
|------|------|
| 腾讯云轻量 2C2G | ¥50 |
| 域名 .cn | ¥4/月 (¥48/年) |
| **合计** | **~¥54/月** |

### 学生优惠方案（阿里云 + 域名）

| 项目 | 月费 |
|------|------|
| 阿里云 ECS 学生机 | ~¥15 |
| 域名 .cn | ¥4/月 |
| **合计** | **~¥19/月**（需备案） |

---

> **下一步**：告诉我你选好了服务器和域名，我帮你按这个指南一步步搭建。
