"""
BNU Sparks · 木铎星火 — Django 配置
"""

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# ── 安全 ──
SECRET_KEY = 'SECRET_KEY_PLACEHOLDER_REPLACED_BY_FILTER_REPO'
DEBUG = True
ALLOWED_HOSTS = ['*']

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
USE_TZ = True

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
CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_CREDENTIALS = True

# ── 文件上传限制（50MB） ──
DATA_UPLOAD_MAX_MEMORY_SIZE = 50 * 1024 * 1024

LOGIN_URL = '/admin/login/'

# ── 邮件服务（用于密码重置等） ──
import os
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = 'smtp.163.com'
EMAIL_PORT = 465
EMAIL_USE_SSL = True
EMAIL_HOST_USER = 'bnusparks@163.com'
EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_PASSWORD', '')
# 也尝试从 .env 文件读取
_env_file = BASE_DIR / '.env'
if not EMAIL_HOST_PASSWORD and _env_file.exists():
    import re
    _match = re.search(r'EMAIL_PASSWORD\s*=\s*"([^"]*)"', _env_file.read_text(encoding='utf-8'))
    if _match:
        EMAIL_HOST_PASSWORD = _match.group(1)
