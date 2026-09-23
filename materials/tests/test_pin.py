"""文件置顶 API 测试（v177：Material.is_pinned 管理模式置顶）"""

from django.test import TestCase

from .helpers import (
    BnuTestCase, create_college, create_course, create_category,
    create_material,
)


class FilePinTest(BnuTestCase):
    """置顶/取消置顶 + 权限 + 序列化/排序"""

    def setUp(self):
        super().setUp()
        self.college = create_college("数学", "sx")
        self.course = create_course("MATH201", "概率论",
            college=self.college, course_type="major")
        create_category(name="数学类")
        # 版主管辖该学院
        self.mod.profile.managed_majors.add(self.college)

    def _pin(self, mat, pinned, user=None):
        self.client.set_token(user or self.mod)
        return self.client.post_json(f"/api/files/{mat.id}/pin/", {"pinned": pinned})

    def test_moderator_pin_own_scope(self):
        """版主置顶辖区文件 → 200，is_pinned=True，pinned_at 非空"""
        mat = create_material(self.course, self.user, review_status="approved")
        resp = self._pin(mat, True)
        self.assertEqual(resp.status_code, 200, resp.json())
        self.assertEqual(resp.json()["data"]["is_pinned"], True)
        mat.refresh_from_db()
        self.assertTrue(mat.is_pinned)
        self.assertIsNotNone(mat.pinned_at)

    def test_unpin_resets_pinned_at(self):
        """取消置顶 → is_pinned=False 且 pinned_at 清空"""
        mat = create_material(self.course, self.user, review_status="approved")
        self._pin(mat, True)
        resp = self._pin(mat, False)
        self.assertEqual(resp.status_code, 200, resp.json())
        self.assertEqual(resp.json()["data"]["is_pinned"], False)
        mat.refresh_from_db()
        self.assertFalse(mat.is_pinned)
        self.assertIsNone(mat.pinned_at)

    def test_regular_user_forbidden(self):
        """普通 user（非上传者）置顶 → 403（管理动作 admin-only）"""
        mat = create_material(self.course, self.user, review_status="approved")
        resp = self._pin(mat, True, user=self.user)
        self.assertEqual(resp.status_code, 403)
        mat.refresh_from_db()
        self.assertFalse(mat.is_pinned)

    def test_super_admin_pin(self):
        """总管理员可置顶任意文件"""
        mat = create_material(self.course, self.user, review_status="approved")
        resp = self._pin(mat, True, user=self.admin)
        self.assertEqual(resp.status_code, 200, resp.json())

    def test_method_not_allowed(self):
        """GET 置顶 URL → 405"""
        mat = create_material(self.course, self.user, review_status="approved")
        self.client.set_token(self.mod)
        resp = self.client.get(f"/api/files/{mat.id}/pin/")
        self.assertEqual(resp.status_code, 405)

    def test_unauthenticated_401(self):
        """未登录 → 401"""
        mat = create_material(self.course, self.user, review_status="approved")
        resp = self.client.post_json(f"/api/files/{mat.id}/pin/", {"pinned": True})
        self.assertEqual(resp.status_code, 401)

    def test_missing_pinned_param(self):
        """缺少 pinned 参数 → 400"""
        mat = create_material(self.course, self.user, review_status="approved")
        self.client.set_token(self.mod)
        resp = self.client.post_json(f"/api/files/{mat.id}/pin/", {})
        self.assertEqual(resp.status_code, 400)

    def test_string_boolean_tolerance(self):
        """字符串态 pinned 兼容（v176 教训）："false" 不得被 bool() 误判为 True"""
        mat = create_material(self.course, self.user, review_status="approved")
        # 字符串 "false" → 取消置顶（先置顶再发字符串 false）
        self._pin(mat, True)
        self.client.set_token(self.mod)
        resp = self.client.post(
            f"/api/files/{mat.id}/pin/",
            data='{"pinned": "false"}',
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200, resp.json())
        mat.refresh_from_db()
        self.assertFalse(mat.is_pinned)

    def test_list_serializer_and_pinned_first(self):
        """文件列表带 is_pinned 且默认排序置顶优先"""
        a = create_material(self.course, self.user, review_status="approved")
        b = create_material(self.course, self.user, review_status="approved")
        c = create_material(self.course, self.user, review_status="approved")
        a.title, c.title = "普通A", "普通C"
        a.save(update_fields=["title"]); c.save(update_fields=["title"])
        b.title = "置顶B"
        b.save(update_fields=["title"])
        self._pin(b, True)

        self.client.set_token(self.mod)
        resp = self.client.get_json(f"/api/courses/{self.course.code}/files/")
        self.assertEqual(resp.status_code, 200)
        items = resp.json()["data"]
        self.assertEqual(len(items), 3)
        # 每项都带 is_pinned
        self.assertTrue(all("is_pinned" in it for it in items))
        # 置顶文件排最前
        self.assertEqual(items[0]["title"], "置顶B")
        self.assertTrue(items[0]["is_pinned"])
        # 其余按 -created_at
        pinned_titles = [it["title"] for it in items if it["is_pinned"]]
        self.assertEqual(pinned_titles, ["置顶B"])

    def test_detail_serializer_has_is_pinned(self):
        """文件详情带 is_pinned"""
        mat = create_material(self.course, self.user, review_status="approved")
        self._pin(mat, True)
        self.client.set_token(self.mod)
        resp = self.client.get_json(f"/api/files/{mat.id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["data"]["is_pinned"])


class FileViewCountTest(BnuTestCase):
    """资料详情页浏览量：每次成功打开计一次 PV，仅已审核资料可计数。"""

    def setUp(self):
        super().setUp()
        self.course = create_course("GEN2001", "大学英语进阶", course_type="general")

    def test_view_counts_each_detail_open(self):
        mat = create_material(self.course, self.user, review_status="approved")
        self.client.set_token(self.user)

        first = self.client.post_json(f"/api/files/{mat.id}/view/")
        second = self.client.post_json(f"/api/files/{mat.id}/view/")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["data"]["view_count"], 1)
        self.assertEqual(second.json()["data"]["view_count"], 2)
        mat.refresh_from_db()
        self.assertEqual(mat.view_count, 2)

        detail = self.client.get_json(f"/api/files/{mat.id}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["data"]["view_count"], 2)

    def test_unapproved_material_does_not_count(self):
        mat = create_material(self.course, self.user, review_status="pending")
        self.client.set_token(self.user)

        response = self.client.post_json(f"/api/files/{mat.id}/view/")

        self.assertEqual(response.status_code, 404)
        mat.refresh_from_db()
        self.assertEqual(mat.view_count, 0)
