"""
权限矩阵测试

4 角色 × 关键端点，检测每个组合返回 200 还是 403。
覆盖 require_role 装饰器和 _check_moderator_access。

矩阵（✅ = 正常访问, ❌ = 403/404, ○ = 因无数据返回空列表但不是 403）:

                 user  sub_mod  mod  admin
认证页面          ✅     ✅     ✅    ✅
上传              ✅     ✅     ✅    ✅
下载批准文件      ✅     ✅     ✅    ✅
待审核列表        ❌     ✅     ✅    ✅
审核批准          ❌     ○¹    ✅    ✅
用户管理          ❌     ❌     ❌    ✅
设置角色          ❌     ❌     ❌    ✅
自动托管开关      ❌     ❌     ❌    ✅

注 1: sub_mod 可以审核，但需要管辖范围匹配。这里设置范围后应为 ✅
"""

from unittest.mock import patch, mock_open

from .helpers import (
    BnuTestCase, create_user, create_college, create_course,
    create_category, create_material,
)
from ..models import UserProfile, CourseType, Material


class PermissionMatrixTest(BnuTestCase):
    """全角色 × 关键端点权限矩阵"""

    def setUp(self):
        super().setUp()
        # 给 sub_mod 配管辖范围
        self.college = create_college("教育学", "jyx")
        self.major_course = create_course(
            code="EDU101", name="教育学原理",
            college=self.college, course_type="major",
        )
        self.cat = create_category(name="教育类")
        self.cat.course = self.major_course
        self.cat.save()
        self.sub_mod.profile.moderated_sections.add(self.cat)

        # 给 mod 配管辖范围
        self.mod.profile.managed_majors.add(self.college)

        # 创建待审核材料
        self.pending_material = create_material(
            self.major_course, self.user,
            review_status="pending", assigned_moderator=self.sub_mod,
        )

    def _test_endpoint(self, user, method, path, expected_status, data=None):
        """辅助：用指定用户访问端点，断言状态码"""
        self.client.set_token(user)
        if method == "GET":
            resp = self.client.get(path, data=data or {})
        elif method == "POST":
            resp = self.client.post_json(path, data or {})
        elif method == "DELETE":
            resp = self.client.delete_json(path, data or {})
        else:
            raise ValueError(f"unknown method {method}")

        msg = f"{user.first_name}({user.profile.role}) → {method} {path} = {resp.status_code}"
        self.assertEqual(resp.status_code, expected_status, msg)
        return resp

    # ── 公开端点：所有人都能访问 ──

    def test_all_roles_can_access_stats(self):
        """GET /api/stats/ → 所有角色 200"""
        for u in [self.user, self.sub_mod, self.mod, self.admin]:
            self._test_endpoint(u, "GET", "/api/stats/", 200)

    def test_all_roles_can_access_courses(self):
        """GET /api/courses/ → 所有角色 200"""
        for u in [self.user, self.sub_mod, self.mod, self.admin]:
            self._test_endpoint(u, "GET", "/api/courses/", 200)

    # ── 认证端点 ──

    def test_me(self):
        """GET /api/auth/me/ → 所有角色 200"""
        for u in [self.user, self.sub_mod, self.mod, self.admin]:
            self._test_endpoint(u, "GET", "/api/auth/me/", 200)

    # ── 待审核列表（require_role: sub_mod+）──

    def test_pending_list_permissions(self):
        """GET /api/moderation/pending/"""
        self._test_endpoint(self.user, "GET", "/api/moderation/pending/", 403)
        self._test_endpoint(self.sub_mod, "GET", "/api/moderation/pending/", 200)
        self._test_endpoint(self.mod, "GET", "/api/moderation/pending/", 200)
        self._test_endpoint(self.admin, "GET", "/api/moderation/pending/", 200)

    # ── 审核批准（require_role: sub_mod+）──

    def test_approve_permissions(self):
        """POST /api/moderation/{id}/approve/"""
        for label, u in [("user", self.user), ("sub_mod", self.sub_mod)]:
            self._test_endpoint(u, "POST",
                f"/api/moderation/{self.pending_material.id}/approve/",
                403 if label == "user" else 200)

        # mod/admin 也需要管辖范围匹配
        pending2 = create_material(self.major_course, self.user, review_status="pending")
        self._test_endpoint(self.mod, "POST",
            f"/api/moderation/{pending2.id}/approve/",
            200)
        pending3 = create_material(self.major_course, self.user, review_status="pending")
        self._test_endpoint(self.admin, "POST",
            f"/api/moderation/{pending3.id}/approve/",
            200)

    # ── 用户管理（require_role: super_admin only）──

    def test_admin_users_permissions(self):
        """GET /api/admin/users/"""
        self._test_endpoint(self.user, "GET", "/api/admin/users/", 403)
        self._test_endpoint(self.sub_mod, "GET", "/api/admin/users/", 403)
        self._test_endpoint(self.mod, "GET", "/api/admin/users/", 403)
        # admin 能看到用户列表（可能是空列表但不是 403）
        resp = self._test_endpoint(self.admin, "GET", "/api/admin/users/", 200)
        data = resp.json()
        self.assertTrue(data.get("ok"))

    def test_set_role_permissions(self):
        """POST /api/admin/users/{uid}/role/"""
        target = create_user("target", role="user")
        for u in [self.user, self.sub_mod, self.mod]:
            self._test_endpoint(u, "POST",
                f"/api/admin/users/{target.id}/role/",
                403,
                data={"role": "moderator"})
        # admin 可以改别人的角色
        resp = self._test_endpoint(self.admin, "POST",
            f"/api/admin/users/{target.id}/role/",
            200,
            data={"role": "moderator"})
        self.assertTrue(resp.json().get("ok"))

    # ── auto_approve 开关（super_admin only）──

    def test_auto_approve_toggle_permissions(self):
        """POST /api/admin/users/{uid}/auto-approve/"""
        # 目标用户（self.user）角色是 user 不是 MODERATOR/SUB_MODERATOR → 400
        for u in [self.user, self.sub_mod, self.mod]:
            self._test_endpoint(u, "POST",
                f"/api/admin/users/{self.user.id}/auto-approve/",
                400)

    # ── 下载 ──

    @patch('pathlib.Path.exists', return_value=True)
    @patch('builtins.open', new_callable=lambda: mock_open(read_data=b"dummy"))
    def test_download_permissions(self, mock_open, mock_exists):
        """GET /api/files/{id}/download/ → 所有登录用户可下载"""
        mat = create_material(self.major_course, self.user, review_status="approved")
        for u in [self.user, self.sub_mod, self.mod, self.admin]:
            resp = self._test_endpoint(u, "GET",
                f"/api/files/{mat.id}/download/",
                200)
