"""
BNU Sparks · 木铎星火 — 认证 API

register, resend-verification, verify-email, login, me, change-password,
forgot-password, reset-password
"""

import hashlib
import json
import logging
import smtplib
import time
from urllib.parse import urlencode

from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.contrib.auth.tokens import default_token_generator
from django.conf import settings
from django.core.cache import cache
from django.core import signing
from django.core.exceptions import ValidationError
from django.core.mail import EmailMultiAlternatives, send_mail
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.utils.html import escape

from .utils import (
    _err, _ok, _jwt_encode, _get_user, _get_or_create_profile,
    _identity_can_edit, _normalize_identity, _request_client_ip,
    require_login, UserProfile,
    DAILY_DOWNLOAD_LIMIT,
)


# ═══════════════════════════════════════════════════════════════
# 注册 & 登录
# ═══════════════════════════════════════════════════════════════

logger = logging.getLogger(__name__)

VERIFICATION_RESEND_COOLDOWN = 60
VERIFICATION_FAILURE_COOLDOWN = 15
VERIFICATION_TOKEN_SALT = "bnusparks.email-verification.v1"
AUTH_RATE_LIMITS = {
    "register_ip": (10, 3600),
    "register_account": (4, 3600),
    "resend_ip": (20, 3600),
    "resend_account": (8, 3600),
    "login_ip": (30, 300),
    "login_account": (10, 300),
    "forgot_ip": (8, 3600),
    "forgot_account": (3, 3600),
}


def _request_ip(request):
    """认证限流沿用共享的可信客户端 IP 解析。"""
    return _request_client_ip(request)


def _rate_limit_cache_key(request, scope, identifier=""):
    subject = _request_ip(request) if scope.endswith("_ip") else identifier.strip().lower()
    raw = f"{scope}:{subject}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"auth_rate:{digest}"


def _rate_limit_hit(request, scope, identifier=""):
    """跨进程缓存计数限流；缓存异常时 fail-open，避免认证服务整体不可用。"""
    limit, window = AUTH_RATE_LIMITS[scope]
    key = _rate_limit_cache_key(request, scope, identifier)
    try:
        if cache.add(key, 1, window):
            return False
        return cache.incr(key) > limit
    except Exception:
        return False


def _release_rate_limit(request, scope, identifier=""):
    """邮件基础设施失败时归还本次限流计数，短冷却仍负责防止紧密重试。"""
    key = _rate_limit_cache_key(request, scope, identifier)
    try:
        remaining = cache.decr(key)
        if remaining <= 0:
            cache.delete(key)
    except ValueError:
        pass
    except Exception:
        logger.warning("failed to release auth rate-limit scope=%s", scope, exc_info=True)


def _rate_limit_error(scope):
    _limit, window = AUTH_RATE_LIMITS[scope]
    response = _err("请求过于频繁，请稍后再试", 429)
    response["Retry-After"] = str(window)
    return response


def _make_verification_token(user):
    """生成与密码重置令牌隔离的邮箱验证签名。"""
    return signing.dumps(
        {"uid": user.pk, "email": user.email},
        salt=VERIFICATION_TOKEN_SALT,
        compress=True,
    )


def _check_verification_token(user, token):
    try:
        payload = signing.loads(
            token,
            salt=VERIFICATION_TOKEN_SALT,
            max_age=getattr(settings, "EMAIL_VERIFICATION_TIMEOUT", 1800),
        )
    except (signing.BadSignature, TypeError, ValueError):
        return False
    return payload == {"uid": user.pk, "email": user.email}


def _send_verification_email(request, user):
    """为未激活用户发送邮箱验证邮件。"""
    token = _make_verification_token(user)
    query = urlencode({"uid": user.id, "vtoken": token})
    link = request.build_absolute_uri(f"/verify-email/?{query}")
    display_name = escape(user.first_name or user.username)
    escaped_link = escape(link)
    text_body = (
        f"你好 {user.first_name or user.username}，\n\n"
        f"感谢注册 BNU Sparks（木铎星火）课程资料共享平台！\n\n"
        f"请点击以下链接验证你的北师大邮箱（30 分钟内有效）：\n{link}\n\n"
        f"如果这不是你本人操作，请忽略此邮件。\n\n"
        f"BNU Sparks · 木铎星火\nhttps://bnusparks.cn"
    )
    html_body = f"""<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;background:#f5f6f8;color:#1f2937;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;line-height:1.7;">
    <div style="max-width:560px;margin:32px auto;padding:0 16px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px 28px;">
        <p style="margin:0 0 20px;color:#203a70;font-size:18px;font-weight:700;">BNU Sparks · 木铎星火</p>
        <p style="margin:0 0 12px;">你好，{display_name}：</p>
        <p style="margin:0 0 22px;">感谢注册课程资料共享平台。点击下面的按钮验证你的北师大邮箱，链接 30 分钟内有效。</p>
        <p style="margin:0 0 24px;text-align:center;">
          <a href="{escaped_link}" style="display:inline-block;padding:12px 24px;background:#203a70;border-radius:6px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;">立即验证邮箱</a>
        </p>
        <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">如果按钮无法点击，请复制下面的完整链接到浏览器打开：</p>
        <p style="margin:0 0 20px;word-break:break-all;color:#203a70;font-size:13px;">{escaped_link}</p>
        <p style="margin:0;color:#9ca3af;font-size:12px;">如果这不是你本人操作，请忽略此邮件。</p>
      </div>
    </div>
  </body>
</html>"""
    message = EmailMultiAlternatives(
        "BNU Sparks — 验证你的邮箱",
        text_body,
        "bnusparks@163.com",
        [user.email],
    )
    message.attach_alternative(html_body, "text/html")
    sent = message.send(fail_silently=False)
    if sent != 1:
        raise RuntimeError(f"verification email backend returned sent={sent}")


def _recipient_was_rejected(exc):
    """仅识别 SMTP 明确返回的永久收件人错误；异步退信需另行处理。"""
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return any(
            int(code) in {550, 551, 553}
            for code, _message in exc.recipients.values()
        )
    if isinstance(exc, smtplib.SMTPResponseException):
        raw = exc.smtp_error
        message = raw.decode("utf-8", "ignore") if isinstance(raw, bytes) else str(raw)
        markers = ("user unknown", "no such user", "mailbox unavailable", "recipient address rejected", "不存在")
        return int(exc.smtp_code) in {550, 551, 553} and any(marker in message.lower() for marker in markers)
    return False


def _mail_failure_response(exc, retry_after=VERIFICATION_FAILURE_COOLDOWN):
    if _recipient_was_rejected(exc):
        return _err("目标校园邮箱不存在或拒绝收信，请检查学号和邮箱后缀后重新注册")
    response = _err("邮件服务暂时不可用，请稍后重新提交", 503)
    response["Retry-After"] = str(retry_after)
    return response


def _verification_resend_cache_key(email):
    digest = hashlib.sha256(email.encode("utf-8")).hexdigest()
    return f"verification_resend:{digest}"


def _verification_failure_cache_key(request, email):
    raw = f"{_request_ip(request)}:{email}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"verification_failure:{digest}"


def _verification_failure_limited(request, email):
    try:
        if cache.get(_verification_failure_cache_key(request, email)):
            response = _err(
                f"邮件发送刚刚失败，请稍候 {VERIFICATION_FAILURE_COOLDOWN} 秒后再试",
                429,
            )
            response["Retry-After"] = str(VERIFICATION_FAILURE_COOLDOWN)
            return response
    except Exception:
        logger.warning("verification failure cooldown cache unavailable", exc_info=True)
    return None


def _set_verification_failure_cooldown(request, email):
    try:
        cache.set(
            _verification_failure_cache_key(request, email),
            True,
            VERIFICATION_FAILURE_COOLDOWN,
        )
    except Exception:
        logger.warning("failed to set verification failure cooldown", exc_info=True)


@csrf_exempt
def api_register(request):
    """POST /api/auth/register — email + password + nickname，发送验证邮件"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("请求格式错误")

    email = (body.get("email") or "").strip().lower()
    nickname = (body.get("nickname") or "").strip()
    password = (body.get("password") or "").strip()
    education = (body.get("education") or "").strip()
    college = (body.get("college") or "").strip()
    major = (body.get("major") or "").strip()

    if not email:
        return _err("邮箱不能为空")
    if not nickname:
        return _err("昵称不能为空")
    if not password:
        return _err("密码不能为空")
    if len(password) < 8:
        return _err("密码长度至少 8 位")
    if not education or not college or not major:
        return _err("培养层次、学院和专业均为必选项")
    if education not in UserProfile.EducationLevel.values:
        return _err("培养层次选项无效")
    try:
        validate_email(email)
    except ValidationError:
        return _err("邮箱格式无效")
    if not (email.endswith("@bnu.edu.cn") or email.endswith("@mail.bnu.edu.cn")):
        return _err("请使用北师大校内邮箱（@bnu.edu.cn / @mail.bnu.edu.cn）")

    existing = User.objects.filter(username=email).first()
    if existing:
        if existing.is_active:
            return _err("该邮箱已注册，请直接登录")
        else:
            return _err("该邮箱已注册但未验证，请检查校园邮箱中的验证邮件（可能需要检查垃圾邮件箱）")

    failure_response = _verification_failure_limited(request, email)
    if failure_response is not None:
        return failure_response

    if _rate_limit_hit(request, "register_ip"):
        return _rate_limit_error("register_ip")
    if _rate_limit_hit(request, "register_account", email):
        return _rate_limit_error("register_account")

    try:
        with transaction.atomic():
            user = User.objects.create_user(
                username=email, password=password, email=email,
                first_name=nickname, is_active=False,
            )
            profile = _get_or_create_profile(user)
            # 三项身份标签注册必填；初始设置不占用每日一次修改额度。
            profile.identity_education = education
            profile.identity_college = _normalize_identity(college)
            profile.identity_major = _normalize_identity(major)
            profile.save(update_fields=["identity_education", "identity_college", "identity_major"])
    except IntegrityError:
        _release_rate_limit(request, "register_ip")
        _release_rate_limit(request, "register_account", email)
        existing = User.objects.filter(username=email).first()
        if existing and existing.is_active:
            return _err("该邮箱已注册，请直接登录")
        if existing:
            return _err("该邮箱已注册但未验证，请重新发送验证邮件")
        logger.exception("registration database integrity failure email_domain=%s", email.partition("@")[2])
        return _err("注册信息保存失败，请稍后重试", 500)
    except Exception:
        _release_rate_limit(request, "register_ip")
        _release_rate_limit(request, "register_account", email)
        logger.exception("registration record creation failed email_domain=%s", email.partition("@")[2])
        return _err("注册信息保存失败，请稍后重试", 500)

    try:
        _send_verification_email(request, user)
    except Exception as exc:
        logger.exception(
            "verification email send failed user_id=%s email_domain=%s",
            user.id,
            email.partition("@")[2],
        )
        try:
            User.objects.filter(pk=user.pk, is_active=False).delete()
        except Exception:
            logger.exception("failed to clean up unverified user_id=%s", user.id)
        _release_rate_limit(request, "register_ip")
        _release_rate_limit(request, "register_account", email)
        _set_verification_failure_cooldown(request, email)
        return _mail_failure_response(exc)

    return _ok({"message": "注册成功！请查收验证邮件（可能需要检查垃圾邮件箱），点击邮件中的链接完成注册。"})


@csrf_exempt
def api_resend_verification(request):
    """POST /api/auth/resend-verification/ — 为未激活账号重发验证邮件"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("请求格式错误")

    email = (body.get("email") or "").strip().lower()
    if not email:
        return _err("邮箱不能为空")
    try:
        validate_email(email)
    except ValidationError:
        return _err("邮箱格式无效")
    if not (email.endswith("@bnu.edu.cn") or email.endswith("@mail.bnu.edu.cn")):
        return _err("请使用北师大校内邮箱（@bnu.edu.cn / @mail.bnu.edu.cn）")

    user = User.objects.filter(username=email).first()
    if user is None:
        return _err("未找到待验证的注册记录，请重新注册")
    if user.is_active:
        return _err("该邮箱已验证，请直接登录")

    failure_response = _verification_failure_limited(request, email)
    if failure_response is not None:
        return failure_response

    cache_key = _verification_resend_cache_key(email)
    try:
        if not cache.add(cache_key, True, VERIFICATION_RESEND_COOLDOWN):
            response = _err(f"验证邮件刚刚发送过，请稍候 {VERIFICATION_RESEND_COOLDOWN} 秒后再试", 429)
            response["Retry-After"] = str(VERIFICATION_RESEND_COOLDOWN)
            return response
    except Exception:
        logger.warning("verification resend cooldown cache unavailable", exc_info=True)

    if _rate_limit_hit(request, "resend_ip"):
        cache.delete(cache_key)
        return _rate_limit_error("resend_ip")
    if _rate_limit_hit(request, "resend_account", email):
        cache.delete(cache_key)
        return _rate_limit_error("resend_account")

    try:
        _send_verification_email(request, user)
    except Exception as exc:
        logger.exception(
            "verification resend failed user_id=%s email_domain=%s",
            user.id,
            email.partition("@")[2],
        )
        _release_rate_limit(request, "resend_ip")
        _release_rate_limit(request, "resend_account", email)
        _set_verification_failure_cooldown(request, email)
        try:
            if _recipient_was_rejected(exc):
                User.objects.filter(pk=user.pk, is_active=False).delete()
                cache.delete(cache_key)
            else:
                cache.set(cache_key, True, VERIFICATION_FAILURE_COOLDOWN)
        except Exception:
            logger.exception("failed to finalize verification resend failure user_id=%s", user.id)
        return _mail_failure_response(exc)

    return _ok({
        "message": "验证邮件已重新发送，请查收最新邮件（可能需要检查垃圾邮件箱）。",
        "cooldown_seconds": VERIFICATION_RESEND_COOLDOWN,
    })


@csrf_exempt
def api_verify_email(request):
    """POST /api/auth/verify-email/ — 验证邮箱并激活账号"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("请求格式错误")

    uid = body.get("uid")
    token = body.get("vtoken", "")

    if not uid or not token:
        return _err("参数不完整")

    try:
        user = User.objects.get(id=uid)
    except User.DoesNotExist:
        return _err("无效的验证链接")

    if not _check_verification_token(user, token):
        return _err("验证链接已过期或无效，请重新发送验证邮件")

    if user.is_active:
        return _err("该邮箱已完成验证，请直接登录")

    # 条件更新保证同一个验证链接只能有一个并发请求成功激活并换取 JWT。
    activated = User.objects.filter(pk=user.pk, is_active=False).update(is_active=True)
    if not activated:
        return _err("该邮箱已完成验证，请直接登录")
    user.is_active = True

    # 注册完成（邮箱验证通过）后发送感谢邮件，失败不影响注册结果
    try:
        send_mail(
            "BNU Sparks — 感谢您的注册",
            f"你好 {user.first_name or user.username}，\n\n"
            f"感谢您的注册！\n\n"
            f"建议添加微信 Rsun1949，以直接反馈任何遇到的问题。\n\n"
            f"这能够让我们以更快的速度和更高的质量来完善网站的功能。\n\n"
            f"BNU Sparks · 木铎星火\nhttps://bnusparks.cn",
            "bnusparks@163.com",
            [user.email],
            fail_silently=True,
        )
    except Exception:
        pass

    jwt_token = _jwt_encode({
        "user_id": user.id,
        "exp": time.time() + 7 * 86400,
    })
    profile = _get_or_create_profile(user)
    return _ok({
        "token": jwt_token,
        "message": "邮箱验证成功！",
        "user": {
            "id": user.id,
            "username": user.username,
            "nickname": user.first_name or user.username,
            "email": user.email,
            "role": profile.role,
            "avatar_url": profile.avatar.url if profile.avatar else "",
            "identity_education": profile.identity_education or "",
            "identity_college": profile.identity_college or "",
            "identity_major": profile.identity_major or "",
            "identity_can_edit": _identity_can_edit(profile),
        },
    })


@csrf_exempt
def api_login(request):
    """POST /api/auth/login — 支持邮箱或用户名登录"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("请求格式错误")

    username = (body.get("username") or "").strip()
    password = (body.get("password") or "").strip()
    remember = body.get("remember", False)

    if not username or not password:
        return _err("邮箱和密码不能为空")

    if _rate_limit_hit(request, "login_ip"):
        return _rate_limit_error("login_ip")
    if _rate_limit_hit(request, "login_account", username):
        return _rate_limit_error("login_account")

    # 支持两种师大邮箱后缀：输入纯学号（如 2024xxxxxx）时依次尝试
    # @mail.bnu.edu.cn 与 @bnu.edu.cn，保证任一后缀注册的用户都能登录
    if "@" not in username:
        candidates = [username, f"{username}@mail.bnu.edu.cn", f"{username}@bnu.edu.cn"]
    else:
        candidates = [username]

    user = None
    for cand in candidates:
        user = authenticate(username=cand, password=password)
        if user is None:
            try:
                user_obj = User.objects.get(email__iexact=cand)
                user = authenticate(username=user_obj.username, password=password)
            except User.DoesNotExist:
                pass
        if user is not None:
            username = cand
            break

    if user is None:
        for cand in candidates:
            try:
                inactive_user = User.objects.get(username=cand)
                if inactive_user.check_password(password) and not inactive_user.is_active:
                    return _err("请先验证邮箱后再登录；可在注册窗口重新发送验证邮件。")
            except User.DoesNotExist:
                pass
            try:
                inactive_user = User.objects.get(email__iexact=cand)
                if inactive_user.check_password(password) and not inactive_user.is_active:
                    return _err("请先验证邮箱后再登录；可在注册窗口重新发送验证邮件。")
            except User.DoesNotExist:
                pass
        return _err("邮箱或密码错误")

    if not user.is_active:
        return _err("请先验证邮箱后再登录；可在注册窗口重新发送验证邮件。")

    token_expiry = 30 * 86400 if remember else 7 * 86400
    token = _jwt_encode({
        "user_id": user.id,
        "exp": time.time() + token_expiry,
    })
    profile = _get_or_create_profile(user)
    return _ok({
        "token": token,
        "user": {
            "id": user.id,
            "username": user.username,
            "nickname": user.first_name or user.username,
            "email": user.email,
            "role": profile.role,
            "avatar_url": profile.avatar.url if profile.avatar else "",
            "identity_education": profile.identity_education or "",
            "identity_college": profile.identity_college or "",
            "identity_major": profile.identity_major or "",
            "identity_can_edit": _identity_can_edit(profile),
        },
    })


def api_me(request):
    """GET /api/auth/me"""
    user = _get_user(request)
    if user is None:
        return _err("请先登录", 401)
    profile = _get_or_create_profile(user)

    from datetime import date
    today = date.today()
    # 限额只对普通用户生效：其余角色限量为 -1（不限）
    if profile.role == UserProfile.Role.USER:
        if profile.last_download_date == today:
            remaining = max(0, DAILY_DOWNLOAD_LIMIT - profile.daily_download_count)
        else:
            remaining = DAILY_DOWNLOAD_LIMIT
        daily_download_limit = DAILY_DOWNLOAD_LIMIT
    else:
        remaining = -1
        daily_download_limit = -1

    return _ok({
        "id": user.id,
        "username": user.username,
        "nickname": user.first_name or user.username,
        "email": user.email,
        "role": profile.role,
        "moderated_sections": list(profile.moderated_sections.values_list("id", flat=True)),
        "managed_majors": list(profile.managed_majors.values_list("id", flat=True)),
        "can_moderate_general": profile.can_moderate_general if profile else False,
        "can_moderate_qa": profile.can_moderate_qa if profile else False,
        "daily_download_limit": daily_download_limit,
        "daily_download_remaining": remaining,
        "is_staff": user.is_staff,
        "avatar_url": profile.avatar.url if profile.avatar else "",
        "identity_education": profile.identity_education or "",
        "identity_college": profile.identity_college or "",
        "identity_major": profile.identity_major or "",
        "show_education_public": profile.show_education_public,
        "show_college_public": profile.show_college_public,
        "show_major_public": profile.show_major_public,
        "identity_can_edit": _identity_can_edit(profile),
    })


# ═══════════════════════════════════════════════════════════════
# 密码管理
# ═══════════════════════════════════════════════════════════════

@csrf_exempt
@require_login
def api_change_password(request):
    """POST /api/auth/change-password/"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("请求格式错误")

    old_password = body.get("old_password", "")
    new_password = body.get("new_password", "")

    if not old_password or not new_password:
        return _err("旧密码和新密码不能为空")
    if len(new_password) < 8:
        return _err("新密码长度至少 8 位")

    if not request.user.check_password(old_password):
        return _err("当前密码错误")

    request.user.set_password(new_password)
    request.user.save()
    # 改密后作废旧 JWT（P2.5）
    profile = _get_or_create_profile(request.user)
    profile.token_version = (profile.token_version or 0) + 1
    profile.save(update_fields=["token_version"])
    return _ok({"message": "密码已修改，请重新登录"})


@csrf_exempt
def api_forgot_password(request):
    """POST /api/auth/forgot-password/ 发送重置链接到邮箱"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("请求格式错误")

    email = (body.get("email") or "").strip().lower()
    if not email:
        return _err("邮箱不能为空")

    if _rate_limit_hit(request, "forgot_ip"):
        return _rate_limit_error("forgot_ip")
    if _rate_limit_hit(request, "forgot_account", email):
        return _rate_limit_error("forgot_account")

    # 支持两种师大邮箱后缀：输入纯学号时依次尝试 @mail.bnu.edu.cn 与 @bnu.edu.cn
    if "@" not in email:
        candidates = [f"{email}@mail.bnu.edu.cn", f"{email}@bnu.edu.cn"]
    else:
        candidates = [email]

    user = None
    for cand in candidates:
        try:
            user = User.objects.get(email=cand)
            email = cand
            break
        except User.DoesNotExist:
            continue
    if user is None:
        return _ok({"message": "如果该邮箱已注册，重置链接已发送到你的邮箱"})

    token = default_token_generator.make_token(user)
    link = request.build_absolute_uri(f'/reset-password/?uid={user.id}&token={token}')

    try:
        send_mail(
            "BNU Sparks — 密码重置",
            f"你好 {user.first_name or user.username}，\n\n"
            f"请点击以下链接重置你的密码（30 分钟内有效）：\n{link}\n\n"
            f"如果这不是你本人操作，请忽略此邮件。\n\nBNU Sparks · 木铎星火",
            "bnusparks@163.com",
            [email],
            fail_silently=False,
        )
    except Exception:
        return _err("邮件发送失败，请稍后重试", 500)

    return _ok({"message": "重置链接已发送到你的邮箱"})


@csrf_exempt
def api_reset_password(request):
    """POST /api/auth/reset-password/ 通过 token 重置密码"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("请求格式错误")

    uid = body.get("uid")
    token = body.get("token", "")
    new_password = body.get("new_password", "")

    if not uid or not token or not new_password:
        return _err("参数不完整")
    if len(new_password) < 8:
        return _err("密码长度至少 8 位")

    try:
        user = User.objects.get(id=uid)
    except User.DoesNotExist:
        return _err("无效的请求")

    if not default_token_generator.check_token(user, token):
        return _err("链接已过期或无效")

    user.set_password(new_password)
    user.save()
    # 重置后作废旧 JWT（P2.5）
    profile = _get_or_create_profile(user)
    profile.token_version = (profile.token_version or 0) + 1
    profile.save(update_fields=["token_version"])
    return _ok({"message": "密码已重置，请使用新密码登录"})
