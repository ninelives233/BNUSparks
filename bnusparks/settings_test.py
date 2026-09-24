"""
BNU Sparks · 木铎星火 — 测试专用配置

继承开发配置，但将数据库、上传、日志、静态产物和邮件隔离到测试环境。
密码哈希使用 MD5 加快回归；测试进程退出时清理临时目录。
  - PASSWORD_HASHERS → MD5：Django 默认 PBKDF2 每哈希 ~500ms，
    每个 BnuTestCase 测试 setUp 建 4 用户即 ~2s（384 例累计 ~10 分钟级）。
    测试内创建/校验/改密/重置全走同一哈希器，行为等价，仅快几个数量级。

用法：
  python3 manage.py test --settings=bnusparks.settings_test materials
  python3 manage.py test --settings=bnusparks.settings_test --parallel auto materials
"""

import os
import tempfile
from pathlib import Path


os.environ.setdefault("SECRET_KEY", "bnusparks-local-tests-only")

from .settings import *  # noqa: E402,F401,F403  (继承应用配置)


_TEST_STORAGE = tempfile.TemporaryDirectory(prefix="bnusparks_tests_")
_TEST_ROOT = Path(_TEST_STORAGE.name)
MEDIA_ROOT = _TEST_ROOT / "materials"
MEDIA_ROOT.mkdir()
STATIC_ROOT = _TEST_ROOT / "staticfiles"
DATABASES["default"]["NAME"] = _TEST_ROOT / "db.sqlite3"
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
