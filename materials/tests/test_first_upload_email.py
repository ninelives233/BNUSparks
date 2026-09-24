"""首份资料感谢邮件回归测试。"""

import tempfile
from pathlib import Path
from unittest.mock import patch

from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from .helpers import BnuTestCase, create_college, create_course
from ..models import UserProfile


class FirstUploadThanksEmailTest(BnuTestCase):
    def setUp(self):
        super().setUp()
        self.media_tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.media_tmp.cleanup)
        self.media_override = override_settings(MEDIA_ROOT=self.media_tmp.name)
        self.media_override.enable()
        self.addCleanup(self.media_override.disable)
        self.college = create_college("首份资料测试学院", "first-upload")
        self.course = create_course(
            "FIRST001", "首份资料测试课程", self.college, "major",
        )
        self.client.set_token(self.user)

    def _upload(self, filename="first.pdf"):
        return self.client.post("/api/files/upload/", {
            "course_code": self.course.code,
            "teacher": "测试老师",
            "file": SimpleUploadedFile(filename, b"first upload"),
        })

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_first_upload_sends_one_replyable_email(self):
        mail.outbox = []

        first = self._upload()
        second = self._upload("second.pdf")

        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.to, [self.user.email])
        self.assertEqual(message.reply_to, ["bnusparks@163.com"])
        self.assertIn("感谢", message.body)
        self.assertIn("第一份资料", message.body)
        self.assertIn("回复这封邮件", message.body)
        self.assertIn("管理员权限", message.body)
        self.assertIsNotNone(
            UserProfile.objects.get(user=self.user).first_upload_email_sent_at,
        )

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_email_failure_does_not_fail_upload_and_can_retry(self):
        with patch(
            "materials.views.utils_email.EmailMessage.send",
            side_effect=RuntimeError("SMTP unavailable"),
        ):
            failed_mail = self._upload("failed.pdf")

        self.assertEqual(failed_mail.status_code, 200, failed_mail.content)
        self.assertIsNone(
            UserProfile.objects.get(user=self.user).first_upload_email_sent_at,
        )

        mail.outbox = []
        retried = self._upload("retry.pdf")
        self.assertEqual(retried.status_code, 200, retried.content)
        self.assertEqual(len(mail.outbox), 1)
        self.assertTrue(Path(self.media_tmp.name).exists())
