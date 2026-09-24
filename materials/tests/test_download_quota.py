"""
下载限额测试

覆盖：
  - 普通用户每天 15 次限制，第 16 次拒绝
  - 跨天重置
  - 管理员不限

直接测试 _check_download_quota 函数，避免触及真实文件系统。
"""

from datetime import date, timedelta
from unittest.mock import patch

from .helpers import BnuTestCase, create_user, create_course, create_material
from ..models import UserProfile, DownloadRecord


class DownloadQuotaTest(BnuTestCase):
    """每日 15 次下载限额测试"""

    def test_first_download_ok(self):
        """第 1 次下载 → allowed=True, remaining=14"""
        from ..views import _check_download_quota

        allowed, remaining, msg = _check_download_quota(self.user)
        self.assertTrue(allowed)
        self.assertEqual(remaining, 14)

        # 数据库已加 1
        profile = UserProfile.objects.get(user=self.user)
        self.assertEqual(profile.daily_download_count, 1)
        self.assertEqual(profile.last_download_date, date.today())

    def test_quota_exceeded(self):
        """第 16 次 → 拒绝"""
        from ..views import _check_download_quota

        # 直接修改 self.user.profile 确保缓存一致
        self.user.profile.daily_download_count = 15
        self.user.profile.last_download_date = date.today()
        self.user.profile.save()

        allowed, remaining, msg = _check_download_quota(self.user)
        self.assertFalse(allowed)
        self.assertEqual(remaining, 0)
        self.assertIn("上限", msg)

    def test_exactly_15th_ok(self):
        """第 15 次 → 允许"""
        from ..views import _check_download_quota

        self.user.profile.daily_download_count = 14
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

        self.user.profile.daily_download_count = 15
        self.user.profile.last_download_date = date.today() - timedelta(days=1)
        self.user.profile.save()

        allowed, remaining, msg = _check_download_quota(self.user)
        self.assertTrue(allowed)
        self.assertEqual(remaining, 14)

    def test_same_file_dedup(self):
        """同一天同一文件只计一次数：第二次下载同一文件不重复扣配额"""
        from ..views import _check_download_quota

        course = create_course()
        mat = create_material(course, self.user)

        allowed, remaining, _ = _check_download_quota(self.user, mat)
        self.assertTrue(allowed)
        self.assertEqual(remaining, 14)  # 第一次：count 0→1
        # 模拟调用方 _increment_download 已创建 DownloadRecord
        DownloadRecord.objects.create(
            user=self.user, material=mat,
            course_code=course.code, course_name=course.name,
            material_title=mat.title, file_name=mat.file_name,
        )

        allowed, remaining, _ = _check_download_quota(self.user, mat)
        self.assertTrue(allowed)
        self.assertEqual(remaining, 14)  # 同一文件，不重复计数
        self.assertEqual(
            UserProfile.objects.get(user=self.user).daily_download_count, 1,
            "同一文件重复下载不应再扣配额",
        )

    def test_same_file_allowed_at_limit(self):
        """已达 15 个不同文件上限后，重下当天已下载过的文件仍放行（已计过数）"""
        from ..views import _check_download_quota

        course = create_course()
        mat = create_material(course, self.user)
        DownloadRecord.objects.create(
            user=self.user, material=mat,
            course_code=course.code, course_name=course.name,
            material_title=mat.title, file_name=mat.file_name,
        )
        self.user.profile.daily_download_count = 15
        self.user.profile.last_download_date = date.today()
        self.user.profile.save()

        allowed, remaining, _ = _check_download_quota(self.user, mat)
        self.assertTrue(allowed, "已计过数的文件重下应放行，不占新配额")
