"""课程收藏 API 测试"""
from .helpers import BnuTestCase, create_user, create_course, create_college
from ..models import CourseFavorite


class CourseFavoriteTest(BnuTestCase):
    def setUp(self):
        super().setUp()
        self.course = create_course(code="GEN02122", name="通用英语进阶", course_type="general")

    def test_toggle_on_off(self):
        self.client.set_token(self.user)
        resp = self.client.post_json("/api/courses/GEN02122/favorite/")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["data"]["favorited"])
        self.assertEqual(CourseFavorite.objects.filter(user=self.user).count(), 1)

        resp = self.client.post_json("/api/courses/GEN02122/favorite/")
        self.assertFalse(resp.json()["data"]["favorited"])
        self.assertEqual(CourseFavorite.objects.filter(user=self.user).count(), 0)

    def test_unique_together(self):
        CourseFavorite.objects.create(user=self.user, course=self.course)
        self.client.set_token(self.user)
        resp = self.client.post_json("/api/courses/GEN02122/favorite/")
        # 已是收藏 → toggle 后取消，不报错
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()["data"]["favorited"])

    def test_wildcard_code_rejected(self):
        self.client.set_token(self.user)
        resp = self.client.post_json("/api/courses/GEN02***/favorite/")
        self.assertEqual(resp.status_code, 400)

    def test_nonexistent_code_404(self):
        self.client.set_token(self.user)
        resp = self.client.post_json("/api/courses/GEN99999/favorite/")
        self.assertEqual(resp.status_code, 404)

    def test_my_course_favorites_list(self):
        CourseFavorite.objects.create(user=self.user, course=self.course)
        self.client.set_token(self.user)
        resp = self.client.get_json("/api/user/course-favorites/")
        self.assertEqual(resp.status_code, 200)
        items = resp.json()["data"]["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["course_code"], "GEN02122")
        self.assertEqual(items[0]["course_name"], "通用英语进阶")

    def test_same_code_merged(self):
        """同名分拆课程（同 code 多 College）按 code 去重"""
        college_a = create_college("文学院", "wenxy")
        college_b = create_college("历史学院", "lishi")
        c2 = create_course(code="GEN9999", name="同课A", college=college_a, course_type="general")
        c3 = create_course(code="GEN9999", name="同课B", college=college_b, course_type="general")
        CourseFavorite.objects.create(user=self.user, course=c2)
        CourseFavorite.objects.create(user=self.user, course=c3)
        self.client.set_token(self.user)
        resp = self.client.get_json("/api/user/course-favorites/")
        items = resp.json()["data"]["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["course_code"], "GEN9999")

    def test_requires_login(self):
        resp = self.client.post_json("/api/courses/GEN02122/favorite/")
        self.assertEqual(resp.status_code, 401)
