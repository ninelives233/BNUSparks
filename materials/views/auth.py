"""
BNU Sparks · 木铎星火 — 认证 API

register, verify-email, login, me, change-password, forgot-password, reset-password
"""

import json
import time

from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail

from .utils import (
    _err, _ok, _jwt_encode, _get_user, _get_or_create_profile,
    require_login, UserProfile,
)


# ═══════════════════════════════════════════════════════════════
# 注册 & 登录
# ═══════════════════════════════════════════════════════════════

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

    if not email:
        return _err("邮箱不能为空")
    if not nickname:
        return _err("昵称不能为空")
    if not password:
        return _err("密码不能为空")
    if len(password) < 8:
        return _err("密码长度至少 8 位")
    if not email.endswith("@mail.bnu.edu.cn"):
        return _err("请使用北师大校内邮箱（@mail.bnu.edu.cn）")

    existing = User.objects.filter(username=email).first()
    if existing:
        if existing.is_active:
            return _err("该邮箱已注册，请直接登录")
        else:
            return _err("该邮箱已注册但未验证，请检查校园邮箱中的验证邮件（可能需要检查垃圾邮件箱）")

    user = User.objects.create_user(
        username=email, password=password, email=email,
        first_name=nickname, is_active=False,
    )
    _get_or_create_profile(user)

    token = default_token_generator.make_token(user)
    link = request.build_absolute_uri(f'/verify-email/?uid={user.id}&vtoken={token}')
    try:
        send_mail(
            "BNU Sparks — 验证你的邮箱",
            f"你好 {nickname}，\n\n"
            f"感谢注册 BNU Sparks（木铎星火）课程资料共享平台！\n\n"
            f"请点击以下链接验证你的北师大邮箱（30 分钟内有效）：\n{link}\n\n"
            f"如果这不是你本人操作，请忽略此邮件。\n\n"
            f"BNU Sparks · 木铎星火\nhttps://bnusparks.cn",
            "bnusparks@163.com",
            [email],
            fail_silently=False,
        )
    except Exception:
        user.delete()
        return _err("邮件发送失败，请稍后重试", 500)

    return _ok({"message": "注册成功！请查收验证邮件（可能需要检查垃圾邮件箱），点击邮件中的链接完成注册。"})


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

    if not default_token_generator.check_token(user, token):
        return _err("验证链接已过期或无效，请重新注册")

    if user.is_active:
        jwt_token = _jwt_encode({
            "user_id": user.id,
            "exp": time.time() + 7 * 86400,
        })
        profile = _get_or_create_profile(user)
        return _ok({
            "token": jwt_token,
            "message": "该邮箱已验证，请直接登录。",
            "user": {
                "id": user.id,
                "username": user.username,
                "nickname": user.first_name or user.username,
                "email": user.email,
                "role": profile.role,
                "avatar_url": profile.avatar.url if profile.avatar else "",
            },
        })

    user.is_active = True
    user.save(update_fields=["is_active"])

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

    user = authenticate(username=username, password=password)
    if user is None:
        try:
            user_obj = User.objects.get(email__iexact=username)
            user = authenticate(username=user_obj.username, password=password)
        except User.DoesNotExist:
            pass

    if user is None:
        try:
            inactive_user = User.objects.get(username=username)
            if inactive_user.check_password(password) and not inactive_user.is_active:
                return _err("请先验证邮箱后再登录。验证邮件已发送到你的校园邮箱（可能需要检查垃圾邮件箱）。")
        except User.DoesNotExist:
            pass
        try:
            inactive_user = User.objects.get(email__iexact=username)
            if inactive_user.check_password(password) and not inactive_user.is_active:
                return _err("请先验证邮箱后再登录。验证邮件已发送到你的校园邮箱（可能需要检查垃圾邮件箱）。")
        except User.DoesNotExist:
            pass
        return _err("邮箱或密码错误")

    if not user.is_active:
        return _err("请先验证邮箱后再登录。验证邮件已发送到你的校园邮箱（可能需要检查垃圾邮件箱）。")

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
    remaining = 60
    if profile.role == UserProfile.Role.USER:
        if profile.last_download_date != today:
            remaining = 60
        else:
            remaining = max(0, 60 - profile.daily_download_count)

    return _ok({
        "id": user.id,
        "username": user.username,
        "nickname": user.first_name or user.username,
        "email": user.email,
        "role": profile.role,
        "moderated_sections": list(profile.moderated_sections.values_list("id", flat=True)),
        "managed_majors": list(profile.managed_majors.values_list("id", flat=True)),
        "daily_download_remaining": remaining,
        "is_staff": user.is_staff,
        "avatar_url": profile.avatar.url if profile.avatar else "",
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

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
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
    return _ok({"message": "密码已重置，请使用新密码登录"})
