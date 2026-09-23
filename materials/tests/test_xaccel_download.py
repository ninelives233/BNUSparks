"""
X-Accel-Redirect 下载测试（P3.1）

生产（USE_X_ACCEL=True）下 Django 只做鉴权/配额/计数，返回 bodyless 响应 +
X-Accel-Redirect 交给 nginx internal 送文件；开发/测试（USE_X_ACCEL=False）回退
FileResponse。本文件验证：

1. X-Accel 模式返回正确头部 + 配额/计数仍发生 + open 不被调用
2. 配额满 → 429 且无 X-Accel 头
3. 完整文件预览（preview=1）计入配额（堵 bypass）
4. PDF 切片预览走 /protected-preview/ 且免配额
5. 越界 file_path → 400
6. dev 模式无 X-Accel 头（防误泄漏）
"""

from unittest.mock import patch, mock_open
from datetime import date
from pathlib import Path

from django.conf import settings
from django.test import override_settings

from .helpers import BnuTestCase, create_material, create_course


@override_settings(USE_X_ACCEL=True)
class XAccelDownloadTest(BnuTestCase):
    """生产模式（USE_X_ACCEL=True）"""

    def setUp(self):
        super().setUp()
        self.major_course = create_course(code="LAW01003", name="法学", course_type="major")

    @patch("pathlib.Path.exists", return_value=True)
    def test_download_sets_x_accel_header_and_counts(self, mock_exists):
        mat = create_material(self.major_course, self.user, review_status="approved")
        self.client.set_token(self.user)
        resp = self.client.get(f"/api/files/{mat.id}/download/")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["X-Accel-Redirect"], f"/protected/{mat.file_path}")
        self.assertTrue(resp["Content-Disposition"].startswith("attachment"))
        self.assertEqual(resp["Content-Type"], "application/pdf")
        self.assertEqual(resp["X-Content-Type-Options"], "nosniff")
        # bodyless：nginx 负责送文件，Django 不读盘
        self.assertEqual(resp.content, b"")

        # 配额 + 下载留痕仍发生
        from ..models import DownloadRecord, UserProfile
        p = UserProfile.objects.get(user=self.user)
        self.assertEqual(p.daily_download_count, 1)
        self.assertEqual(DownloadRecord.objects.filter(user=self.user).count(), 1)
        self.assertEqual(
            DownloadRecord.objects.get(user=self.user).activity_type,
            DownloadRecord.ActivityType.DOWNLOAD,
        )

    @patch("pathlib.Path.exists", return_value=True)
    def test_quota_enforced_before_x_accel(self, mock_exists):
        mat = create_material(self.major_course, self.user, review_status="approved")
        from ..models import UserProfile
        UserProfile.objects.filter(user=self.user).update(
            daily_download_count=60, last_download_date=date.today())
        self.client.set_token(self.user)
        resp = self.client.get(f"/api/files/{mat.id}/download/")

        self.assertEqual(resp.status_code, 429)
        self.assertNotIn("X-Accel-Redirect", resp.headers)
        from ..models import DownloadRecord
        self.assertEqual(DownloadRecord.objects.filter(user=self.user).count(), 0)

    @patch("pathlib.Path.exists", return_value=True)
    def test_full_file_preview_counts_toward_quota(self, mock_exists):
        """preview=1 完整文件预览（图片）计入配额，堵住绕过下载限额的洞"""
        mat = create_material(self.major_course, self.user, review_status="approved")
        mat.file_name = "photo.png"
        mat.file_path = f"{self.major_course.code}/photo.png"
        mat.save(update_fields=["file_name", "file_path"])
        self.client.set_token(self.user)
        resp = self.client.get(f"/api/files/{mat.id}/download/?preview=1")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["X-Accel-Redirect"], f"/protected/{mat.file_path}")
        from ..models import UserProfile
        p = UserProfile.objects.get(user=self.user)
        self.assertEqual(p.daily_download_count, 1)
        from ..models import DownloadRecord
        record = DownloadRecord.objects.get(user=self.user)
        self.assertEqual(record.activity_type, DownloadRecord.ActivityType.PREVIEW)
        mat.refresh_from_db()
        self.assertEqual(mat.download_count, 0)

    @patch("pathlib.Path.exists", return_value=True)
    @patch("materials.views.files._pdf_preview_cache_path",
           return_value=Path(settings.MEDIA_ROOT).parent / ".pdf_cache" / "p1_deadbeef.pdf")
    def test_pdf_slice_preview_free_and_uses_protected_preview(self, mock_cache, mock_exists):
        """PDF 切片预览走 /protected-preview/ 且免配额"""
        mat = create_material(self.major_course, self.user, review_status="approved")
        mat.file_name = "notes.pdf"
        mat.file_path = f"{self.major_course.code}/notes.pdf"
        mat.save(update_fields=["file_name", "file_path"])
        self.client.set_token(self.user)
        resp = self.client.get(f"/api/files/{mat.id}/download/?preview=1&max_pages=3")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["X-Accel-Redirect"], "/protected-preview/.pdf_cache/p1_deadbeef.pdf")
        from ..models import UserProfile
        p = UserProfile.objects.get(user=self.user)
        self.assertEqual(p.daily_download_count, 0)

    @patch("pathlib.Path.exists", return_value=True)
    def test_traversal_file_path_rejected(self, mock_exists):
        """file_path 越界（../../）→ 400，不发 X-Accel 头"""
        mat = create_material(self.major_course, self.user, review_status="approved")
        mat.file_path = "../../etc/passwd"
        mat.save(update_fields=["file_path"])
        self.client.set_token(self.user)
        resp = self.client.get(f"/api/files/{mat.id}/download/")

        self.assertEqual(resp.status_code, 400)
        self.assertNotIn("X-Accel-Redirect", resp.headers)


class DevModeDownloadTest(BnuTestCase):
    """开发模式（USE_X_ACCEL=False，默认）—— 保持 FileResponse，无 X-Accel 头"""

    def setUp(self):
        super().setUp()
        self.major_course = create_course(code="GEN0001", name="大学语文", course_type="general")

    @patch("pathlib.Path.exists", return_value=True)
    @patch("builtins.open", new_callable=lambda: mock_open(read_data=b"dummy"))
    def test_dev_mode_never_emits_x_accel_header(self, mock_open, mock_exists):
        mat = create_material(self.major_course, self.user, review_status="approved")
        self.client.set_token(self.user)
        resp = self.client.get(f"/api/files/{mat.id}/download/")

        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("X-Accel-Redirect", resp.headers)
        # FileResponse 流式返回文件内容
        self.assertGreater(len(b"".join(resp.streaming_content)), 0)

    @patch("pathlib.Path.exists", return_value=True)
    def test_dev_mode_rejects_traversal_before_open(self, mock_exists):
        """FileResponse 回退分支必须与 X-Accel 使用同一条路径边界。"""
        mat = create_material(self.major_course, self.user, review_status="approved")
        mat.file_path = "../../outside-secret.txt"
        mat.save(update_fields=["file_path"])
        self.client.set_token(self.user)

        with patch("builtins.open") as mocked_open:
            resp = self.client.get(f"/api/files/{mat.id}/download/")

        self.assertEqual(resp.status_code, 400)
        mocked_open.assert_not_called()
        self.assertNotIn("X-Accel-Redirect", resp.headers)
