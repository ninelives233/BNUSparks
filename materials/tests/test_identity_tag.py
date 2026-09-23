"""身份标签（培养层次 + 学院 + 专业）测试。

注册携带 college/major、profile 修改与每日限改、公开资料开关门控。
"""

import json

from django.test import TestCase
from django.contrib.auth.models import User

from .helpers import AuthClient
from ..models import UserProfile


class IdentityRegisterTest(TestCase):
    def setUp(self):
        self.c = AuthClient()

    def _register(self, education="本科", college="经济与工商管理学院", major="工商管理"):
        sid = "20990099"
        r = self.c.post_json("/api/auth/register/", {
            "email": sid + "@mail.bnu.edu.cn",
            "nickname": "新生",
            "password": "password123",
            "education": education,
            "college": college,
            "major": major,
        })
        return r

    def test_register_with_identity_stores_fields(self):
        r = self._register()
        self.assertEqual(r.status_code, 200, r.content)
        u = User.objects.get(username="20990099@mail.bnu.edu.cn")
        p = u.profile
        self.assertEqual(p.identity_education, "本科")
        self.assertEqual(p.identity_college, "经济与工商管理学院")
        self.assertEqual(p.identity_major, "工商管理")
        # 注册初始设置不占用每日一次修改额度
        self.assertIsNone(p.identity_updated_at)

    def test_register_with_other_keeps_real_labels(self):
        r = self._register(education="其他", college="其他", major="其他")
        self.assertEqual(r.status_code, 200, r.content)
        u = User.objects.get(username="20990099@mail.bnu.edu.cn")
        self.assertEqual(u.profile.identity_education, "其他")
        self.assertEqual(u.profile.identity_college, "其他")
        self.assertEqual(u.profile.identity_major, "其他")

    def test_register_without_identity_is_rejected(self):
        r = self.c.post_json("/api/auth/register/", {
            "email": "20990098@mail.bnu.edu.cn",
            "nickname": "无身份",
            "password": "password123",
        })
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("均为必选项", r.json()["error"])
        self.assertFalse(User.objects.filter(username="20990098@mail.bnu.edu.cn").exists())


class IdentityProfileTest(TestCase):
    def setUp(self):
        from .helpers import create_user
        self.c = AuthClient()
        self.user = create_user("identuser", role="user", first_name="身份用户")
        self.c.set_token(self.user)

    def test_profile_get_has_identity_fields(self):
        r = self.c.get_json("/api/auth/profile/")
        self.assertEqual(r.status_code, 200, r.content)
        d = r.json()["data"]
        for key in ("identity_education", "identity_college", "identity_major", "show_education_public", "show_college_public",
                    "show_major_public", "identity_can_edit"):
            self.assertIn(key, d)

    def test_identity_visibility_defaults_to_public(self):
        r = self.c.get_json("/api/auth/profile/")
        self.assertEqual(r.status_code, 200, r.content)
        d = r.json()["data"]
        self.assertTrue(d["show_college_public"])
        self.assertTrue(d["show_major_public"])
        self.assertTrue(d["show_education_public"])

    def test_patch_identity_updates_and_blocks_same_day(self):
        r = self.c.patch_json("/api/auth/profile/", {
            "identity_education": "本科", "identity_college": "文学院", "identity_major": "汉语言文学",
        })
        self.assertEqual(r.status_code, 200, r.content)
        d = r.json()["data"]
        self.assertEqual(d["identity_college"], "文学院")
        self.assertEqual(d["identity_major"], "汉语言文学")
        self.assertFalse(d["identity_can_edit"])  # 今天已改过
        # 普通用户同一天二次修改被拒
        r2 = self.c.patch_json("/api/auth/profile/", {
            "identity_education": "硕士", "identity_college": "历史学院", "identity_major": "历史学",
        })
        self.assertEqual(r2.status_code, 400, r2.content)
        self.assertIn("一天仅可更改一次", r2.json()["error"])

    def test_patch_identity_same_value_not_blocked(self):
        self.c.patch_json("/api/auth/profile/", {
            "identity_education": "本科", "identity_college": "文学院", "identity_major": "汉语言文学",
        })
        # 提交相同值 → 无实际变化，不触发限改
        r2 = self.c.patch_json("/api/auth/profile/", {
            "identity_education": "本科", "identity_college": "文学院", "identity_major": "汉语言文学",
        })
        self.assertEqual(r2.status_code, 200, r2.content)

    def test_patch_identity_other_is_preserved(self):
        r = self.c.patch_json("/api/auth/profile/", {
            "identity_education": "其他", "identity_college": "其他", "identity_major": "其他",
        })
        self.assertEqual(r.status_code, 200, r.content)
        d = r.json()["data"]
        self.assertEqual(d["identity_education"], "其他")
        self.assertEqual(d["identity_college"], "其他")
        self.assertEqual(d["identity_major"], "其他")

    def test_toggles_saved(self):
        r = self.c.patch_json("/api/auth/profile/", {
            "show_education_public": False, "show_college_public": True, "show_major_public": False,
        })
        self.assertEqual(r.status_code, 200, r.content)
        d = r.json()["data"]
        self.assertTrue(d["show_college_public"])
        self.assertFalse(d["show_major_public"])
        self.assertFalse(d["show_education_public"])


class IdentityModeratorTest(TestCase):
    def setUp(self):
        from .helpers import create_user
        self.c = AuthClient()
        self.mod = create_user("identmod", role="moderator", first_name="版主身份")
        self.c.set_token(self.mod)

    def test_moderator_can_edit_multiple_times_same_day(self):
        r = self.c.patch_json("/api/auth/profile/", {
            "identity_education": "硕士", "identity_college": "经管", "identity_major": "金融",
        })
        self.assertEqual(r.status_code, 200, r.content)
        r2 = self.c.patch_json("/api/auth/profile/", {
            "identity_education": "博士", "identity_college": "法学", "identity_major": "法学",
        })
        self.assertEqual(r2.status_code, 200, r2.content)
        self.assertEqual(r2.json()["data"]["identity_college"], "法学")
        self.assertTrue(r2.json()["data"]["identity_can_edit"])


class IdentityPublicPageTest(TestCase):
    def setUp(self):
        from .helpers import create_user
        self.c = AuthClient()
        self.user = create_user("identpub", role="user", first_name="公开身份")
        # 直接设身份 + 开学院开关、关专业开关
        p = self.user.profile
        p.identity_education = "本科"
        p.identity_college = "经济与工商管理学院"
        p.identity_major = "工商管理"
        p.show_college_public = True
        p.show_major_public = False
        p.save()

    def test_public_page_gates_by_toggle(self):
        r = self.c.get(f"/api/user/public/{self.user.id}/")
        self.assertEqual(r.status_code, 200, r.content)
        u = r.json()["data"]["user"]
        self.assertEqual(u["education"], "本科")
        self.assertEqual(u["college"], "经济与工商管理学院")
        self.assertEqual(u["major"], "")  # 专业开关关闭 → 不展示

    def test_public_page_shows_identity_by_default(self):
        from .helpers import create_user
        default_user = create_user("identpubdefault", role="user", first_name="默认公开")
        default_user.profile.identity_education = "硕士"
        default_user.profile.identity_college = "经济与工商管理学院"
        default_user.profile.identity_major = "工商管理"
        default_user.profile.save(update_fields=["identity_education", "identity_college", "identity_major"])

        r = self.c.get(f"/api/user/public/{default_user.id}/")
        self.assertEqual(r.status_code, 200, r.content)
        u = r.json()["data"]["user"]
        self.assertEqual(u["education"], "硕士")
        self.assertEqual(u["college"], "经济与工商管理学院")
        self.assertEqual(u["major"], "工商管理")

    def test_public_page_hides_when_all_off(self):
        p = self.user.profile
        p.show_college_public = False
        p.save()
        r = self.c.get(f"/api/user/public/{self.user.id}/")
        u = r.json()["data"]["user"]
        self.assertEqual(u["college"], "")
        self.assertEqual(u["major"], "")


class IdentityMeTest(TestCase):
    def setUp(self):
        from .helpers import create_user
        self.c = AuthClient()
        self.user = create_user("identme", role="user", first_name="身份me")
        self.user.profile.identity_education = "本科"
        self.user.profile.identity_college = "文学院"
        self.user.profile.identity_major = "汉语言文学"
        self.user.profile.save()
        self.c.set_token(self.user)

    def test_api_me_has_identity(self):
        r = self.c.get_json("/api/auth/me/")
        self.assertEqual(r.status_code, 200, r.content)
        d = r.json()["data"]
        self.assertEqual(d["identity_education"], "本科")
        self.assertEqual(d["identity_college"], "文学院")
        self.assertEqual(d["identity_major"], "汉语言文学")
        self.assertTrue(d["identity_can_edit"])
