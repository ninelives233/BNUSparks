# BNU Sparks 部署指南

> 从零到线上 — 国内高校资源共享平台部署方案
>
> **目标用户**：北京师范大学在校学生（主要从校园网 / 宿舍宽带访问）

---

## 目录

1. [方案选择：三个档位](#1-方案选择三个档位)
2. [域名注册](#2-域名注册)
3. [服务器初始化](#3-服务器初始化)
4. [部署应用](#4-部署应用)
5. [Nginx 反向代理](#5-nginx-反向代理)
6. [HTTPS 证书](#6-https-证书)
7. [进程守护（Supervisor）](#7-进程守护supervisor)
8. [一键部署脚本](#8-一键部署脚本)
9. [日常运维](#9-日常运维)
10. [内容合规与免责说明](#10-内容合规与免责说明)
11. [附录：费用参考](#11-附录费用参考)

---

## 1. 方案选择：三个档位

面向国内高校用户，核心要求：**国内访问快 + 稳定 + 学生预算友好**。

### 🥇 方案一：腾讯云轻量 + 域名备案（推荐 · 长期运营）

| 项目 | 内容 |
|------|------|
| 服务器 | 腾讯云轻量应用服务器 2C2G 40GB SSD |
| 价格 | **¥50/月**（新用户首年更低） |
| 域名 | `.cn` 域名 ~¥48/年 |
| 备案 | 需 ICP 备案（2-3 周） |
| 速度 | ⭐⭐⭐⭐⭐ 国内任何网络都很快 |
| 校园网 | ⭐⭐⭐⭐⭐ BNU 校园网直连无压力 |

**适合**：打算长期运营、不急这一两周上线。

### 🥈 方案二：腾讯云/阿里云香港节点（免备案 · 快速上线）

| 项目 | 内容 |
|------|------|
| 服务器 | 腾讯云轻量香港 2C2G 30GB |
| 价格 | **¥60-80/月** |
| 域名 | `.com` 或其他国际域名，**不需要备案** |
| 速度 | ⭐⭐⭐⭐ 国内延迟 ~30-50ms，校园网稍慢但可用 |
| 上线 | **买好就能上，当天搞定** |

**适合**：想尽快上线、不想等备案流程。

### 🥉 方案三：阿里云学生机（最省钱）

| 项目 | 内容 |
|------|------|
| 服务器 | 阿里云 ECS 学生认证 2C2G |
| 价格 | **~¥15/月**（学生优惠限时，通常持续 4 年） |
| 域名 | `.cn` 域名 ~¥48/年 |
| 备案 | 需 ICP 备案 |
| 速度 | ⭐⭐⭐⭐⭐ |
| 注意 | 学生机通常带宽较小（1-3Mbps），文件下载会慢一些 |

**适合**：预算紧张、不介意备案周期的学生。

### ❌ 不推荐的方案

| 方案 | 原因 |
|------|------|
| Hetzner / 海外廉价 VPS | 国内直连慢，经 CDN 后首次加载仍需 ~1-2s，校园网不稳定 |
| 直接用 IP 不配域名 | 无法上 HTTPS，浏览器报不安全；校园网可能屏蔽非标端口 |
| 局域网 NAS / 树莓派 | BNU 校园网 AP 隔离，同一设备间无法直连（已确认此问题） |

### 我的推荐

> **首选方案一（腾讯云轻量大陆节点 + `.cn` 域名 + 备案）**，备案期间先在香港节点临时跑着，备完案再迁回来。

---

## 2. 域名注册

### 2.1 域名选择

国内高校平台，`.cn` 域名是最优选择：

| 域名 | 价格 | 推荐度 | 说明 |
|------|------|--------|------|
| `bnusparks.cn` | ~¥48/年 | ⭐⭐⭐⭐⭐ | 首选，.cn 国内解析最好 |
| `bnusparks.com` | ~¥66/年 | ⭐⭐⭐⭐ | 国际化友好，但国内略逊 .cn |
| `sparks.bnu.edu.cn` | 免费 | ⭐⭐⭐⭐⭐ | **如果能申请到 BNU 二级域名，最理想** |

> **关于 `sparks.bnu.edu.cn`**：可以联系北师大信息网络中心或团委，申请一个 edu.cn 二级域名。这不仅免费、免备案、可信度高，而且对校内用户来说天然可信。如果你们平台有学校官方或学生会的支持背景，这条路最值得争取。

### 2.2 注册商推荐

| 注册商 | 适合 | 特点 |
|--------|------|------|
| **腾讯云** | 方案一（大陆服务器） | 域名 + 服务器 + 备案一站完成 |
| **阿里云** | 方案三（阿里云学生机） | 同样一站完成 |
| **Cloudflare** | 方案二（香港节点） | 成本价、自带 DNS + CDN + DDoS 防护 |
| **Namesilo** | 通用 | 老牌稳定，免费隐私保护 |

> **如果你的服务器在腾讯云/阿里云，建议在同平台注册域名**，备案、DNS 解析都能自动处理，省心很多。

### 2.3 注册步骤（以腾讯云为例）

```
1. 打开 cloud.tencent.com → 注册/登录
2. 搜索「域名注册」→ 输入 bnusparks.cn 查询
3. 加入购物车 → 结算（~¥48/年）
4. 提交域名实名认证资料（身份证）
5. 等待审核（1-3 个工作日）
6. 审核通过后在控制台 → 域名解析 → 添加记录指向服务器 IP
```

---

## 3. 服务器初始化

> 以下步骤在服务器上以 root 用户执行。所有命令兼容 Ubuntu 22.04/24.04 LTS。

### 3.1 连接服务器

```bash
ssh root<服务器 IP>
```

### 3.2 系统更新 & 安装依赖

```bash
apt update && apt upgrade -y
apt install -y python3 python3-pip python3-venv nginx git supervisor certbot python3-certbot-nginx
```

### 3.3 创建非 root 用户

```bash
adduser deploy          # 设置密码（如 bnusparks2026），其他一路回车
usermod -aG sudo deploy
su - deploy
```

### 3.4 配置防火墙

```bash
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw enable
```

### 3.5 配置 Git

```bash
git config --global user.name "BNU Sparks"
git config --global user.email "bnusparks@163.com"
```

---

## 4. 部署应用

### 4.1 克隆代码

```bash
cd /home/deploy
git clone https://github.com/ninelives233/BNUSparks.git bnusparks
cd bnusparks
```

> 使用 HTTPS 克隆（免 SSH 密钥配置），后续拉取代码同样用 HTTPS。

### 4.2 创建 Python 虚拟环境

```bash
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install django gunicorn
# 用 pip 安装，不依赖 requirements.txt
```

### 4.3 创建生产配置

```bash
nano bnusparks/settings_prod.py
```

```python
"""
BNU Sparks — 生产环境配置
"""
from .settings import *

DEBUG = False
ALLOWED_HOSTS = [
    "你的域名",           # 如 "bnusparks.cn"
    "www.你的域名",
    "服务器公网IP",
]

# 生成新密钥：python3 -c "import secrets; print(secrets.token_urlsafe(50))"
SECRET_KEY = "粘贴上面命令生成的密钥"

# 静态文件
STATIC_ROOT = BASE_DIR / "staticfiles"

# 媒体文件
MEDIA_ROOT = BASE_DIR / "data" / "materials"

# 安全配置（配好 HTTPS 后启用）
# SECURE_SSL_REDIRECT = True
# SESSION_COOKIE_SECURE = True
# CSRF_COOKIE_SECURE = True

# 日志
import logging
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "file": {
            "level": "WARNING",
            "class": "logging.FileHandler",
            "filename": BASE_DIR / "logs" / "django.log",
        },
    },
    "root": {
        "handlers": ["file"],
        "level": "WARNING",
    },
}
```

测试配置：

```bash
python3 manage.py check --settings=bnusparks.settings_prod
```

### 4.4 迁移数据库 & 收集静态文件

```bash
mkdir -p logs

python3 manage.py migrate --settings=bnusparks.settings_prod
python3 manage.py collectstatic --settings=bnusparks.settings_prod --noinput
python3 manage.py createsuperuser --settings=bnusparks.settings_prod
```

### 4.5 导入课程数据

```bash
# 导入课程结构
python3 seed.py

# 导入导航树
python3 seed_tree.py
```

### 4.6 迁移已有数据（从本地）

如果你的本地已经有数据，先压缩再传：

```bash
# 在本地 Mac 上执行
cd /Users/neun/AI/myweb
tar czf data_backup.tar.gz data/db.sqlite3 data/materials/
scp data_backup.tar.gz deploy@<服务器IP>:/home/deploy/
```

```bash
# 在服务器上解压
cd /home/deploy/bnusparks
tar xzf ../data_backup.tar.gz
```

> **⚠️ 重要**：上传的资料文件是项目核心资产，务必先迁移再上线。

### 4.7 测试 Gunicorn

```bash
source venv/bin/activate
gunicorn bnusparks.wsgi:application \
  --env DJANGO_SETTINGS_MODULE=bnusparks.settings_prod \
  --bind 0.0.0.0:8000 \
  --workers 2 \
  --timeout 120
```

浏览器访问 `http://<服务器IP>:8000` 确认正常。`Ctrl+C` 停止。

---

## 5. Nginx 反向代理

### 5.1 创建配置

```bash
sudo nano /etc/nginx/sites-available/bnusparks
```

```nginx
server {
    listen 80;
    server_name 你的域名 www.你的域名;

    # 前端 SPA 主入口
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 上传限制
    client_max_body_size 60M;

    # 静态文件（Admin 界面等）
    location /static/ {
        alias /home/deploy/bnusparks/staticfiles/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

> **注意**：这里没有 `listen 443`，HTTPS 在下一步配置。

### 5.2 启用

```bash
sudo ln -s /etc/nginx/sites-available/bnusparks /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # 删除默认站点
sudo nginx -t
sudo systemctl restart nginx
```

### 5.3 验证

浏览器访问 `http://<服务器IP>`，如果可以正常显示页面，Nginx 配置成功。

---

## 6. HTTPS 证书

> **国内平台必须上 HTTPS**，否则浏览器标记「不安全」，用户不敢用。

### 6.1 确保域名已解析到服务器

在域名注册商的控制台添加 A 记录，指向服务器 IP。

### 6.2 Certbot 申请证书

```bash
sudo certbot --nginx -d 你的域名 -d www.你的域名
```

按提示：
1. 输入邮箱（用于续期提醒）
2. 同意服务条款
3. 选择是否重定向 HTTP → HTTPS（建议选「是」）

### 6.3 验证自动续期

```bash
sudo certbot renew --dry-run
```

> Let's Encrypt 证书有效期 90 天，certbot 会自动续期，无需手动操作。

### 6.4 如果使用 Cloudflare

如果 DNS 托管在 Cloudflare 且开启了 CDN 代理（橙色云朵）：
- 在 Cloudflare SSL/TLS 设置为 **Full (strict)**
- Nginx 配置 `listen 443 ssl`，证书用 Cloudflare Origin CA 证书
- 这样 Cloudflare 会帮你管理 HTTPS，且自带 DDoS 防护

---

## 7. 进程守护（Supervisor）

### 7.1 创建配置

```bash
sudo nano /etc/supervisor/conf.d/bnusparks.conf
```

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

### 7.2 启动

```bash
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl status bnusparks
# 输出：bnusparks RUNNING pid XXXX uptime X:XX:XX
```

### 7.3 常用命令

```bash
sudo supervisorctl restart bnusparks   # 最常用：重启应用
sudo supervisorctl tail bnusparks      # 看日志
```

---

## 8. 一键部署脚本

日常代码更新只需要三步：

将以下内容保存为 `scripts/deploy.sh`：

```bash
#!/usr/bin/env bash
set -e
echo "=== BNU Sparks 部署 ==="

cd /home/deploy/bnusparks

git pull origin main
source venv/bin/activate
pip install django gunicorn 2>/dev/null || true
python3 manage.py migrate --settings=bnusparks.settings_prod
python3 manage.py collectstatic --settings=bnusparks.settings_prod --noinput

sudo supervisorctl restart bnusparks

echo "=== 完成 ==="
```

使用方式：

```bash
# 本地修改 → git push 之后
ssh deploy@服务器IP 'bash /home/deploy/bnusparks/scripts/deploy.sh'
```

---

## 9. 日常运维

### 9.1 更新代码

```bash
ssh deploy@服务器IP
cd /home/deploy/bnusparks
git pull
sudo supervisorctl restart bnusparks
```

### 9.2 查看日志

```bash
sudo supervisorctl tail bnusparks          # 最近输出
sudo supervisorctl tail bnusparks stderr   # 错误日志
sudo tail -f /var/log/nginx/access.log    # Nginx 访问日志
```

### 9.3 备份数据库

```bash
# 手动备份
cp /home/deploy/bnusparks/data/db.sqlite3 /home/deploy/backups/db_$(date +%Y%m%d).sqlite3

# 设置自动备份（每天凌晨 3 点）
crontab -e
# 添加：
0 3 * * * cp /home/deploy/bnusparks/data/db.sqlite3 /home/deploy/backups/db_$(date +\%Y\%m\%d).sqlite3 && find /home/deploy/backups -name "db_*.sqlite3" -mtime +30 -delete
```

### 9.4 管理后台

浏览器访问 `https://你的域名/admin/`，用 `createsuperuser` 创建的账号登录，可以：
- 增删改课程和分类
- 审核和管理上传的资料
- 管理导航树结构
- 查看用户数据

### 9.5 安全提醒

- 定期 `sudo apt update && sudo apt upgrade -y`
- 生产环境不允许 `DEBUG = True`
- `.git` 目录不应通过 Nginx 暴露（当前配置已避免）
- `SECRET_KEY` 使用独立生成的密钥，不要用默认值
- 如有条件，限制 Django Admin 仅允许校内 IP 访问

---

## 10. 内容合规与免责说明

作为国内高校资源共享平台，需要注意以下几点：

### 10.1 侵权风险防范

- 上传的资料应是**学生自己的笔记、整理、总结**，或**已获得授权**的资源
- 不建议上传整本教材扫描版（出版社版权问题）
- 考试真题建议做脱敏处理（隐去学生姓名、学号）

### 10.2 建议在 About 页面增加免责声明

在 `app.js` 的 `aboutContent` 中添加：

```javascript
disclaimer: {
  title: '免责声明',
  sections: [
    { heading: '📜 内容责任', text: '本平台所有资料均由用户上传，平台不承担内容版权责任。如发现侵权内容，请联系 bnusparks@163.com，我们将在 48 小时内删除。' },
    { heading: '⚖️ 合法使用', text: '本平台资源仅供学习交流使用，请勿用于商业用途。下载后请在 24 小时内删除。' },
  ]
}
```

### 10.3 备案相关（大陆服务器）

备案期间需要：
- 在网站底部注明 **ICP 备案号**（如 `京ICP备XXXXXXXX号`）
- 链接到工信部备案查询页面
- 放置 **公安备案号**（如有）

示例：

```html
<div class="footer-icp">
  <a href="https://beian.miit.gov.cn/" target="_blank">京ICP备XXXXXXXX号-1</a>
</div>
```

---

## 11. 附录：费用参考

### 方案对比总表

| 项目 | 🥇 腾讯云大陆 | 🥈 香港节点 | 🥉 阿里云学生机 |
|------|:---:|:---:|:---:|
| 服务器费用 | ¥50/月 | ¥60-80/月 | ~¥15/月 |
| 域名费用 | ¥4/月 | ¥5.5/月 | ¥4/月 |
| 备案需要 | 2-3 周 | 不需要 | 2-3 周 |
| 校园网速度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 首月投入 | ~¥250 | ~¥200 | ~¥80 |
| 长期稳定 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐（学生机有时限） |

> **首年最低成本方案**：阿里云学生认证 + `.cn` 域名 ≈ **¥228/年**（¥19/月）

---

## 快速决策流程

```
你想选哪条路？
│
├─ 有学生认证 + 不着急上线
│   └─ 阿里云学生机 + .cn 域名 → 去备案 → 部署
│
├─ 能接受 ¥50/月 + 不着急上线
│   └─ 腾讯云轻量 + .cn 域名 → 去备案 → 部署
│
├─ 想今天就上线
│   └─ 腾讯云香港轻量 + .com 域名 → 部署（免备案）
│
└─ 能联系到学校
    └─ 申请 sparks.bnu.edu.cn → 省域名费 + 免备案 + 更有公信力
```

> **当前进度**：代码已推送 GitHub + 部署文档已准备就绪。
> **下一步你决定**：选好服务器方案和域名，我指导你一步步操作。
