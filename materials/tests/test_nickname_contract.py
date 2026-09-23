"""回归测试：PATCH /api/auth/profile/ 改昵称契约（v=130 修复）

历史 Bug：后端 PATCH 只返回 {message, changed}，前端读 data.nickname 为 undefined，
导致 charAt 抛错 + 昵称需刷新才能显示。
"""

from django.test import TestCase
from django.contrib.auth.models import User

from .helpers import AuthClient, create_course, create_material
from ..models import UserProfile, Material


class NicknameContractTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="2021test01", email="2021test01@mail.bnu.edu.cn",
            password="password123", first_name="旧昵称",
        )
        UserProfile.objects.create(user=self.user)
        self.c = AuthClient()
        self.c.set_token(self.user)

    def test_patch_returns_nickname(self):
        """PATCH 成功后响应必须包含 nickname，前端可直接用，无需刷新"""
        r = self.c.patch_json("/api/auth/profile/", {"nickname": "新昵称"})
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(data.get("ok"))
        self.assertEqual(data["data"].get("nickname"), "新昵称")

    def test_patch_persists_to_db(self):
        """昵称真实写入 first_name"""
        self.c.patch_json("/api/auth/profile/", {"nickname": "新昵称"})
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, "新昵称")

    def test_get_returns_nickname(self):
        """GET 序列化仍一致"""
        r = self.c.get_json("/api/auth/profile/")
        data = r.json()["data"]
        self.assertEqual(data["nickname"], "旧昵称")

    def test_nickname_change_syncs_uploader_name(self):
        """改昵称后，已上传资料的冗余 uploader_name 字段同步更新（v=133 修复）"""
        course = create_course(code="GEN0001", name="大学语文")
        mat = create_material(course, self.user, review_status="approved")
        self.assertEqual(mat.uploader_name, "旧昵称")
        r = self.c.patch_json("/api/auth/profile/", {"nickname": "新昵称"})
        self.assertEqual(r.status_code, 200)
        mat.refresh_from_db()
        self.assertEqual(mat.uploader_name, "新昵称")

    def test_file_list_uses_live_name_when_redundant_stale(self):
        """存量脏数据（冗余字段是旧昵称）时，文件列表优先返回实时昵称"""
        course = create_course(code="GEN0001", name="大学语文")
        create_material(course, self.user, review_status="approved")
        # 模拟本修复之前的存量数据：uploader_name 未随改昵称更新
        Material.objects.filter(course=course).update(uploader_name="过期昵称")
        self.user.first_name = "新昵称"
        self.user.save()
        r = self.c.get_json(f"/api/courses/{course.code}/files/")
        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertEqual(data[0]["uploader"], "新昵称")
