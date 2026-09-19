"""
BNU Sparks — 生产环境配置（无密钥模板版；真实值走环境变量 / 服务器 .env）

服务器 .env（或环境变量）需提供：
  SECRET_KEY="..."                # settings.py 必填
  DJANGO_ALLOWED_HOSTS="你的域名,www.你的域名,服务器IP,localhost,127.0.0.1"

注意：settings.py 的 .env 解析要求「KEY="值"」双引号格式。
本地调试请使用 bnusparks/settings.py（DEBUG=True），不要用本文件。
"""
from .settings import *
import os

DEBUG = False

# 生产：文件下载/预览由 Nginx internal 转发直接送文件（需 nginx /protected/ 与
# /protected-preview/ 配置；本地/测试保持 False 走 Django FileResponse）
USE_X_ACCEL = True

ALLOWED_HOSTS = os.environ.get(
    "DJANGO_ALLOWED_HOSTS",
    _env_vars.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1"),
).split(",")

# ── HTTPS 安全头（Nginx 已处理 SSL 终止） ──
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_BROWSER_XSS_FILTER = True
SECURE_REFERRER_POLICY = 'strict-origin-when-cross-origin'
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
# X-Frame-Options 统一为 SAMEORIGIN：PDF 预览 iframe 是同源（DENY 会误伤），
# 且必须与 nginx 边缘 add_header 的值一致，避免重复头被浏览器忽略
X_FRAME_OPTIONS = 'SAMEORIGIN'
# 注意：不启用 SECURE_SSL_REDIRECT，由 Nginx 处理 HTTP→HTTPS 重定向
