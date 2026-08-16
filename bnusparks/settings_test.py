"""
BNU Sparks · 木铎星火 — 测试专用配置

继承开发配置，仅替换「故意慢」的项以加速全量回归：
  - PASSWORD_HASHERS → MD5：Django 默认 PBKDF2 每哈希 ~500ms，
    每个 BnuTestCase 测试 setUp 建 4 用户即 ~2s（384 例累计 ~10 分钟级）。
    测试内创建/校验/改密/重置全走同一哈希器，行为等价，仅快几个数量级。

用法：
  python3 manage.py test --settings=bnusparks.settings_test materials
  python3 manage.py test --settings=bnusparks.settings_test --parallel auto materials
"""

from .settings import *  # noqa: F401,F403  (生产/开发基线保持一致)

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
