"""意见反馈 API：直达总管理员消息中心、限流、参数校验、鉴权"""

from django.core.cache import cache

from .helpers import AuthClient, BnuTestCase, create_user
from ..models import Notification


class FeedbackApiTest(BnuTestCase):
    def setUp(self):
        cache.clear()
        self.user = create_user("209911900100")
        self.super1 = create_user("209911900101", role="super_admin")
        self.super2 = create_user("209911900102", role="super_admin")
        self.client = AuthClient()
        self.client.set_token(self.user)

    def _post(self, message="希望课程列表能按学院排序"):
        return self.client.post_json("/api/feedback/", {"message": message})

    def test_requires_login(self):
        from django.test import Client

        resp = Client().post(
            "/api/feedback/", data='{"message": "hi"}', content_type="application/json"
        )
        self.assertEqual(resp.status_code, 401)
        self.assertFalse(resp.json()["ok"])

    def test_feedback_reaches_all_super_admins(self):
        resp = self._post()
        self.assertTrue(resp.json()["ok"], resp.content)
        got = Notification.objects.filter(
            type=Notification.Type.FEEDBACK, recipient=self.super1
        )
        self.assertEqual(got.count(), 1)
        self.assertTrue(Notification.objects.filter(
            type=Notification.Type.FEEDBACK, recipient=self.super2
        ).exists())
        n = got.first()
        self.assertEqual(n.triggered_by, self.user)
        self.assertIn(self.user.username, n.title)
        self.assertEqual(n.message, "希望课程列表能按学院排序")
        # 普通用户自己不该收到
        self.assertFalse(Notification.objects.filter(recipient=self.user).exists())

    def test_super_admin_sender_excluded_from_recipients(self):
        self.client.set_token(self.super1)
        resp = self.client.post_json("/api/feedback/", {"message": "超管的反馈"})
        self.assertTrue(resp.json()["ok"])
        # 另一位超管收到，自己不收
        self.assertTrue(Notification.objects.filter(
            recipient=self.super2, type=Notification.Type.FEEDBACK).exists())
        self.assertFalse(Notification.objects.filter(
            recipient=self.super1, type=Notification.Type.FEEDBACK).exists())

    def test_empty_and_oversize_message_rejected(self):
        resp = self.client.post_json("/api/feedback/", {"message": "   "})
        self.assertEqual(resp.status_code, 400)
        resp = self.client.post_json("/api/feedback/", {"message": "好" * 501})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(Notification.objects.filter(type=Notification.Type.FEEDBACK).count(), 0)

    def test_cooldown_blocks_immediate_resend(self):
        self.assertTrue(self._post().json()["ok"])
        resp = self._post("第二条")
        self.assertEqual(resp.status_code, 429)
        self.assertIn("频繁", resp.json()["error"])
        # 冷却结束后可再发
        cache.delete(f"feedback_cooldown_{self.user.id}")
        self.assertTrue(self._post("第二条").json()["ok"])

    def test_daily_limit_five(self):
        for i in range(5):
            resp = self._post(f"第{i + 1}条反馈")
            self.assertTrue(resp.json()["ok"], resp.content)
            cache.delete(f"feedback_cooldown_{self.user.id}")
        resp = self._post("第6条")
        self.assertEqual(resp.status_code, 429)
        self.assertIn("明天", resp.json()["error"])
        # 每位超管恰好 5 条
        self.assertEqual(Notification.objects.filter(
            recipient=self.super1, type=Notification.Type.FEEDBACK).count(), 5)
