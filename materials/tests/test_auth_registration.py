"""注册、邮箱验证、邮件失败与双域名支持测试。

支持 @bnu.edu.cn 与 @mail.bnu.edu.cn 两种后缀注册；
登录/找回密码输入纯学号时后端依次尝试两种后缀。
"""

import smtplib
from io import StringIO
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from django.test import TestCase
from django.contrib.auth.models import User
from django.core import mail
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings
from django.contrib.auth.tokens import default_token_generator

from .helpers import AuthClient
from ..models import UserProfile
from ..views.auth import _check_verification_token, _make_verification_token


class RegisterDualDomainTest(TestCase):
    def setUp(self):
        self.c = AuthClient()

    def test_register_accepts_both_suffixes(self):
        for i, suffix in enumerate(("@mail.bnu.edu.cn", "@bnu.edu.cn")):
            sid = "2024000%d" % (i + 1)
            r = self.c.post_json("/api/auth/register/", {
                "email": sid + suffix,
                "nickname": "新生%d" % i,
                "password": "password123",
                "education": "本科",
                "college": "其他",
                "major": "其他",
            })
            self.assertEqual(r.status_code, 200, r.content)
            self.assertTrue(User.objects.filter(username=sid + suffix).exists())
            self.assertFalse(User.objects.get(username=sid + suffix).is_active)

    def test_register_rejects_foreign_domain(self):
        r = self.c.post_json("/api/auth/register/", {
            "email": "outside-user@example.invalid",
            "nickname": "外校",
            "password": "password123",
        })
        self.assertEqual(r.status_code, 400)
        self.assertFalse(r.json()["ok"])

    def test_register_rejects_malformed_school_email(self):
        r = self.c.post_json("/api/auth/register/", {
            "email": "bad@@mail.bnu.edu.cn",
            "nickname": "格式错误",
            "password": "password123",
            "education": "本科",
            "college": "其他",
            "major": "其他",
        })
        self.assertEqual(r.status_code, 400)
        self.assertIn("格式", r.json()["error"])


@override_settings(CACHES={
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "resend-verification-tests",
    },
})
class ResendVerificationTest(TestCase):
    def setUp(self):
        self.c = AuthClient()
        self.email = "20990002@mail.bnu.edu.cn"
        self.u = User.objects.create_user(
            username=self.email,
            email=self.email,
            password="password123",
            first_name="待验证用户",
            is_active=False,
        )
        UserProfile.objects.create(user=self.u, role=UserProfile.Role.USER)
        cache.clear()
        mail.outbox = []

    def test_resend_sends_verification_email(self):
        r = self.c.post_json("/api/auth/resend-verification/", {"email": self.email})

        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["ok"])
        self.assertFalse(User.objects.get(pk=self.u.pk).is_active)
        self.assertEqual(len(mail.outbox), 1)
        html_body = mail.outbox[0].alternatives[0][0]
        self.assertIn("立即验证邮箱", html_body)
        self.assertIn('href="', html_body)
        link = next(line for line in mail.outbox[0].body.splitlines() if "/verify-email/?" in line)
        query = parse_qs(urlparse(link).query)
        self.assertEqual(query["uid"], [str(self.u.id)])
        self.assertTrue(_check_verification_token(self.u, query["vtoken"][0]))

    def test_resend_is_rate_limited_per_email(self):
        first = self.c.post_json("/api/auth/resend-verification/", {"email": self.email})
        second = self.c.post_json("/api/auth/resend-verification/", {"email": self.email})

        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(second.status_code, 429, second.content)
        self.assertIn("稍候", second.json()["error"])
        self.assertEqual(len(mail.outbox), 1)

    def test_resend_rejects_active_account(self):
        self.u.is_active = True
        self.u.save(update_fields=["is_active"])

        r = self.c.post_json("/api/auth/resend-verification/", {"email": self.email})

        self.assertEqual(r.status_code, 400)
        self.assertIn("已验证", r.json()["error"])
        self.assertEqual(len(mail.outbox), 0)

    def test_resend_rejects_unknown_account(self):
        r = self.c.post_json("/api/auth/resend-verification/", {
            "email": "20999999@mail.bnu.edu.cn",
        })

        self.assertEqual(r.status_code, 400)
        self.assertIn("未找到", r.json()["error"])

    def test_resend_failure_keeps_account_and_uses_short_cooldown(self):
        with patch(
            "materials.views.auth._send_verification_email",
            side_effect=RuntimeError("smtp unavailable"),
        ), self.assertLogs("materials.views.auth", level="ERROR"):
            first = self.c.post_json("/api/auth/resend-verification/", {"email": self.email})

        self.assertEqual(first.status_code, 503, first.content)
        self.assertTrue(User.objects.filter(pk=self.u.pk, is_active=False).exists())
        self.assertEqual(first["Retry-After"], "15")

        second = self.c.post_json("/api/auth/resend-verification/", {"email": self.email})
        self.assertEqual(second.status_code, 429, second.content)
        self.assertEqual(second["Retry-After"], "15")

    def test_resend_recipient_rejection_cleans_unverified_account(self):
        refused = smtplib.SMTPRecipientsRefused({self.email: (550, b"5.1.1 User unknown")})
        with patch(
            "materials.views.auth._send_verification_email",
            side_effect=refused,
        ), self.assertLogs("materials.views.auth", level="ERROR"):
            r = self.c.post_json("/api/auth/resend-verification/", {"email": self.email})

        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("目标校园邮箱", r.json()["error"])
        self.assertFalse(User.objects.filter(pk=self.u.pk).exists())


@override_settings(CACHES={
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "registration-failure-tests",
    },
})
class RegistrationFailureTest(TestCase):
    def setUp(self):
        self.c = AuthClient()
        self.email = "20995555@mail.bnu.edu.cn"
        self.body = {
            "email": self.email,
            "nickname": "邮件失败用户",
            "password": "password123",
            "education": "本科",
            "college": "其他",
            "major": "其他",
        }
        cache.clear()

    def test_initial_send_failure_removes_account_and_applies_short_cooldown(self):
        with patch(
            "materials.views.auth._send_verification_email",
            side_effect=RuntimeError("smtp unavailable"),
        ), self.assertLogs("materials.views.auth", level="ERROR"):
            first = self.c.post_json("/api/auth/register/", self.body)

        self.assertEqual(first.status_code, 503, first.content)
        self.assertFalse(User.objects.filter(username=self.email).exists())
        self.assertEqual(first["Retry-After"], "15")

        second = self.c.post_json("/api/auth/register/", self.body)
        self.assertEqual(second.status_code, 429, second.content)
        self.assertEqual(second["Retry-After"], "15")

    def test_initial_recipient_rejection_removes_account(self):
        refused = smtplib.SMTPRecipientsRefused({self.email: (550, b"5.1.1 User unknown")})
        with patch(
            "materials.views.auth._send_verification_email",
            side_effect=refused,
        ), self.assertLogs("materials.views.auth", level="ERROR"):
            r = self.c.post_json("/api/auth/register/", self.body)

        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("目标校园邮箱", r.json()["error"])
        self.assertFalse(User.objects.filter(username=self.email).exists())

    def test_profile_failure_rolls_back_user_creation(self):
        with patch(
            "materials.views.auth._get_or_create_profile",
            side_effect=RuntimeError("profile write failed"),
        ), self.assertLogs("materials.views.auth", level="ERROR"):
            r = self.c.post_json("/api/auth/register/", self.body)

        self.assertEqual(r.status_code, 500, r.content)
        self.assertFalse(User.objects.filter(username=self.email).exists())


class VerificationTokenTest(TestCase):
    def setUp(self):
        self.c = AuthClient()
        self.email = "20996666@mail.bnu.edu.cn"
        self.u = User.objects.create_user(
            username=self.email,
            email=self.email,
            password="password123",
            first_name="验证用户",
            is_active=False,
        )
        UserProfile.objects.create(user=self.u, role=UserProfile.Role.USER)

    def test_verification_link_can_activate_only_once(self):
        token = _make_verification_token(self.u)
        body = {"uid": self.u.id, "vtoken": token}

        first = self.c.post_json("/api/auth/verify-email/", body)
        second = self.c.post_json("/api/auth/verify-email/", body)

        self.assertEqual(first.status_code, 200, first.content)
        self.assertIn("token", first.json()["data"])
        self.assertEqual(second.status_code, 400, second.content)
        self.assertIn("直接登录", second.json()["error"])

    @override_settings(EMAIL_VERIFICATION_TIMEOUT=1800)
    def test_verification_link_expires_after_30_minutes(self):
        with patch("django.core.signing.time.time", return_value=1000):
            token = _make_verification_token(self.u)
        with patch("django.core.signing.time.time", return_value=2801):
            r = self.c.post_json("/api/auth/verify-email/", {
                "uid": self.u.id,
                "vtoken": token,
            })

        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("过期", r.json()["error"])
        self.assertFalse(User.objects.get(pk=self.u.pk).is_active)

    def test_legacy_password_reset_token_is_not_a_verification_token(self):
        legacy = default_token_generator.make_token(self.u)
        r = self.c.post_json("/api/auth/verify-email/", {
            "uid": self.u.id,
            "vtoken": legacy,
        })
        self.assertEqual(r.status_code, 400, r.content)
        self.assertFalse(User.objects.get(pk=self.u.pk).is_active)


class BouncedRegistrationCommandTest(TestCase):
    def setUp(self):
        self.email = "20997777@mail.bnu.edu.cn"
        self.u = User.objects.create_user(
            username=self.email,
            email=self.email,
            password="password123",
            is_active=False,
        )
        UserProfile.objects.create(user=self.u, role=UserProfile.Role.USER)

    def test_command_is_dry_run_by_default(self):
        output = StringIO()
        call_command("handle_bounced_registration", self.email, stdout=output)
        self.assertTrue(User.objects.filter(pk=self.u.pk).exists())
        self.assertIn("--confirm", output.getvalue())

    def test_command_deletes_confirmed_unverified_account(self):
        call_command("handle_bounced_registration", self.email, confirm=True, stdout=StringIO())
        self.assertFalse(User.objects.filter(pk=self.u.pk).exists())

    def test_command_refuses_to_delete_active_account(self):
        self.u.is_active = True
        self.u.save(update_fields=["is_active"])
        with self.assertRaises(CommandError):
            call_command("handle_bounced_registration", self.email, confirm=True)
        self.assertTrue(User.objects.filter(pk=self.u.pk).exists())


class LoginForgotDualDomainTest(TestCase):
    def setUp(self):
        self.c = AuthClient()
        # 一个用 @bnu.edu.cn 注册的已激活用户
        self.u = User.objects.create_user(
            username="20990001@bnu.edu.cn",
            email="20990001@bnu.edu.cn",
            password="password123",
            first_name="双域用户",
            is_active=True,
        )
        UserProfile.objects.create(user=self.u, role=UserProfile.Role.USER)

    def test_login_with_raw_sid_tries_both_suffixes(self):
        """纯学号登录应命中 @bnu.edu.cn 用户"""
        r = self.c.post_json("/api/auth/login/", {
            "username": "20990001", "password": "password123",
        })
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["ok"])
        self.assertEqual(r.json()["data"]["user"]["id"], self.u.id)

    def test_login_full_email_still_works(self):
        r = self.c.post_json("/api/auth/login/", {
            "username": "20990001@bnu.edu.cn", "password": "password123",
        })
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["ok"])

    def test_forgot_password_raw_sid_tries_both_suffixes(self):
        r = self.c.post_json("/api/auth/forgot-password/", {"email": "20990001"})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["ok"])
