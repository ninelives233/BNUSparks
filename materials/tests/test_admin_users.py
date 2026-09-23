"""管理后台用户列表：角色分类过滤 + 头像字段（v=135）"""

from django.test import TestCase
from django.contrib.auth.models import User

from .helpers import AuthClient
from ..models import DownloadRecord, UserProfile


class AdminUsersRoleFilterTest(TestCase):
    def setUp(self):
        self.c = AuthClient()
        # 总管理员（访问用户列表需要 super_admin）
        self.admin = User.objects.create_user(
            username="boss", email="boss@bnu.edu.cn",
            password="password123", first_name="总管理",
            is_active=True,
        )
        UserProfile.objects.create(user=self.admin, role=UserProfile.Role.SUPER_ADMIN)
        # 各类角色用户
        self.moderator = User.objects.create_user(
            username="moderator1", email="moderator1@bnu.edu.cn",
            password="password123", first_name="版主甲", is_active=True,
        )
        UserProfile.objects.create(user=self.moderator, role=UserProfile.Role.MODERATOR)
        self.sub_mod = User.objects.create_user(
            username="submod1", email="submod1@bnu.edu.cn",
            password="password123", first_name="小版主甲", is_active=True,
        )
        UserProfile.objects.create(user=self.sub_mod, role=UserProfile.Role.SUB_MODERATOR)
        self.regular = User.objects.create_user(
            username="user1", email="user1@bnu.edu.cn",
            password="password123", first_name="普通甲", is_active=True,
        )
        UserProfile.objects.create(user=self.regular, role=UserProfile.Role.USER)
        self.c.set_token(self.admin)

    def _fetch(self, query=""):
        return self.c.get_json(f"/api/admin/users/?{query}")

    def test_payload_includes_avatar_url(self):
        """用户列表应返回 avatar_url 字段（无头像时为空串）"""
        r = self._fetch()
        self.assertEqual(r.status_code, 200)
        users = r.json()["data"]["users"]
        for u in users:
            self.assertIn("avatar_url", u)
            self.assertEqual(u["avatar_url"], "")

    def test_payload_includes_identity_tags_for_user_list(self):
        self.regular.profile.identity_education = "本科"
        self.regular.profile.identity_college = "文学院"
        self.regular.profile.identity_major = "汉语言文学"
        self.regular.profile.save(update_fields=["identity_education", "identity_college", "identity_major"])
        r = self._fetch()
        self.assertEqual(r.status_code, 200)
        row = next(u for u in r.json()["data"]["users"] if u["id"] == self.regular.id)
        self.assertEqual(
            (row["education"], row["college"], row["major"]),
            ("本科", "文学院", "汉语言文学"),
        )

    def test_payload_separates_downloads_and_previews(self):
        DownloadRecord.objects.create(user=self.regular, activity_type=DownloadRecord.ActivityType.DOWNLOAD)
        DownloadRecord.objects.create(user=self.regular, activity_type=DownloadRecord.ActivityType.LEGACY)
        DownloadRecord.objects.create(user=self.regular, activity_type=DownloadRecord.ActivityType.PREVIEW)
        r = self._fetch()
        row = next(u for u in r.json()["data"]["users"] if u["id"] == self.regular.id)
        self.assertEqual(row["download_count"], 2)
        self.assertEqual(row["preview_count"], 1)

    def test_role_filter_admin(self):
        """?role=admin 仅返回管理员（版主/小版主/总管理员）"""
        r = self._fetch("role=admin")
        self.assertEqual(r.status_code, 200)
        roles = {u["role"] for u in r.json()["data"]["users"]}
        self.assertNotIn(UserProfile.Role.USER, roles)
        self.assertIn(UserProfile.Role.MODERATOR, roles)
        self.assertIn(UserProfile.Role.SUB_MODERATOR, roles)
        self.assertIn(UserProfile.Role.SUPER_ADMIN, roles)

    def test_role_filter_user(self):
        """?role=user 仅返回普通用户"""
        r = self._fetch("role=user")
        self.assertEqual(r.status_code, 200)
        roles = {u["role"] for u in r.json()["data"]["users"]}
        self.assertEqual(roles, {UserProfile.Role.USER})

    def test_no_filter_returns_all(self):
        r = self._fetch()
        users = r.json()["data"]["users"]
        roles = {u["role"] for u in users}
        self.assertEqual(
            roles,
            {UserProfile.Role.USER, UserProfile.Role.MODERATOR,
             UserProfile.Role.SUB_MODERATOR, UserProfile.Role.SUPER_ADMIN},
        )
