"""v=167 加固测试：D17 前缀匹配移除 / D19 下载令牌会话绑定与签发授权

D18（软删除+暂存+恢复）的用例见 test_delete_restore.py。
"""

import tempfile
from pathlib import Path

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test.utils import override_settings

from .helpers import (
    BnuTestCase, AuthClient, create_user, create_college, create_course,
    create_material,
)
from ..models import Material


class PrefixMatchRemovedTest(BnuTestCase):
    """D17：上传不再前缀匹配，杜绝目录/课程挂错"""

    def setUp(self):
        super().setUp()
        self.college = create_college("数学科学学院", "math")
        self.course = create_course(
            "MATH101", "数学分析",
            college=self.college, course_type="major",
        )

    @override_settings(MEDIA_ROOT=tempfile.mkdtemp())
    def test_upload_with_prefix_code_rejected(self):
        """前缀代码不再静默命中已有课程 → 400 课程不存在"""
        self.client.set_token(self.user)
        fake_file = SimpleUploadedFile("t.pdf", b"%PDF-1.4", content_type="application/pdf")
        resp = self.client.post("/api/files/upload/", {
            "course_code": "MATH", "title": "笔记", "teacher": "王老师", "file": fake_file,
        })
        self.assertEqual(resp.status_code, 400)
        self.assertIn("课程不存在", resp.json().get("error", ""))

    @override_settings(MEDIA_ROOT=tempfile.mkdtemp())
    def test_upload_exact_code_still_works(self):
        """精确代码上传正常，磁盘目录使用真实课程代码"""
        self.client.set_token(self.user)
        fake_file = SimpleUploadedFile("t.pdf", b"%PDF-1.4", content_type="application/pdf")
        resp = self.client.post("/api/files/upload/", {
            "course_code": "MATH101", "title": "笔记", "teacher": "王老师", "file": fake_file,
        })
        self.assertEqual(resp.status_code, 200)
        m = Material.objects.filter(course=self.course).first()
        self.assertIsNotNone(m)
        self.assertTrue(m.file_path.startswith("MATH101/"), "目录应使用真实课程代码")


class DownloadTokenHardeningTest(BnuTestCase):
    """D19：未审核资料会话绑定；已审核资料支持同 IP 跨浏览器移交。"""

    def setUp(self):
        super().setUp()
        self.college = create_college("数学科学学院", "math")
        self.course = create_course(
            "MATH101", "数学分析",
            college=self.college, course_type="major",
        )
        self.other = create_user("other1", role="user", first_name="路人")

    def _approved_material(self):
        mat = create_material(self.course, self.user, review_status="approved")
        p = Path(settings.MEDIA_ROOT) / mat.file_path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"%PDF-1.4 test content")
        return mat

    def test_token_denied_for_pending_file_to_stranger(self):
        """未批准资料：第三方无法获取下载令牌"""
        mat = create_material(self.course, self.user, review_status="pending")
        self.client.set_token(self.other)
        resp = self.client.get_json(f"/api/files/{mat.id}/download-token/")
        self.assertEqual(resp.status_code, 403)

    def test_token_allowed_for_pending_file_to_uploader(self):
        """未批准资料：上传者可获取令牌（待审核 1 分钟窗口）"""
        mat = create_material(self.course, self.user, review_status="pending")
        self.client.set_token(self.user)
        resp = self.client.get_json(f"/api/files/{mat.id}/download-token/")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["data"]["token"])

    @override_settings(MEDIA_ROOT=tempfile.mkdtemp())
    def test_approved_download_token_handoffs_to_new_browser_on_same_ip(self):
        """微信签发、同 IP 系统浏览器无 cookie 也可消费已审核资料令牌。"""
        mat = self._approved_material()
        # 签发令牌（带 JWT，同时建立 session）
        self.client.set_token(self.user)
        resp = self.client.get_json(f"/api/files/{mat.id}/download-token/")
        self.assertEqual(resp.status_code, 200)
        token = resp.json()["data"]["token"]

        # 去掉 JWT，模拟纯 URL 导航（同一浏览器，携带 session cookie）
        self.client.defaults.pop("HTTP_AUTHORIZATION", None)
        url = f"/api/files/{mat.id}/download/?dtoken={token}"
        ok = self.client.get(url)
        self.assertEqual(ok.status_code, 200, "同会话应能下载")

        # 系统浏览器：全新客户端，无 cookie/JWT，但设备出口 IP 相同。
        other_client = AuthClient()
        handed_off = other_client.get(url)
        self.assertEqual(handed_off.status_code, 200)

        # 两个浏览器重放同一令牌只产生一条流水、一次正式下载计数。
        from ..models import DownloadRecord
        mat.refresh_from_db()
        self.assertEqual(mat.download_count, 1)
        self.assertEqual(DownloadRecord.objects.filter(material=mat).count(), 1)

        # 换出口 IP 后令牌不可用，降低 URL 被转发的风险。
        different_ip = AuthClient()
        rejected = different_ip.get(url, REMOTE_ADDR="198.51.100.23")
        self.assertEqual(rejected.status_code, 401)
