"""注册、邮箱验证码、邮件失败与双域名支持测试。

支持 @bnu.edu.cn 与 @mail.bnu.edu.cn 两种后缀注册；
登录/找回密码输入纯学号时后端依次尝试两种后缀。
注册验证使用 6 位邮箱验证码（30 分钟有效、错 5 次作废）；
旧的邮件链接端点 /api/auth/verify-email/ 保留兼容在途旧邮件。
"""

import re
import smtplib
from io import StringIO
from unittest.mock import patch

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
from ..views.auth import _make_verification_token


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

    def test_resend_sends_code_that_activates_account(self):
        r = self.c.post_json("/api/auth/resend-verification/", {"email": self.email})

        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["ok"])
        self.assertFalse(User.objects.get(pk=self.u.pk).is_active)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("验证码", mail.outbox[0].subject)
        match = re.search(r"验证码是：(\d{6})", mail.outbox[0].body)
        self.assertIsNotNone(match)
        code = match.group(1)

        verify = self.c.post_json("/api/auth/verify-email-code/", {
            "email": self.email, "code": code,
        })
        self.assertEqual(verify.status_code, 200, verify.content)
        self.assertIn("token", verify.json()["data"])
        self.assertTrue(User.objects.get(pk=self.u.pk).is_active)

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
            "materials.views.auth._send_verification_code_email",
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
            "materials.views.auth._send_verification_code_email",
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
            "materials.views.auth._send_verification_code_email",
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
            "materials.views.auth._send_verification_code_email",
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


@override_settings(CACHES={
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "verification-code-tests",
    },
})
class VerificationCodeTest(TestCase):
    """验证码式注册主流程：注册→收码→输码激活→自动登录。"""

    def setUp(self):
        self.c = AuthClient()
        cache.clear()
        mail.outbox = []

    def _register(self, email):
        body = {
            "email": email,
            "nickname": "验证码用户",
            "password": "password123",
            "education": "本科",
            "college": "其他",
            "major": "其他",
        }
        r = self.c.post_json("/api/auth/register/", body)
        self.assertEqual(r.status_code, 200, r.content)
        match = re.search(r"验证码是：(\d{6})", mail.outbox[-1].body)
        self.assertIsNotNone(match, mail.outbox[-1].body)
        return match.group(1)

    def _wrong_code(self, real):
        return "000000" if real != "000000" else "000001"

    def test_register_code_activates_and_auto_login_token(self):
        email = "20991001@mail.bnu.edu.cn"
        code = self._register(email)

        verify = self.c.post_json("/api/auth/verify-email-code/", {"email": email, "code": code})

        self.assertEqual(verify.status_code, 200, verify.content)
        data = verify.json()["data"]
        self.assertIn("token", data)
        self.assertEqual(data["user"]["email"], email)
        self.assertTrue(User.objects.get(username=email).is_active)
        # 激活返回的 JWT 可直接调用需要登录的接口
        me = self.c.get("/api/auth/me/", HTTP_AUTHORIZATION=f"Bearer {data['token']}")
        self.assertEqual(me.status_code, 200, me.content)

    def test_register_code_is_single_use(self):
        email = "20991002@mail.bnu.edu.cn"
        code = self._register(email)
        self.c.post_json("/api/auth/verify-email-code/", {"email": email, "code": code})

        again = self.c.post_json("/api/auth/verify-email-code/", {"email": email, "code": code})

        self.assertEqual(again.status_code, 400, again.content)
        self.assertIn("已过期或未发送", again.json()["error"])

    def test_verify_without_sent_code_reports_expired(self):
        r = self.c.post_json("/api/auth/verify-email-code/", {
            "email": "20991003@mail.bnu.edu.cn", "code": "123456",
        })
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("已过期或未发送", r.json()["error"])

    def test_five_wrong_attempts_invalidate_code(self):
        email = "20991004@mail.bnu.edu.cn"
        code = self._register(email)
        wrong = self._wrong_code(code)
        for i in range(4):
            r = self.c.post_json("/api/auth/verify-email-code/", {"email": email, "code": wrong})
            self.assertEqual(r.status_code, 400)
            self.assertIn("验证码错误", r.json()["error"])
        fifth = self.c.post_json("/api/auth/verify-email-code/", {"email": email, "code": wrong})
        self.assertEqual(fifth.status_code, 400, fifth.content)
        self.assertIn("错误次数过多", fifth.json()["error"])
        # 已作废：正确码也不再生效，需要重新获取
        expired = self.c.post_json("/api/auth/verify-email-code/", {"email": email, "code": code})
        self.assertEqual(expired.status_code, 400, expired.content)
        self.assertIn("已过期或未发送", expired.json()["error"])
        self.assertFalse(User.objects.get(username=email).is_active)

    def test_four_wrong_attempts_then_correct_code_succeeds(self):
        email = "20991005@mail.bnu.edu.cn"
        code = self._register(email)
        wrong = self._wrong_code(code)
        for _ in range(4):
            self.c.post_json("/api/auth/verify-email-code/", {"email": email, "code": wrong})
        ok = self.c.post_json("/api/auth/verify-email-code/", {"email": email, "code": code})
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertTrue(User.objects.get(username=email).is_active)

    def test_resend_overwrites_previous_code(self):
        email = "20991006@mail.bnu.edu.cn"
        first_code = self._register(email)
        resend = self.c.post_json("/api/auth/resend-verification/", {"email": email})
        self.assertEqual(resend.status_code, 200, resend.content)
        match = re.search(r"验证码是：(\d{6})", mail.outbox[-1].body)
        second_code = match.group(1)

        stale = self.c.post_json("/api/auth/verify-email-code/", {"email": email, "code": first_code})
        self.assertEqual(stale.status_code, 400, stale.content)
        fresh = self.c.post_json("/api/auth/verify-email-code/", {"email": email, "code": second_code})
        self.assertEqual(fresh.status_code, 200, fresh.content)

    def test_duplicate_registration_prompts_verification_code(self):
        email = "20991007@mail.bnu.edu.cn"
        self._register(email)
        r = self.c.post_json("/api/auth/register/", {
            "email": email,
            "nickname": "重复注册",
            "password": "password123",
            "education": "本科",
            "college": "其他",
            "major": "其他",
        })
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("未验证", r.json()["error"])
        self.assertIn("验证码", r.json()["error"])


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
