"""
BNU Sparks · 木铎星火 — Django 配置
"""

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# ── 安全 ──
import os
import re

_env_file = BASE_DIR / '.env'
_env_vars = {}
if _env_file.exists():
    _text = _env_file.read_text(encoding='utf-8')
    for _m in re.finditer(r'^(\w+)\s*=\s*"([^"]*)"', _text, re.MULTILINE):
        _env_vars[_m.group(1)] = _m.group(2)

SECRET_KEY = os.environ.get('SECRET_KEY') or _env_vars.get('SECRET_KEY', '')
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY 未设置！请写入 .env 或环境变量")

DEBUG = True
ALLOWED_HOSTS = ['localhost', '127.0.0.1']

# ── 应用 ──
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'corsheaders',
    'materials',
    'django_cleanup',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'bnusparks.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'bnusparks.wsgi.application'

# ── 数据库 ──
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'data' / 'db.sqlite3',
    }
}

# ── 密码验证 ──
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# ── 国际化 ──
LANGUAGE_CODE = 'zh-hans'
TIME_ZONE = 'Asia/Shanghai'
USE_I18N = True
USE_TZ = False

# ── 静态文件（前端页面） ──
STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [
    ('', BASE_DIR / 'public'),
]

# ── 用户上传文件 ──
MEDIA_URL = 'media/'
MEDIA_ROOT = BASE_DIR / 'data' / 'materials'

# ── CORS ──
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOWED_ORIGINS = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://bnusparks.cn",
    "http://www.bnusparks.cn",
    "https://bnusparks.cn",
    "https://www.bnusparks.cn",
]

# ── 文件上传限制（50MB） ──
DATA_UPLOAD_MAX_MEMORY_SIZE = 50 * 1024 * 1024

LOGIN_URL = '/admin/login/'

# ── 邮件服务（用于密码重置等） ──
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = 'smtp.163.com'
EMAIL_PORT = 465
EMAIL_USE_SSL = True
EMAIL_HOST_USER = 'bnusparks@163.com'
EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_PASSWORD') or _env_vars.get('EMAIL_PASSWORD', '')
