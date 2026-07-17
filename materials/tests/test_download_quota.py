"""
下载限额测试

覆盖：
  - 普通用户每天 60 次限制，第 61 次拒绝
  - 跨天重置
  - 管理员不限

直接测试 _check_download_quota 函数，避免触及真实文件系统。
"""

from datetime import date, timedelta
from unittest.mock import patch

from .helpers import BnuTestCase, create_user
from ..models import UserProfile


class DownloadQuotaTest(BnuTestCase):
    """每日 60 次下载限额测试"""

    def test_first_download_ok(self):
        """第 1 次下载 → allowed=True, remaining=59"""
        from ..views import _check_download_quota

        allowed, remaining, msg = _check_download_quota(self.user)
        self.assertTrue(allowed)
        self.assertEqual(remaining, 59)

        # 数据库已加 1
        profile = UserProfile.objects.get(user=self.user)
        self.assertEqual(profile.daily_download_count, 1)
        self.assertEqual(profile.last_download_date, date.today())

    def test_quota_exceeded(self):
        """第 61 次 → 拒绝"""
        from ..views import _check_download_quota

        # 直接修改 self.user.profile 确保缓存一致
        self.user.profile.daily_download_count = 60
        self.user.profile.last_download_date = date.today()
        self.user.profile.save()

        allowed, remaining, msg = _check_download_quota(self.user)
        self.assertFalse(allowed)
        self.assertEqual(remaining, 0)
        self.assertIn("上限", msg)

    def test_exactly_60th_ok(self):
        """第 60 次 → 允许"""
        from ..views import _check_download_quota

        self.user.profile.daily_download_count = 59
        self.user.profile.last_download_date = date.today()
        self.user.profile.save()

        allowed, remaining, msg = _check_download_quota(self.user)
        self.assertTrue(allowed)
        self.assertEqual(remaining, 0)

    def test_admin_not_limited(self):
        """管理员不限"""
        from ..views import _check_download_quota

        self.admin.profile.daily_download_count = 999
        self.admin.profile.save()

        allowed, remaining, msg = _check_download_quota(self.admin)
        self.assertTrue(allowed)
        self.assertEqual(remaining, -1)  # 管理员返回 -1

    def test_quota_resets_next_day(self):
        """跨天重置：last_download_date=昨天 → 限额重置"""
        from ..views import _check_download_quota

        self.user.profile.daily_download_count = 60
        self.user.profile.last_download_date = date.today() - timedelta(days=1)
        self.user.profile.save()

        allowed, remaining, msg = _check_download_quota(self.user)
        self.assertTrue(allowed)
        self.assertEqual(remaining, 59)
