"""
BNU Sparks · 木铎星火 — JSON API 视图

所有视图返回 JSON，前端通过 fetch() 调用。
"""

import json
import uuid
import hmac
import hashlib
import base64
import io
import time
from pathlib import Path
from functools import wraps

from django.shortcuts import get_object_or_404
from django.http import JsonResponse, FileResponse
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.conf import settings
from django.db.models import Q, Count, F
from django.utils import timezone
from datetime import date, timedelta

from .models import College, Course, CourseType, Material, MaterialType, CourseCategory, UserProfile, Notification, ReviewComment, DownloadRecord, DeletionRecord, FolderOperation


# ═══════════════════════════════════════════════════════════════
# JWT 工具（纯 Python 实现，不依赖外部库）
# ═══════════════════════════════════════════════════════════════

def _jwt_encode(payload):
    """编码 JWT（role 不在 token 中，从数据库实时读取）"""
    payload = dict(payload)

    header = base64.urlsafe_b64encode(
        json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    ).rstrip(b"=").decode()
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload).encode()
    ).rstrip(b"=").decode()
    sig = hmac.new(
        settings.SECRET_KEY.encode(),
        f"{header}.{payload_b64}".encode(),
        hashlib.sha256,
    ).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    return f"{header}.{payload_b64}.{sig_b64}"


def _jwt_decode(token):
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        h, p, s = parts
        expected = hmac.new(
            settings.SECRET_KEY.encode(),
            f"{h}.{p}".encode(), hashlib.sha256,
        ).digest()
        actual = base64.urlsafe_b64decode(s + "==")
        if not hmac.compare_digest(expected, actual):
            return None
        payload = json.loads(base64.urlsafe_b64decode(p + "=="))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None


def _get_user(request):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        # 仅当 Authorization 头为空时才 fallback 到查询参数
        if not auth:
            token = request.GET.get("token") or request.POST.get("token") or ""
            if token:
                auth = "Bearer " + token
        if not auth.startswith("Bearer ") or len(auth) < 20:
            return None
    payload = _jwt_decode(auth[7:])
    if payload is None:
        return None
    try:
        return User.objects.get(id=payload["user_id"])
    except User.DoesNotExist:
        return None


def require_login(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        user = _get_user(request)
        if user is None:
            return JsonResponse({"ok": False, "error": "请先登录"}, status=401)
        request.user = user
        return view(request, *args, **kwargs)
    return wrapper


def _get_or_create_profile(user):
    """获取用户资料，不存在则自动创建（兼容存量用户）"""
    try:
        return user.profile
    except UserProfile.DoesNotExist:
        return UserProfile.objects.create(user=user, role=UserProfile.Role.USER)


def require_role(*roles):
    """限制视图仅允许指定角色的用户访问（叠加 require_login）"""
    def decorator(view):
        @wraps(view)
        def wrapper(request, *args, **kwargs):
            user = _get_user(request)
            if user is None:
                return _err("请先登录", 401)
            profile = _get_or_create_profile(user)
            if profile.role not in roles:
                return _err("权限不足", 403)
            request.user = user
            return view(request, *args, **kwargs)
        return wrapper
    return decorator


def _ok(data=None, status=200):
    return JsonResponse({"ok": True, "data": data}, status=status)


def _err(msg, status=400):
    return JsonResponse({"ok": False, "error": msg}, status=status)


def _create_notification(recipient, type, title, message="", material=None, triggered_by=None):
    """创建通知的便捷方法，自动从 material 冗余存储 course_code/course_name"""
    course_code = ""
    course_name = ""
    if material and material.course_id:
        try:
            course_code = material.course.code
            course_name = material.course.name
        except Exception:
            pass
    return Notification.objects.create(
        recipient=recipient,
        type=type,
        title=title,
        message=message,
        material=material,
        course_code=course_code,
        course_name=course_name,
        triggered_by=triggered_by,
    )


def _check_download_quota(user):
    """检查并扣除下载配额，返回 (allowed, remaining, message)"""
    profile = _get_or_create_profile(user)
    if profile.role in (UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN):
        return True, -1, ""  # 管理员不限

    from datetime import date
    today = date.today()
    if profile.last_download_date != today:
        profile.daily_download_count = 0
        profile.last_download_date = today

    if profile.daily_download_count >= 60:
        return False, 0, "今日下载次数已达上限（60 次）"

    profile.daily_download_count += 1
    profile.save(update_fields=["daily_download_count", "last_download_date"])
    remaining = 60 - profile.daily_download_count
    return True, remaining, ""


# ═══════════════════════════════════════════════════════════════
# 认证 API
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
    # 自动创建 UserProfile（默认 role = user）
    _get_or_create_profile(user)

    # 生成验证 token 并发送验证邮件
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
        user.delete()  # 邮件发送失败，回滚用户创建
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
        # 已激活：返回 JWT 让前端直接登录
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

    # 验证成功，自动生成 JWT 让用户直接登录
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

    # 直接用 username/password 认证
    user = authenticate(username=username, password=password)
    # 如果失败，按邮箱查找
    if user is None:
        try:
            user_obj = User.objects.get(email__iexact=username)
            user = authenticate(username=user_obj.username, password=password)
        except User.DoesNotExist:
            pass

    if user is None:
        # 检查是否是未验证邮箱导致的登录失败（authenticate() 会拒绝 is_active=False 的用户）
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

    # 计算今日剩余下载次数
    from datetime import date
    today = date.today()
    remaining = 60  # 版主/管理不限
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
# 密码管理 API
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
    if len(new_password) < 6:
        return _err("新密码长度至少 6 位")

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
        # 不暴露邮箱是否已注册
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
    except Exception as e:
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
    if len(new_password) < 6:
        return _err("密码长度至少 6 位")

    try:
        user = User.objects.get(id=uid)
    except User.DoesNotExist:
        return _err("无效的请求")

    if not default_token_generator.check_token(user, token):
        return _err("链接已过期或无效")

    user.set_password(new_password)
    user.save()
    return _ok({"message": "密码已重置，请使用新密码登录"})


# ═══════════════════════════════════════════════════════════════
# 通知 API
# ═══════════════════════════════════════════════════════════════

@require_login
def api_notifications(request):
    """GET /api/auth/notifications/ — 通知列表
       POST /api/auth/notifications/ — 全部标为已读
       DELETE /api/auth/notifications/ — 清空所有通知"""
    if request.method == "GET":
        unread_only = request.GET.get("unread_only")
        qs = Notification.objects.filter(recipient=request.user).select_related("material")
        if unread_only:
            qs = qs.filter(is_read=False)

        return _ok({
            "unread_count": Notification.objects.filter(recipient=request.user, is_read=False).count(),
            "list": [
                {
                    "id": n.id,
                    "type": n.type,
                    "title": n.title,
                    "message": n.message,
                    "is_read": n.is_read,
                    "material_id": n.material_id,
                    "material_title": n.material.title if n.material else None,
                    "course_code": n.course_code or (n.material.course.code if n.material and hasattr(n.material, "course") and n.material.course else None),
                    "course_name": n.course_name or (n.material.course.name if n.material and hasattr(n.material, "course") and n.material.course else None),
                    "created_at": n.created_at.strftime("%Y-%m-%d %H:%M"),
                }
                for n in qs[:100]
            ],
        })

    elif request.method == "POST":
        Notification.objects.filter(recipient=request.user, is_read=False).update(is_read=True)
        return _ok({"message": "全部标为已读"})

    elif request.method == "DELETE":
        Notification.objects.filter(recipient=request.user).delete()
        return _ok({"message": "已清空所有通知"})

    return _err("仅支持 GET/POST/DELETE", 405)


@require_login
def api_notification_read(request, nid):
    """POST /api/auth/notifications/<id>/read/ — 标为已读
       DELETE /api/auth/notifications/<id>/read/ — 删除单条通知"""
    if request.method == "POST":
        notif = get_object_or_404(Notification, id=nid, recipient=request.user)
        notif.is_read = True
        notif.save(update_fields=["is_read"])
        return _ok({"message": "已标为已读"})

    elif request.method == "DELETE":
        notif = get_object_or_404(Notification, id=nid, recipient=request.user)
        notif.delete()
        return _ok({"message": "已删除"})

    return _err("仅支持 POST/DELETE", 405)


# ═══════════════════════════════════════════════════════════════
# 个人资料 API
# ═══════════════════════════════════════════════════════════════

@csrf_exempt
@require_login
def api_profile(request):
    """GET/PATCH /api/auth/profile/"""
    if request.method == "GET":
        profile = _get_or_create_profile(request.user)
        from datetime import date
        today = date.today()
        daily_download_used = 0
        if profile.role == UserProfile.Role.USER:
            if profile.last_download_date == today:
                daily_download_used = profile.daily_download_count
            download_limit = 60
        else:
            download_limit = -1  # 管理员不限

        avatar_url = ""
        if profile.avatar:
            try:
                avatar_url = profile.avatar.url
            except Exception:
                avatar_url = ""

        return _ok({
            "id": request.user.id,
            "username": request.user.username,
            "nickname": request.user.first_name or request.user.username,
            "email": request.user.email,
            "role": profile.role,
            "role_label": profile.get_role_display(),
            "avatar_url": avatar_url,
            "daily_download_used": daily_download_used,
            "daily_download_limit": download_limit,
            "date_joined": request.user.date_joined.strftime("%Y-%m-%d"),
            "managed_sections": _get_managed_sections_display(profile),
            "auto_approve": profile.auto_approve,
            "can_auto_approve": profile.can_auto_approve,
        })

    elif request.method == "PATCH":
        try:
            body = json.loads(request.body)
        except json.JSONDecodeError:
            return _err("请求格式错误")

        nickname = (body.get("nickname") or "").strip()
        if nickname:
            if len(nickname) > 50:
                return _err("昵称不能超过 50 字")
            request.user.first_name = nickname
            request.user.save(update_fields=["first_name"])
            # 同步更新该用户所有已上传资料的 uploader_name
            Material.objects.filter(uploader=request.user).exclude(
                uploader_name=nickname
            ).update(uploader_name=nickname)

        return _ok({
            "nickname": request.user.first_name or request.user.username,
            "message": "资料已更新",
        })

    return _err("仅支持 GET/PATCH", 405)


# ═══════════════════════════════════════════════════════════════
# 头像上传
# ═══════════════════════════════════════════════════════════════

import os
from PIL import Image as PILImage

@csrf_exempt
@require_login
def api_avatar_upload(request):
    """POST /api/auth/avatar/ — 上传/更换头像"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)

    if "avatar" not in request.FILES:
        return _err("请选择图片文件")

    img_file = request.FILES["avatar"]

    # 文件类型校验
    allowed_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
    if img_file.content_type not in allowed_types:
        return _err("仅支持 JPG/PNG/GIF/WebP 格式")

    # 文件大小校验（2MB）
    if img_file.size > 2 * 1024 * 1024:
        return _err("图片不能超过 2MB")

    profile = _get_or_create_profile(request.user)
    ext = os.path.splitext(img_file.name)[1] or ".jpg"
    safe_name = f"avatar_{request.user.id}{ext}"
    dest_dir = Path(settings.MEDIA_ROOT) / "avatars"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / safe_name

    # 用 PIL 缩放到 200×200 居中裁剪
    try:
        img = PILImage.open(img_file)
        img = img.convert("RGB")
        size = min(img.size)
        left = (img.size[0] - size) // 2
        top = (img.size[1] - size) // 2
        img = img.crop((left, top, left + size, top + size))
        img = img.resize((200, 200), PILImage.LANCZOS)
        img.save(dest_path, "JPEG", quality=85)
    except Exception as e:
        return _err(f"图片处理失败: {str(e)}")

    # 删除旧头像（不同格式）
    if profile.avatar:
        old_path = Path(settings.MEDIA_ROOT) / profile.avatar.name
        if old_path.exists() and str(old_path) != str(dest_path):
            old_path.unlink()

    profile.avatar = f"avatars/{safe_name}"
    profile.save(update_fields=["avatar"])

    return _ok({
        "avatar_url": profile.avatar.url if profile.avatar else "",
        "message": "头像已更新",
    })


# ═══════════════════════════════════════════════════════════════
# EXIF 清理工具（隐私安全）
# ═══════════════════════════════════════════════════════════════

def _strip_exif(file_path):
    """清除图片文件的 EXIF 元数据（GPS 位置信息等）

    仅处理 JPEG/PNG/WebP 格式，非图片文件静默跳过。
    失败时静默回退，不阻塞上传流程。
    """
    ext = Path(file_path).suffix.lower()
    if ext not in ('.jpg', '.jpeg', '.png', '.webp'):
        return
    try:
        img = PILImage.open(file_path)
        img.load()  # 确保像素数据已读取
        fmt = {'jpg': 'JPEG', 'jpeg': 'JPEG', 'png': 'PNG', 'webp': 'WEBP'}[ext.lstrip('.')]
        buf = io.BytesIO()
        save_kwargs = {'format': fmt}
        if fmt == 'JPEG':
            save_kwargs['quality'] = 85
        img.save(buf, **save_kwargs)
        with open(file_path, 'wb') as f:
            f.write(buf.getvalue())
    except Exception:
        pass  # 静默回退


# ═══════════════════════════════════════════════════════════════
# 用户个人 API
# ═══════════════════════════════════════════════════════════════

@require_login
def api_my_uploads(request):
    """GET /api/user/uploads/ — 自己的上传记录"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)

    qs = Material.objects.filter(uploader=request.user).select_related(
        "course", "material_type"
    ).order_by("-created_at")[:100]

    from datetime import timedelta
    delay_boundary = timezone.now() - timedelta(minutes=1)

    def _serialize_upload(m):
        # 自动托管延迟：被自动批准 < 1 分钟的文件，对上传者仍显示"待审核"
        rs = m.review_status
        is_delayed = (rs == "approved"
                      and m.uploader_id == request.user.id
                      and m.reviewed_by_id is not None
                      and m.reviewed_by_id != request.user.id
                      and m.created_at > delay_boundary)
        if is_delayed:
            rs = "pending"
        elif (rs == "approved"
              and m.uploader_id == request.user.id
              and m.reviewed_by_id is not None
              and m.reviewed_by_id != request.user.id
              and not Notification.objects.filter(
                  recipient=request.user, material=m,
                  type=Notification.Type.APPROVED,
              ).exists()):
            # 1 分钟延迟已过，创建一条和人工审核完全一样的通知
            _create_notification(
                recipient=request.user,
                type=Notification.Type.APPROVED,
                title="你的资料已通过审核",
                message=f"你的资料「{m.title}」已通过审核，现在可以下载了。",
                material=m,
            )
        return {
            "id": m.id, "title": m.title,
            "file_name": m.file_name, "file_size": m.file_size,
            "file_type": m.material_type.name if m.material_type else (m.file_type or "其他"),
            "course_name": m.course.name, "course_code": m.course.code,
            "teacher": m.teacher,
            "review_status": rs,
            "is_approved": m.is_approved,
            "is_admin_uploaded": _get_or_create_profile(request.user).role in (
                UserProfile.Role.SUPER_ADMIN, UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR
            ),
            "review_notes": m.review_notes,
            "download_count": m.download_count,
            "created_at": m.created_at.strftime("%Y-%m-%d"),
        }

    return _ok([_serialize_upload(m) for m in qs])


# ═══════════════════════════════════════════════════════════════
# 我的下载
# ═══════════════════════════════════════════════════════════════

@require_login
def api_my_downloads(request):
    """GET /api/user/downloads/ — 自己的下载记录"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)

    qs = DownloadRecord.objects.filter(user=request.user).select_related(
        "material"
    ).order_by("-created_at")[:100]

    return _ok([
        {
            "id": r.id,
            "material_id": r.material_id,
            "course_code": r.course_code,
            "course_name": r.course_name,
            "material_title": r.material_title,
            "file_name": r.file_name,
            "created_at": r.created_at.strftime("%Y-%m-%d %H:%M"),
        }
        for r in qs
    ])


# ═══════════════════════════════════════════════════════════════
# 课程 API
# ═══════════════════════════════════════════════════════════════

def api_courses(request):
    """GET /api/courses"""
    qs = Course.objects.annotate(
        material_cnt=Count("materials", filter=Q(materials__is_approved=True)),
    ).order_by("name")

    course_type = request.GET.get("type")
    if course_type in ("general", "major"):
        qs = qs.filter(course_type=course_type)

    college = request.GET.get("college")
    if college:
        qs = qs.filter(college__name__icontains=college)

    search = request.GET.get("search")
    if search:
        qs = qs.filter(Q(name__icontains=search) | Q(code__icontains=search))

    return _ok([
        {
            "id": c.id, "name": c.name, "code": c.code,
            "course_type": c.course_type,
            "college": c.college.name if c.college else None,
            "material_count": c.material_cnt,
        }
        for c in qs[:300]
    ])


def api_course_files(request, course_code):
    """GET /api/courses/<code>/files"""
    try:
        course = Course.objects.get(code=course_code)
    except Course.DoesNotExist:
        # fallback: 前缀匹配
        cleaned = course_code.replace("*", "").replace("-", "")
        matched = Course.objects.filter(code__startswith=cleaned)
        if matched.count() == 1:
            course = matched.first()
        elif matched.count() > 1:
            return _err("课程代码不明确")
        else:
            return _err("课程不存在", 404)
    user = _get_user(request)

    # 普通用户只能看到已通过的资料，上传者可看到自己的待审资料
    # 已驳回文件不在文件列表中显示（直接从通知中心重新上传）
    q_filter = Q(course=course, is_approved=True)
    if user is not None:
        q_filter |= Q(course=course, uploader=user, review_status__in=["pending", "approved"])

    materials = Material.objects.filter(q_filter).select_related(
        "material_type"
    ).order_by("-created_at")

    from datetime import timedelta
    delay_boundary = timezone.now() - timedelta(minutes=1)
    user_id = user.id if user is not None else None

    def _serialize_file(m):
        # 自动托管延迟：被自动批准 < 1 分钟的文件，对上传者仍显示"待审核"
        rs = m.review_status
        if (rs == "approved"
                and user is not None
                and m.uploader_id == user.id
                and m.reviewed_by_id is not None
                and m.reviewed_by_id != user.id
                and m.created_at > delay_boundary):
            rs = "pending"
        elif (rs == "approved"
              and user is not None
              and m.uploader_id == user.id
              and m.reviewed_by_id is not None
              and m.reviewed_by_id != user.id
              and not Notification.objects.filter(
                  recipient=user, material=m,
                  type=Notification.Type.APPROVED,
              ).exists()):
            # 1 分钟延迟已过，创建一条和人工审核完全一样的通知
            _create_notification(
                recipient=user,
                type=Notification.Type.APPROVED,
                title="你的资料已通过审核",
                message=f"你的资料「{m.title}」已通过审核，现在可以下载了。",
                material=m,
            )
        return {
            "id": m.id, "title": m.title,
            "file_name": m.file_name, "file_size": m.file_size,
            "file_type": m.material_type.name if m.material_type else (m.file_type or "其他"),
            "uploader": m.uploader_name or (m.uploader.first_name if m.uploader else "匿名"),
            "teacher": m.teacher,
            "description": m.description or "",
            "course_name": m.course.name if m.course else "",
            "course_code": m.course.code if m.course else "",
            "download_count": m.download_count,
            "created_at": m.created_at.strftime("%Y-%m-%d"),
            "review_status": rs,
            "is_uploader": user is not None and m.uploader_id == user.id,
            "is_admin_uploaded": user is not None and m.uploader_id == user.id and _get_or_create_profile(user).role in (
                UserProfile.Role.SUPER_ADMIN, UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR
            ),
            "can_download": m.is_approved or (user is not None and m.uploader_id == user.id),
            "can_delete": user is not None and (
                m.uploader_id == user.id
                or _get_or_create_profile(user).role == UserProfile.Role.SUPER_ADMIN
                or _get_or_create_profile(user).role == UserProfile.Role.MODERATOR
                or (
                    _get_or_create_profile(user).role == UserProfile.Role.SUB_MODERATOR
                    and m.course.college_id in set(
                        _get_or_create_profile(user).managed_majors.values_list("id", flat=True)
                    )
                )
            ),
        }

    return _ok([_serialize_file(m) for m in materials])


# ═══════════════════════════════════════════════════════════════
# 文件上传 / 下载
# ═══════════════════════════════════════════════════════════════

def _check_auto_approve(course):
    """检查是否有开启了自动托管的版主/小版主管辖该课程。
    返回自动审核人 User 或 None。"""
    # 先查小版主（更具体）
    for p in UserProfile.objects.filter(
        role=UserProfile.Role.SUB_MODERATOR, auto_approve=True
    ).select_related('user'):
        cat_ids = set(p.moderated_sections.values_list('id', flat=True))
        for cat_id in cat_ids:
            try:
                cat = CourseCategory.objects.get(id=cat_id)
                courses = _get_courses_in_category(cat)
                if course in set(courses):
                    return p.user
            except CourseCategory.DoesNotExist:
                continue
    # 再查版主
    for p in UserProfile.objects.filter(
        role=UserProfile.Role.MODERATOR, auto_approve=True
    ).select_related('user'):
        colleges = set(p.managed_majors.values_list('id', flat=True))
        if course.college_id is None:
            if p.can_moderate_general:
                return p.user
        elif course.college_id in colleges:
            return p.user
    return None


def _get_subordinate_covered_course_ids(request_user):
    """获取被下级版主覆盖的课程 ID 集合（用于分流过滤）"""
    profile = _get_or_create_profile(request_user)
    if profile.role not in (UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN):
        return set()
    sub_cat_ids = list(UserProfile.objects.filter(
        role=UserProfile.Role.SUB_MODERATOR
    ).exclude(user=request_user).values_list('moderated_sections__id', flat=True).distinct())
    if not sub_cat_ids:
        return set()
    course_ids = set()
    for cat in CourseCategory.objects.filter(id__in=sub_cat_ids):
        course_ids.update(c.id for c in _get_courses_in_category(cat))
    return course_ids

@csrf_exempt
@require_login
def api_file_upload(request):
    """POST /api/files/upload"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)

    course_code = request.POST.get("course_code", "").strip()
    title = request.POST.get("title", "").strip()
    description = request.POST.get("description", "").strip()
    teacher = request.POST.get("teacher", "").strip()
    uploaded_file = request.FILES.get("file")

    if not course_code or not uploaded_file:
        return _err("课程代码和文件不能为空")
    if not teacher:
        return _err("请填写任课教师姓名")

    # 标题为空时自动使用原始文件名（不含扩展名）
    if not title:
        title = Path(uploaded_file.name).stem

    try:
        course = Course.objects.get(code=course_code)
    except Course.DoesNotExist:
        # fallback: 前缀匹配（支持 course_text 内容未对应实际课程的情况）
        cleaned = course_code.replace("*", "").replace("-", "")
        matched = Course.objects.filter(code__startswith=cleaned)
        if matched.count() == 1:
            course = matched.first()
        elif matched.count() > 1:
            return _err("课程代码不明确，请联系管理员")
        else:
            return _err("课程不存在")

    # 保存文件
    ext = Path(uploaded_file.name).suffix
    safe_name = f"{uuid.uuid4().hex[:12]}_{title[:40]}{ext}"
    save_dir = Path(settings.MEDIA_ROOT) / course_code
    save_dir.mkdir(parents=True, exist_ok=True)

    with open(save_dir / safe_name, "wb") as f:
        for chunk in uploaded_file.chunks():
            f.write(chunk)

    # 清除图片文件的 EXIF 元数据（隐私安全）
    _strip_exif(save_dir / safe_name)

    file_size = (save_dir / safe_name).stat().st_size

    # 根据用户角色决定审核状态
    profile = _get_or_create_profile(request.user)
    is_auto_approved = profile.role in (
        UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN, UserProfile.Role.SUB_MODERATOR,
    )
    auto_approved_by = None
    if is_auto_approved:
        # 管理员自身上传：审核人设为自己，确保 reviewed_by/reviewed_at 有值
        auto_approved_by = request.user
    else:
        # 普通用户上传：检查是否有自动托管的版主/小版主
        auto_approved_by = _check_auto_approve(course)
        if auto_approved_by:
            is_auto_approved = True

    review_status = "approved" if is_auto_approved else "pending"

    material = Material.objects.create(
        course=course, title=title, description=description,
        teacher=teacher,
        file_name=uploaded_file.name,
        file_path=f"{course_code}/{safe_name}",
        file_size=file_size,
        uploader=request.user,
        uploader_name=request.user.first_name or request.user.username,
        review_status=review_status,
        is_approved=is_auto_approved,
        reviewed_by=auto_approved_by,
        reviewed_at=timezone.now() if auto_approved_by else None,
    )

    # 尝试 git commit
    try:
        from git_storage import commit_file
        commit_file(f"{course_code}/{safe_name}")
    except Exception:
        pass

    # 发送通知：审核中 / 已通过
    if review_status == "pending":
        # 自动路由计算
        assigned = _calculate_review_assignment(material)
        if assigned:
            material.assigned_moderator = assigned
            material.save(update_fields=["assigned_moderator"])

        _create_notification(
            recipient=request.user,
            type=Notification.Type.REPORT,  # 暂用 report 类型
            title="资料已提交，等待审核",
            message=f"你的资料「{title}」已提交，审核通过后即可被其他同学下载。",
            material=material,
        )
    elif auto_approved_by:
        # 自动托管：不发送通知，上传者端延迟 1 分钟才显示"已通过"
        pass
    else:
        # 管理员自身上传，直接通过
        pass

    return _ok({
        "id": material.id, "title": material.title,
        "file_name": uploaded_file.name, "file_size": file_size,
        "created_at": material.created_at.strftime("%Y-%m-%d"),
        "review_status": material.review_status,
        "is_approved": material.is_approved,
        "assigned_moderator": material.assigned_moderator_id,
        "assigned_moderator_name": material.assigned_moderator.first_name or material.assigned_moderator.username
            if material.assigned_moderator else None,
    })


def api_file_download(request, file_id):
    """GET /api/files/<id>/download — 支持 ?preview=1 内联预览"""
    material = get_object_or_404(Material, id=file_id)
    file_path = Path(settings.MEDIA_ROOT) / material.file_path

    if not file_path.exists():
        return _err("文件不存在", 404)

    # 下载权限校验：未登录访客不可下载
    user = _get_user(request)
    if user is None:
        return _err("请先登录后再下载", 401)

    # 审核员可以下载待审文件（用于审核）
    if not material.is_approved:
        try:
            _check_moderator_access(user, material)
        except Exception:
            return _err("该资料未通过审核，暂不可下载", 403)

    # 预览模式：不计配额、不计下载数、内联渲染
    is_preview = request.GET.get("preview") == "1"
    if is_preview:
        response = FileResponse(
            open(file_path, "rb"),
            as_attachment=False,
            filename=material.file_name or material.title,
        )
        response['X-Frame-Options'] = 'SAMEORIGIN'  # 允许在 embed 中渲染
        return response

    # 下载配额校验
    allowed, remaining, msg = _check_download_quota(user)
    if not allowed:
        return _err(msg, 429)

    Material.objects.filter(id=file_id).update(
        download_count=material.download_count + 1
    )

    # 记录下载历史
    try:
        DownloadRecord.objects.create(
            user=user,
            material=material,
            course_code=material.course.code if material.course_id else "",
            course_name=material.course.name if material.course_id else "",
            material_title=material.title,
            file_name=material.file_name,
        )
    except Exception:
        pass  # 记录失败不影响下载

    return FileResponse(
        open(file_path, "rb"),
        as_attachment=True,
        filename=material.file_name or material.title,
    )


@csrf_exempt
@require_login
def api_file_delete(request, file_id):
    """DELETE /api/files/<id>/delete/ — 删除文件"""
    if request.method != "DELETE":
        return _err("仅支持 DELETE", 405)

    material = get_object_or_404(Material, id=file_id)

    # 权限校验
    profile = _get_or_create_profile(request.user)
    is_self_delete = material.uploader_id == request.user.id and profile.role == UserProfile.Role.USER
    if profile.role == UserProfile.Role.SUPER_ADMIN:
        pass  # 总管理员可删任意
    elif material.uploader_id == request.user.id:
        if material.review_status not in ("rejected",):
            if profile.role == UserProfile.Role.USER:
                # 普通用户可删除自己的任何资料（已通过的可删，但需确认）
                pass
            else:
                return _err("仅可删除已被驳回的资料", 403)
    elif profile.role in (UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR):
        # 版主/小版主检查是否在管辖板块内
        try:
            _check_moderator_access(request.user, material)
        except Exception:
            return _err("无权删除该资料", 403)
    else:
        return _err("无权删除该资料", 403)

    # 存档删除记录
    import json
    try:
        body = json.loads(request.body) if request.body else {}
    except Exception:
        body = {}
    delete_reason = body.get("reason", "")
    DeletionRecord.objects.create(
        material_id=material.id,
        title=material.title,
        file_name=material.file_name,
        file_size=material.file_size,
        course_code=material.course.code if material.course else "",
        course_name=material.course.name if material.course else "",
        college_id=material.course.college_id if material.course and material.course.college else None,
        uploader_name=material.uploader_name or (material.uploader.first_name if material.uploader else "匿名"),
        deleted_by=request.user,
        delete_reason=delete_reason,
    )

    # 非本人删除且填写了理由 → 通知文件上传者
    if not is_self_delete and delete_reason and material.uploader and material.uploader_id != request.user.id:
        _create_notification(
            recipient=material.uploader,
            type=Notification.Type.FILE_DELETED,
            title="你的资料被管理员删除",
            message=f"管理员{request.user.first_name or request.user.username}删除了你的资料「{material.title}」（{material.course.name if material.course else '未知课程'}）。\n删除理由：{delete_reason}\n你可以在此课程目录下重新上传。",
            material=material,
            course_code=material.course.code if material.course else "",
            course_name=material.course.name if material.course else "",
            triggered_by=request.user,
        )

    # 普通用户自行删除时，通知管理员关注
    if is_self_delete:
        _create_notification(
            recipient=request.user,
            type=Notification.Type.FILE_DELETED,
            title="你删除了资料",
            message=f"你已删除资料「{material.title}」（{material.course.name if material.course else '未知课程'}）。",
            course_code=material.course.code if material.course else "",
            course_name=material.course.name if material.course else "",
        )
        # 同时通知所有超级管理员和相关版主
        from django.contrib.auth.models import User as AuthUser
        admins = AuthUser.objects.filter(
            userprofile__role__in=[UserProfile.Role.SUPER_ADMIN, UserProfile.Role.MODERATOR]
        ).exclude(id=request.user.id).distinct()
        for admin in admins:
            _create_notification(
                recipient=admin,
                type=Notification.Type.FILE_DELETED,
                title="用户自行删除资料",
                message=f"用户 {material.uploader_name or request.user.username} 删除了资料「{material.title}」（{material.course.name if material.course else '未知课程'}）。",
                course_code=material.course.code if material.course else "",
                course_name=material.course.name if material.course else "",
                triggered_by=request.user,
            )

    # 删除磁盘文件
    file_path = Path(settings.MEDIA_ROOT) / material.file_path
    if file_path.exists():
        file_path.unlink()

    # 删除数据库记录
    material.delete()

    return _ok({"message": "文件已删除"})


# ═══════════════════════════════════════════════════════════════
# 搜索
# ═══════════════════════════════════════════════════════════════

def api_search(request):
    """GET /api/search?q="""
    q = request.GET.get("q", "").strip()
    if len(q) < 1:
        return _ok({"query": q, "courses": [], "materials": []})

    courses = Course.objects.filter(
        Q(name__icontains=q) | Q(code__icontains=q)
    ).annotate(
        material_cnt=Count("materials", filter=Q(materials__is_approved=True)),
    )[:20]

    materials = Material.objects.filter(is_approved=True).filter(
        Q(title__icontains=q) | Q(description__icontains=q) |
        Q(course__name__icontains=q)
    ).select_related("course")[:20]

    return _ok({
        "query": q,
        "courses": [
            {"id": c.id, "name": c.name, "code": c.code,
             "course_type": c.course_type,
             "college": c.college.name if c.college else None,
             "material_count": c.material_cnt}
            for c in courses
        ],
        "materials": [
            {"id": m.id, "title": m.title,
             "course_name": m.course.name, "course_code": m.course.code,
             "file_name": m.file_name, "file_size": m.file_size,
             "uploader": m.uploader_name or (m.uploader.first_name if m.uploader else "匿名"),
             "teacher": m.teacher,
             "review_status": m.review_status,
             "created_at": m.created_at.strftime("%Y-%m-%d")}
            for m in materials
        ],
    })


# ═══════════════════════════════════════════════════════════════
# 课程导航树
# ═══════════════════════════════════════════════════════════════

def _build_tree_node(qs):
    """递归构建课程树节点"""
    result = []
    for cat in qs:
        if cat.is_divider:
            result.append({"divider": True})
            continue

        node = {}
        if cat.name:
            node["name"] = cat.name
        if cat.icon_class:
            node["iconClass"] = cat.icon_class
        if cat.is_math_card:
            node["mathCard"] = True

        children = cat.children.all()
        if children:
            node["children"] = _build_tree_node(children)
        elif cat.course_id:
            # 叶子节点：关联真实课程
            node["courseId"] = cat.course.code
            node["hasFiles"] = Material.objects.filter(
                course=cat.course, is_approved=True
            ).exists()
        elif cat.course_text:
            # 叶子节点：通配符代码（如 "GEN02***"）或精确课程代码
            code = cat.course_text.replace("*", "").replace("-", "")
            if code:
                # 精确值（无通配符）：尝试解析为真实课程代码
                if "*" not in cat.course_text:
                    real = Course.objects.filter(code__startswith=code)
                    if real.count() == 1:
                        node["courseId"] = real[0].code
                    else:
                        node["courseId"] = cat.course_text
                else:
                    node["courseId"] = cat.course_text
                node["hasFiles"] = Material.objects.filter(
                    course__code__startswith=code, is_approved=True
                ).exists()

        result.append(node)

    # 纯叶子节点层：有资料的课程浮到顶端
    if result and not any("children" in r for r in result):
        result.sort(key=lambda r: (0 if r.get("hasFiles") else 1, r.get("name", "")))

    return result


def api_course_tree(request):
    """GET /api/courses/tree — 课程导航树（动态构建，含实时 hasFiles）"""
    roots = CourseCategory.objects.filter(parent=None).order_by("order")
    tree = {}
    for root in roots:
        children = root.children.all()
        if children:
            tree[root.name] = {"children": _build_tree_node(children)}
    return _ok(tree)


# ═══════════════════════════════════════════════════════════════
# 统计
# ═══════════════════════════════════════════════════════════════

def api_stats(request):
    limit = request.GET.get("limit", 5)
    try:
        limit = int(limit) if limit else None
    except ValueError:
        limit = 5

    top = Material.objects.filter(is_approved=True).select_related(
        "course__college"
    ).order_by("-download_count")[:limit]
    recent = Material.objects.filter(is_approved=True).select_related(
        "course__college"
    ).order_by("-created_at")[:limit]

    # 只统计有已获批材料的课程
    courses_with_materials = Course.objects.filter(
        materials__is_approved=True
    ).distinct()
    colleges_with_materials = College.objects.filter(
        course__materials__is_approved=True
    ).distinct()
    general_with_data = courses_with_materials.filter(course_type="general").count()
    major_with_data = courses_with_materials.filter(course_type="major").count()

    return _ok({
        "course_count": Course.objects.count(),
        "course_with_data_count": courses_with_materials.count(),
        "general_count": Course.objects.filter(course_type="general").count(),
        "major_count": Course.objects.filter(course_type="major").count(),
        "general_with_data_count": general_with_data,
        "major_with_data_count": major_with_data,
        "material_count": Material.objects.filter(is_approved=True).count(),
        "user_count": User.objects.count(),
        "college_count": College.objects.count(),
        "college_with_data_count": colleges_with_materials.count(),
        "colleges_with_data": [
            {"id": c.id, "name": c.name}
            for c in colleges_with_materials.order_by("name")
        ],
        "top_downloaded": [
            {"id": m.id, "title": m.title,
             "course_name": m.course.name, "course_code": m.course.code,
             "college": m.course.college.name if m.course.college else None,
             "download_count": m.download_count}
            for m in top
        ],
        "recent_uploads": [
            {"id": m.id, "title": m.title,
             "course_name": m.course.name, "course_code": m.course.code,
             "college": m.course.college.name if m.course.college else None,
             "created_at": m.created_at.strftime("%Y-%m-%d"),
             "uploader": m.uploader_name or (m.uploader.first_name if m.uploader else "匿名"),
             "review_status": m.review_status}
            for m in recent
        ],
    })


def api_colleges(request):
    """GET /api/colleges/ — 学院列表（供小版主角色分配使用）"""
    colleges = College.objects.all().order_by("order", "name")
    return _ok([
        {"id": c.id, "name": c.short_name or c.name}
        for c in colleges
    ])


# ═══════════════════════════════════════════════════════════════
# 审核 API（Iter 3）
# ═══════════════════════════════════════════════════════════════

def _find_moderators_for_course(course):
    """查找管辖该课程的版主（通过 managed_majors / can_moderate_general / moderated_sections）"""
    mods = UserProfile.objects.filter(
        role=UserProfile.Role.MODERATOR,
    ).prefetch_related("managed_majors", "moderated_sections")
    result = []
    for mp in mods:
        # 1. 通过学院管辖
        if course.college_id and mp.managed_majors.filter(id=course.college_id).exists():
            result.append(mp)
            continue
        # 2. 通识课全量覆盖
        if course.college_id is None and mp.can_moderate_general:
            result.append(mp)
            continue
        # 3. 通识课具体子类（moderated_sections）
        for cat in mp.moderated_sections.all():
            if course in _get_courses_in_category(cat):
                result.append(mp)
                break
    return result


def _calculate_review_assignment(material):
    """
    审核路由逻辑：
    专业课 → 有小版主？→ 推给小版主
           → 无小版主？→ 推给版主（板块版主）
           → 无版主？→ 不指派（所有版主/总管理员可见）
    通识课 → 推给板块对应的版主
           → 无对应督学？→ 不指派（所有版主/总管理员可见）
    返回 User 或 None
    """
    course = material.course
    if course.course_type == CourseType.MAJOR and course.college_id:
        # 查找管理该专业的小版主（通过 CourseCategory 节点）
        sub_mods = UserProfile.objects.filter(
            role=UserProfile.Role.SUB_MODERATOR,
        ).prefetch_related("moderated_sections")
        for sm in sub_mods:
            for cat in sm.moderated_sections.all():
                if course in _get_courses_in_category(cat):
                    return sm.user

        # 无小版主，找版主
        mods = _find_moderators_for_course(course)
        if mods:
            return mods[0].user
    else:
        # 通识课：找板块对应的版主
        mods = _find_moderators_for_course(course)
        if mods:
            return mods[0].user

    return None  # 无人指派，对所有管理可见


def _get_courses_in_category(cat):
    """递归获取分类节点下所有 Course 实例"""
    courses = []
    if cat.course_id:
        courses.append(cat.course)
    if cat.course_text:
        code = cat.course_text.replace("*", "").replace("-", "")
        if code:
            courses.extend(Course.objects.filter(code__startswith=code))
    for child in cat.children.all():
        courses.extend(_get_courses_in_category(child))
    return courses


def _get_moderated_material_qs(user, include_assigned=True):
    """获取用户权限范围内的 Material QuerySet

    Args:
        user: 当前用户
        include_assigned: 是否包含通过路由指派（assigned_moderator）给该用户的待审核资料
    """
    profile = _get_or_create_profile(user)
    if profile.role == UserProfile.Role.SUPER_ADMIN:
        qs = Material.objects.select_related("course", "uploader")
        if include_assigned:
            return qs
        return qs

    if profile.role == UserProfile.Role.SUB_MODERATOR:
        # 小版主：通过 CourseCategory 节点管辖范围内的资料 + 指派给自己的 + 自己上传的
        all_courses = []
        for cat in profile.moderated_sections.all():
            all_courses.extend(_get_courses_in_category(cat))
        q = Q(course__in=set(all_courses)) if all_courses else Q(pk__in=[])
        q |= Q(uploader=user)  # 始终能看到自己的上传
        if include_assigned:
            q |= Q(assigned_moderator=user)
        return Material.objects.filter(q).select_related("course", "uploader")

    # moderator（版主）：从管辖学院 + 通识课权限递归出所有课程
    all_courses = set()
    for college in profile.managed_majors.all():
        all_courses.update(Course.objects.filter(college=college))
    if profile.can_moderate_general:
        all_courses.update(Course.objects.filter(college_id__isnull=True))
    for cat in profile.moderated_sections.all():
        all_courses.update(_get_courses_in_category(cat))
    q = Q(course__in=all_courses) if all_courses else Q(pk__in=[])
    q |= Q(uploader=user)  # 始终能看到自己的上传
    if include_assigned:
        q |= Q(assigned_moderator=user)
    return Material.objects.filter(q).select_related("course", "uploader")


@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_pending(request):
    """GET /api/moderation/pending/ — 待审核列表
    ?include_subordinate=1  — 包含下级版主辖区的待审核（用于上级越级管辖）"""
    from datetime import timedelta
    recently = timezone.now() - timedelta(hours=24)
    include_subordinate = request.GET.get("include_subordinate") == "1"
    qs = _get_moderated_material_qs(request.user).filter(
        Q(review_status="pending") |
        (Q(review_status="approved", reviewed_at__gte=recently) & ~Q(reviewed_by=request.user))
    )
    # 隐藏同僚已通过（仅保留待审核）
    hide_peer_approved = request.GET.get("hide_peer_approved") == "1"
    if hide_peer_approved:
        qs = qs.filter(review_status="pending")

    qs = qs.order_by("-created_at")

    # 清理失效指派：assigned_moderator 指向的用户不再是活跃的小版主 → 清空指派
    # 这样被移除的小版主的旧资料会自动回退给上级
    stale_qs = qs.filter(
        review_status="pending",
        assigned_moderator__isnull=False,
    ).exclude(
        assigned_moderator__profile__role=UserProfile.Role.SUB_MODERATOR
    )
    stale_ids = list(stale_qs.values_list("id", flat=True)[:200])
    if stale_ids:
        Material.objects.filter(id__in=stale_ids).update(assigned_moderator=None)

    # 预计算被下级版主覆盖的课程 ID（仅 moderator+super_admin 需要），
    # 用于在 UI 中标记"此内容有下级版主在处理"，但不阻止上级操作。
    subordinate_course_ids = _get_subordinate_covered_course_ids(request.user)

    # 默认过滤掉已有下级版主处理的待审核（上级仍可通过 include_subordinate=1 查看）
    if not include_subordinate and subordinate_course_ids:
        qs = qs.filter(
            Q(review_status="approved") |  # 同僚已通过的始终显示
            ~(Q(review_status="pending") & Q(course_id__in=subordinate_course_ids))
        )

    def _serialize(m):
        is_peer_approved = m.review_status == "approved" and m.reviewed_by_id != request.user.id
        # 动态检测：如果该课程当前有活跃的小版主管辖 → is_subordinate_handled
        # 如果小版主已被移除，subordinate_course_ids 自然不包含此课程，is_sub 即为 False
        is_sub = (m.review_status == "pending" and m.course_id in subordinate_course_ids)
        return {
            "id": m.id,
            "title": m.title,
            "course_name": m.course.name,
            "course_code": m.course.code,
            "uploader_name": m.uploader_name or (m.uploader.first_name if m.uploader else "匿名"),
            "file_size": m.file_size,
            "file_type": m.material_type.name if hasattr(m, "material_type") and m.material_type else (m.file_type or "其他"),
            "created_at": m.created_at.strftime("%Y-%m-%d %H:%M"),
            "is_own": m.uploader_id == request.user.id,
            "is_peer_approved": is_peer_approved,
            "is_subordinate_handled": is_sub,
            "approved_by_name": (m.reviewed_by.first_name or m.reviewed_by.username) if is_peer_approved and m.reviewed_by else None,
            "approved_at": m.reviewed_at.strftime("%Y-%m-%d %H:%M") if is_peer_approved and m.reviewed_at else None,
            "review_notes": m.review_notes if m.review_status == "rejected" else "",
            "review_status": m.review_status,
        }
    return _ok([_serialize(m) for m in qs])


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_batch_approve(request):
    """POST /api/moderation/batch-approve/ — 一键通过全部待审核"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    qs = _get_moderated_material_qs(request.user).filter(
        review_status="pending"
    ).exclude(uploader=request.user)
    count = qs.count()
    now = timezone.now()
    qs.update(
        is_approved=True,
        review_status="approved",
        reviewed_by=request.user,
        reviewed_at=now,
    )
    return _ok({"approved_count": count})


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_approve(request, file_id):
    """POST /api/moderation/<id>/approve/ — 批准"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)

    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        body = {}

    material = get_object_or_404(Material, id=file_id)
    _check_moderator_access(request.user, material)

    if material.review_status != "pending":
        return _err("该资料已审核，不可重复操作")

    notes = (body.get("notes") or "").strip()
    material.review_status = "approved"
    material.is_approved = True
    material.review_notes = notes
    material.reviewed_by = request.user
    material.reviewed_at = timezone.now()
    material.save()

    # 通知上传者
    if material.uploader:
        _create_notification(
            recipient=material.uploader,
            type=Notification.Type.APPROVED,
            title="你的资料已通过审核",
            message=f"你的资料「{material.title}」已通过审核，现在可以下载了。",
            material=material,
            triggered_by=request.user,
        )

    return _ok({"message": "已通过"})


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_reject(request, file_id):
    """POST /api/moderation/<id>/reject/ — 驳回"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)

    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("请求格式错误")

    notes = (body.get("notes") or "").strip()
    if not notes:
        return _err("驳回原因不能为空")

    material = get_object_or_404(Material, id=file_id)
    _check_moderator_access(request.user, material)

    if material.review_status != "pending":
        return _err("该资料已审核，不可重复操作")

    material.review_status = "rejected"
    material.is_approved = False
    material.review_notes = notes
    material.reviewed_by = request.user
    material.reviewed_at = timezone.now()
    material.save()

    # 通知上传者
    if material.uploader:
        _create_notification(
            recipient=material.uploader,
            type=Notification.Type.REJECTED,
            title="你的资料未通过审核",
            message=f"你的资料「{material.title}」未通过审核。\n原因：{notes}",
            material=material,
            triggered_by=request.user,
        )

    return _ok({"message": "已驳回"})


@csrf_exempt
@require_role(UserProfile.Role.SUPER_ADMIN)
def api_moderation_reassign(request, file_id):
    """POST /api/moderation/<id>/reassign/ — 手动指派审核人（手动分流）"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)

    material = get_object_or_404(Material, id=file_id, review_status="pending")

    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("请求格式错误")

    new_mod_id = body.get("assigned_moderator")
    if new_mod_id is not None:
        material.assigned_moderator = get_object_or_404(User, id=new_mod_id)
    else:
        material.assigned_moderator = None  # 清除指派，回归自动路由
    material.save(update_fields=["assigned_moderator"])

    return _ok({"message": "已重新指派"})


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_review_comments(request, file_id):
    """GET/POST /api/moderation/<id>/comments/ — 审核异议/评论
    POST 仅允许对已通过审核的资料提出异议（24h 窗口内）。"""
    material = get_object_or_404(Material, id=file_id)
    try:
        _check_moderator_access(request.user, material)
    except Exception:
        return _err("无权查看该资料的评论", 403)

    if request.method == "POST":
        # 仅已审核通过的资料可提异议
        if material.review_status != "approved":
            return _err("仅可对已通过审核的资料提出异议", 400)

        try:
            body = json.loads(request.body)
        except json.JSONDecodeError:
            return _err("请求格式错误")

        parent_id = body.get("parent_id")
        # 如果是回复（parent_id 存在），跳过"不能给自己通过"的限制
        if not parent_id:
            if material.reviewed_by == request.user:
                return _err("不能给自己通过的文件提出异议", 400)

        content = (body.get("content") or "").strip()
        if not content:
            return _err("内容不能为空")

        parent_comment = None
        if parent_id is not None:
            parent_comment = get_object_or_404(ReviewComment, id=parent_id, material=material)

        comment = ReviewComment.objects.create(
            material=material,
            commenter=request.user,
            content=content,
            parent=parent_comment,
        )

        # 通知：如果是回复，通知被回复者；否则通知原审核人
        if parent_comment:
            notify_user = parent_comment.commenter
            if notify_user != request.user:
                _create_notification(
                    recipient=notify_user,
                    type=Notification.Type.DISAGREE,
                    title="你的异议被回复",
                    message=f"{request.user.first_name or request.user.username} 回复了你的异议：\n{content}",
                    material=material,
                    triggered_by=request.user,
                )
        elif material.reviewed_by and material.reviewed_by != request.user:
            _create_notification(
                recipient=material.reviewed_by,
                type=Notification.Type.DISAGREE,
                title="你的审核被提出异议",
                message=f"{request.user.first_name or request.user.username} 对资料「{material.title}」提出了审核异议：\n{content}",
                material=material,
                triggered_by=request.user,
            )

    comments = ReviewComment.objects.filter(material=material).select_related("commenter")
    return _ok({
        "comments": [
            {
                "id": c.id,
                "parent_id": c.parent_id,
                "commenter_name": c.commenter.first_name or c.commenter.username,
                "content": c.content,
                "created_at": c.created_at.strftime("%Y-%m-%d %H:%M"),
            }
            for c in comments
        ],
        "count": comments.count(),
    })


def _check_moderator_access(user, material):
    """校验 moderator / sub_moderator 是否有权操作该资料"""
    profile = _get_or_create_profile(user)
    if profile.role == UserProfile.Role.SUPER_ADMIN:
        return  # super_admin 有权操作一切
    if profile.role == UserProfile.Role.SUB_MODERATOR:
        # 小版主：必须管辖该资料所在课程（通过课程分类节点）
        cat_ids = set(profile.moderated_sections.values_list("id", flat=True))
        all_courses = []
        for cat_id in cat_ids:
            try:
                cat = CourseCategory.objects.get(id=cat_id)
                all_courses.extend(_get_courses_in_category(cat))
            except CourseCategory.DoesNotExist:
                continue
        if material.course not in set(all_courses) and material.assigned_moderator_id != user.id:
            from django.http import Http404
            raise Http404("无权操作该资料")
        return
    # moderator（版主）：必须管辖该资料所在课程所属的学院/大类
    colleges = set(profile.managed_majors.values_list("id", flat=True))
    if material.course.college_id is None:
        # 通识课：college_id 为 None
        if profile.can_moderate_general:
            return
        # 检查具体通识课子类权限
        for cat in profile.moderated_sections.all():
            if material.course in _get_courses_in_category(cat):
                return
        if material.assigned_moderator_id != user.id:
            from django.http import Http404
            raise Http404("无权操作该资料")
        return
    if material.course.college_id in colleges:
        return
    # 检查 moderated_sections 额外权限（具体通识课子类等）
    for cat in profile.moderated_sections.all():
        if material.course in _get_courses_in_category(cat):
            return
    if material.assigned_moderator_id == user.id:
        return
    from django.http import Http404
    raise Http404("无权操作该资料")


def _unique_college_names(colleges):
    """College 列表按全称去重（必须用 c.name 而非 short_name，防止同名不同简称导致重复显示）"""
    seen = set()
    result = []
    for c in colleges:
        if c.name not in seen:
            seen.add(c.name)
            result.append({"id": c.id, "name": c.short_name or c.name})
    return result


def _get_managed_sections_display(profile):
    """返回用户管辖范围的可读描述（用于个人中心显示），仅显示最高层级"""
    if profile.role == UserProfile.Role.MODERATOR:
        parts = []
        seen = set()
        for c in profile.managed_majors.all():
            name = c.short_name or c.name
            if name not in seen:
                seen.add(name)
                parts.append(name)
        if profile.can_moderate_general:
            parts.append("通识课")
        elif profile.moderated_sections.exists():
            for s in profile.moderated_sections.all():
                if s.name and s.name not in parts:
                    parts.append(s.name)
        return parts or "未分配"
    elif profile.role == UserProfile.Role.SUB_MODERATOR:
        sections = list(profile.moderated_sections.all())
        all_ids = set(s.id for s in sections)
        # 仅显示最高层级的节点（其父节点不在管辖范围内）
        top = [s for s in sections if s.parent_id not in all_ids]
        parts = []
        for s in top:
            n = s.name or f"节点 #{s.id}"
            if n not in parts:
                parts.append(n)
        return parts or "未分配"
    return []


@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_history(request):
    """GET /api/moderation/history/ — 审核历史"""
    qs = _get_moderated_material_qs(request.user).filter(
        review_status__in=["approved", "rejected"]
    )

    # 筛选
    status = request.GET.get("status")
    if status in ("approved", "rejected"):
        qs = qs.filter(review_status=status)

    course_code = request.GET.get("course_code")
    if course_code:
        qs = qs.filter(course__code__icontains=course_code)

    # NULL reviewed_at（管理员自传）排最前，其余按审核时间降序
    qs = qs.order_by(F("reviewed_at").desc(nulls_first=True))

    # 分页
    page = int(request.GET.get("page", 1))
    per_page = int(request.GET.get("per_page", 20))
    page = max(1, page)
    per_page = min(100, max(1, per_page))
    total = qs.count()
    items = qs[(page - 1) * per_page : page * per_page]

    from datetime import timedelta
    recently = timezone.now() - timedelta(hours=24)
    return _ok({
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page,
        "items": [
            {
                "id": m.id,
                "title": m.title,
                "course_name": m.course.name,
                "course_code": m.course.code,
                "uploader_name": m.uploader_name or (m.uploader.first_name if m.uploader else "匿名"),
                "review_status": m.review_status,
                "review_notes": m.review_notes,
                "reviewed_by_name": (m.reviewed_by.first_name or m.reviewed_by.username) if m.reviewed_by else "未知",
                "reviewed_at": m.reviewed_at.strftime("%Y-%m-%d %H:%M") if m.reviewed_at else "",
                "created_at": m.created_at.strftime("%Y-%m-%d %H:%M"),
                "can_object": m.review_status == "approved" and m.reviewed_at and m.reviewed_at >= recently and m.reviewed_by_id != request.user.id,
                "is_admin_uploaded": m.reviewed_by is None and m.review_status == "approved",
            }
            for m in items
        ],
    })


@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_stats(request):
    """GET /api/moderation/stats/ — 审核统计概览"""
    qs = _get_moderated_material_qs(request.user)
    today = date.today()

    pending_count = qs.filter(review_status="pending").count()
    approved_count = qs.filter(
        review_status="approved",
        reviewed_at__date=today,
    ).count()
    rejected_count = qs.filter(
        review_status="rejected",
        reviewed_at__date=today,
    ).count()
    total_approved = qs.filter(review_status="approved").count()

    return _ok({
        "pending_count": pending_count,
        "approved_today": approved_count,
        "rejected_today": rejected_count,
        "total_approved": total_approved,
        "total_materials": qs.count(),
    })


# ═══════════════════════════════════════════════════════════════
# 删除记录 API
# ═══════════════════════════════════════════════════════════════

def _get_visible_deletion_records(user):
    """获取管理员可见的删除记录（按管辖范围过滤）"""
    from .models import Course  # local import to avoid cycles
    profile = _get_or_create_profile(user)
    if profile.role == UserProfile.Role.SUPER_ADMIN:
        return DeletionRecord.objects.all()

    visible_codes = set()
    if profile.role == UserProfile.Role.MODERATOR:
        college_ids = list(profile.managed_majors.values_list("id", flat=True))
        for c in Course.objects.filter(college_id__in=college_ids).only("code"):
            if c.code: visible_codes.add(c.code)
        if profile.can_moderate_general:
            for c in Course.objects.filter(college__isnull=True).only("code"):
                if c.code: visible_codes.add(c.code)
        for cat_id in profile.moderated_sections.values_list("id", flat=True):
            try:
                cat = CourseCategory.objects.get(id=cat_id)
                for c in _get_courses_in_category(cat):
                    if c.code: visible_codes.add(c.code)
            except CourseCategory.DoesNotExist:
                continue
    elif profile.role == UserProfile.Role.SUB_MODERATOR:
        for cat_id in profile.moderated_sections.values_list("id", flat=True):
            try:
                cat = CourseCategory.objects.get(id=cat_id)
                for c in _get_courses_in_category(cat):
                    if c.code: visible_codes.add(c.code)
            except CourseCategory.DoesNotExist:
                continue

    if visible_codes:
        return DeletionRecord.objects.filter(course_code__in=visible_codes)
    return DeletionRecord.objects.none()


@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_deletion_records(request):
    """GET /api/moderation/deletions/ — 已删除资料记录（按管辖范围过滤）"""
    page = int(request.GET.get("page", 1))
    per_page = min(int(request.GET.get("per_page", 20)), 100)
    qs = _get_visible_deletion_records(request.user)
    total = qs.count()
    total_pages = (total + per_page - 1) // per_page if total > 0 else 1
    start = (page - 1) * per_page
    records = qs[start:start + per_page]

    from datetime import timedelta
    now = timezone.now()

    def _serialize(r):
        can_restore = False
        if not r.is_restored:
            age = now - r.deleted_at
            if age.total_seconds() < 48 * 3600:
                # 有权限：自己删的 or 上级 or super_admin
                profile = _get_or_create_profile(request.user)
                if (profile.role == UserProfile.Role.SUPER_ADMIN
                        or r.deleted_by_id == request.user.id
                        or profile.role in (UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR)):
                    can_restore = True
        return {
            "id": r.id,
            "material_id": r.material_id,
            "title": r.title,
            "file_name": r.file_name,
            "file_size": r.file_size,
            "course_code": r.course_code,
            "course_name": r.course_name,
            "uploader_name": r.uploader_name,
            "deleted_by_id": r.deleted_by_id,
            "deleted_by_name": r.deleted_by.first_name or r.deleted_by.username if r.deleted_by else "未知",
            "deleted_at": r.deleted_at.strftime("%Y-%m-%d %H:%M") if r.deleted_at else "",
            "delete_reason": r.delete_reason or "",
            "is_restored": r.is_restored,
            "can_restore": can_restore,
        }

    return _ok({
        "items": [_serialize(r) for r in records],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
    })


# ═══════════════════════════════════════════════════════════════
# 文件管理 API（Iter 6 — 管理模式）
# ═══════════════════════════════════════════════════════════════

@csrf_exempt
@require_login
def api_file_update(request, file_id):
    """PATCH /api/files/<id>/update/ — 更新文件元信息（标题/任课教师/简介）"""
    if request.method != "PATCH":
        return _err("仅支持 PATCH", 405)
    material = get_object_or_404(Material, id=file_id)
    profile = _get_or_create_profile(request.user)
    # 仅上传者本人或有管辖权限的管理员可编辑
    if material.uploader_id != request.user.id:
        if profile.role not in (UserProfile.Role.SUPER_ADMIN, UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR):
            return _err("无权编辑", 403)
        try:
            _check_moderator_access(request.user, material)
        except Exception:
            return _err("无权编辑该资料", 403)
    try:
        body = json.loads(request.body)
    except Exception:
        return _err("请求格式错误")
    updated = []
    if "title" in body and body["title"].strip():
        material.title = body["title"].strip()
        updated.append("title")
    if "teacher" in body:
        material.teacher = body["teacher"].strip()
        updated.append("teacher")
    if "description" in body:
        material.description = body["description"].strip()
        updated.append("description")
    if updated:
        material.save(update_fields=updated)
    return _ok({"id": material.id, "title": material.title, "teacher": material.teacher, "description": material.description})


@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_folder_create(request):
    """POST /api/folders/create/ — 新建文件夹（CourseCategory）"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body)
    except Exception:
        return _err("请求格式错误")
    name = (body.get("name") or "").strip()
    parent_id = body.get("parent_id")
    folder_type = body.get("folder_type", "")  # ""=普通  "leaf"=底层
    if not name:
        return _err("文件夹名称不能为空")
    if parent_id:
        parent = get_object_or_404(CourseCategory, id=parent_id)
    else:
        parent = None
    cat = CourseCategory.objects.create(
        name=name,
        parent=parent,
        order=0,
    )
    # 记录操作
    path_parts = []
    p = cat.parent
    while p:
        path_parts.append(p.name or f"#{p.id}")
        p = p.parent
    parent_path = "/".join(reversed(path_parts))
    FolderOperation.objects.create(
        user=request.user,
        action=FolderOperation.Action.CREATE,
        category_id=cat.id,
        category_name=cat.name,
        parent_path=parent_path,
        folder_type=folder_type,
    )
    return _ok({"id": cat.id, "name": cat.name, "parent_id": cat.parent_id})


@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_folder_delete(request, folder_id):
    """DELETE /api/folders/<id>/ — 删除文件夹（仅可删无 course 关联的容器节点）"""
    if request.method != "DELETE":
        return _err("仅支持 DELETE", 405)
    cat = get_object_or_404(CourseCategory, id=folder_id)
    # 不可删除有 course 或 course_text 关联的系统节点
    if cat.course_id or cat.course_text:
        return _err("系统文件夹不可删除", 403)
    # 检查文件夹是否为空
    children = CourseCategory.objects.filter(parent=cat)
    child_count = children.count()
    if child_count > 0:
        return _err(f"文件夹不为空，已包含 {child_count} 个子文件夹，请先清空后再删除", 400)
    # 检查关联资料
    material_count = Material.objects.filter(course__in=Course.objects.filter(
        code__startswith=f"CAT{cat.id}_"  # 简单检查
    )).count()
    # 用更准确的方式检查：是否有课程分类指向此节点
    # 实际上，CourseCategory 本身不直接关联 Material，通过 Course 间接关联
    # 但这里只删除容器节点，不会删除课程
    # 记录路径
    path_parts = []
    p = cat.parent
    while p:
        path_parts.append(p.name or f"#{p.id}")
        p = p.parent
    parent_path = "/".join(reversed(path_parts))
    cat_name = cat.name or f"#{cat.id}"
    cat_id = cat.id
    cat.delete()
    FolderOperation.objects.create(
        user=request.user,
        action=FolderOperation.Action.DELETE,
        category_id=cat_id,
        category_name=cat_name,
        parent_path=parent_path,
    )
    # 通知其他超级管理员
    if request.user.profile.role != UserProfile.Role.SUPER_ADMIN:
        from django.contrib.auth.models import User as AuthUser
        admins = AuthUser.objects.filter(
            userprofile__role=UserProfile.Role.SUPER_ADMIN
        ).exclude(id=request.user.id)
        for admin in admins:
            _create_notification(
                recipient=admin,
                type=Notification.Type.OPERATION,
                title="文件夹被删除",
                message=f"{request.user.first_name or request.user.username} 删除了文件夹「{cat_name}」（路径：{parent_path}）。",
                triggered_by=request.user,
            )
    return _ok({"message": f"文件夹「{cat_name}」已删除"})


@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_operations(request):
    """GET /api/operations/ — 文件夹操作记录"""
    profile = _get_or_create_profile(request.user)
    qs = FolderOperation.objects.all().select_related("user")
    # 按管辖范围过滤
    if profile.role == UserProfile.Role.SUPER_ADMIN:
        pass  # 全可见
    else:
        # 获取当前管理员管辖范围内的课程分类 ID
        visible_cat_ids = set(profile.moderated_sections.values_list("id", flat=True))
        if profile.role == UserProfile.Role.MODERATOR:
            # 版主还可以看到自己管辖学院相关的操作
            college_ids = list(profile.managed_majors.values_list("id", flat=True))
            # 查找这些学院对应的 CourseCategory 节点（通过 course_text 前缀匹配）
            for cc in College.objects.filter(id__in=college_ids):
                for cat in CourseCategory.objects.filter(
                    Q(course_text__startswith=cc.slug.upper()[:3]) | Q(name=cc.short_name)
                ):
                    visible_cat_ids.add(cat.id)
        # 过滤操作记录
        if visible_cat_ids:
            qs = qs.filter(category_id__in=visible_cat_ids)
        else:
            qs = qs.none()
    page = int(request.GET.get("page", 1))
    per_page = min(int(request.GET.get("per_page", 20)), 100)
    total = qs.count()
    total_pages = (total + per_page - 1) // per_page if total > 0 else 1
    start = (page - 1) * per_page
    records = qs[start:start + per_page]

    from datetime import timedelta
    now = timezone.now()

    def _serialize(op):
        can_restore = False
        if not op.is_restored:
            age = now - op.created_at
            if age.total_seconds() < 48 * 3600:
                profile = _get_or_create_profile(request.user)
                if (profile.role == UserProfile.Role.SUPER_ADMIN
                        or op.user_id == request.user.id):
                    can_restore = True
        return {
            "id": op.id,
            "user_id": op.user_id,
            "user_name": op.user.first_name or op.user.username if op.user else "未知",
            "action": op.action,
            "action_label": op.get_action_display(),
            "category_id": op.category_id,
            "category_name": op.category_name,
            "parent_path": op.parent_path,
            "folder_type": op.folder_type,
            "reason": op.reason or "",
            "is_restored": op.is_restored,
            "can_restore": can_restore,
            "created_at": op.created_at.strftime("%Y-%m-%d %H:%M") if op.created_at else "",
        }

    return _ok({
        "items": [_serialize(r) for r in records],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
    })


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_folder_restore(request, operation_id):
    """POST /api/operations/<id>/restore/ — 撤销文件夹操作"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    op = get_object_or_404(FolderOperation, id=operation_id)
    if op.is_restored:
        return _err("该操作已撤销", 400)
    from datetime import timedelta
    if timezone.now() - op.created_at > timedelta(hours=48):
        return _err("已超过48小时，无法撤销", 400)
    try:
        body = json.loads(request.body) if request.body else {}
    except Exception:
        body = {}
    reason = body.get("reason", "")

    if op.action == FolderOperation.Action.CREATE:
        # 撤销创建 = 删除文件夹
        try:
            cat = CourseCategory.objects.get(id=op.category_id)
            if cat.course_id or cat.course_text:
                return _err("无法撤销：该文件夹已被系统使用", 400)
            cat.delete()
        except CourseCategory.DoesNotExist:
            pass  # 文件夹可能已被手动删除，仍标记撤销
    elif op.action == FolderOperation.Action.DELETE:
        # 撤销删除 = 重建文件夹
        parent = None
        if op.parent_path:
            # 根据 path 找父节点（简单方案：现有任何可用的父级）
            pass  # 暂时简单重建为根节点
        CourseCategory.objects.create(
            name=op.category_name,
            parent=None,
            order=0,
        )

    op.is_restored = True
    op.restored_at = timezone.now()
    op.restored_by = request.user
    op.reason = reason
    op.save(update_fields=["is_restored", "restored_at", "restored_by", "reason"])

    # 非本人撤销且填写了理由 → 通知原操作人
    if reason and op.user and op.user_id != request.user.id:
        _create_notification(
            recipient=op.user,
            type=Notification.Type.OPERATION,
            title="你的文件夹操作已被撤销",
            message=f"{request.user.first_name or request.user.username} 撤销了你的文件夹「{op.category_name}」的「{op.get_action_display()}」操作。\n撤销理由：{reason}",
            triggered_by=request.user,
        )

    return _ok({"message": "操作已撤销"})


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_restore_deletion(request, deletion_id):
    """POST /api/moderation/deletions/<id>/restore/ — 恢复已删除文件"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    dr = get_object_or_404(DeletionRecord, id=deletion_id)
    if dr.is_restored:
        return _err("该文件已恢复", 400)
    from datetime import timedelta
    if timezone.now() - dr.deleted_at > timedelta(hours=48):
        return _err("已超过48小时，无法恢复", 400)
    try:
        body = json.loads(request.body) if request.body else {}
    except Exception:
        body = {}
    reason = body.get("reason", "")

    # 重建 Material
    course = Course.objects.filter(code=dr.course_code).first()
    if not course:
        return _err("原课程已不存在，无法恢复", 400)
    material = Material.objects.create(
        course=course,
        title=dr.title,
        file_name=dr.file_name,
        file_size=dr.file_size,
        file_path="",  # 文件实际可能已从磁盘删除，只恢复记录
        uploader_name=dr.uploader_name,
        review_status="approved",
        is_approved=True,
        reviewed_by=dr.deleted_by,
    )
    dr.is_restored = True
    dr.restored_at = timezone.now()
    dr.restored_by = request.user
    dr.save(update_fields=["is_restored", "restored_at", "restored_by"])

    # 通知原上传者（如果非本人恢复）
    original_uploader = User.objects.filter(username=dr.uploader_name).first()
    if original_uploader and original_uploader != request.user:
        _create_notification(
            recipient=original_uploader,
            type=Notification.Type.OPERATION,
            title="你的资料已被恢复",
            message=f"管理员恢复了你的资料「{dr.title}」，现在可以查看和下载了。",
            material=material,
            course_code=dr.course_code,
            course_name=dr.course_name,
            triggered_by=request.user,
        )

    # 通知删除人
    if reason and dr.deleted_by and dr.deleted_by_id != request.user.id:
        _create_notification(
            recipient=dr.deleted_by,
            type=Notification.Type.OPERATION,
            title="你的删除操作已被撤销",
            message=f"管理员撤销了你对资料「{dr.title}」的删除操作。撤销理由：{reason}",
            material=material,
            course_code=dr.course_code,
            course_name=dr.course_name,
            triggered_by=request.user,
        )

    return _ok({"message": "文件已恢复", "material_id": material.id})


@csrf_exempt
@require_login
def api_file_batch_delete(request):
    """POST /api/files/batch-delete/ — 批量删除文件"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body)
    except Exception:
        return _err("请求格式错误")
    file_ids = body.get("file_ids", [])
    reason = body.get("reason", "")
    if not file_ids:
        return _err("请选择要删除的文件")
    profile = _get_or_create_profile(request.user)
    deleted = 0
    errors = []
    for fid in file_ids:
        try:
            m = Material.objects.get(id=fid)
            # 权限检查
            if profile.role == UserProfile.Role.SUPER_ADMIN:
                pass
            elif m.uploader_id == request.user.id:
                if m.review_status not in ("rejected",):
                    errors.append(f"文件#{fid}：仅可删除已驳回资料")
                    continue
            elif profile.role in (UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR):
                try:
                    _check_moderator_access(request.user, m)
                except Exception:
                    errors.append(f"文件#{fid}：无权删除")
                    continue
            else:
                errors.append(f"文件#{fid}：无权删除")
                continue
            DeletionRecord.objects.create(
                material_id=m.id, title=m.title,
                file_name=m.file_name, file_size=m.file_size,
                course_code=m.course.code if m.course else "",
                course_name=m.course.name if m.course else "",
                college_id=m.course.college_id if m.course and m.course.college else None,
                uploader_name=m.uploader_name or (m.uploader.first_name if m.uploader else "匿名"),
                deleted_by=request.user,
                delete_reason=reason,
            )
            m.delete()
            deleted += 1
        except Material.DoesNotExist:
            errors.append(f"文件#{fid}：不存在")
    # 通知受影响的文件上传者（去重，每次批量只发一条通知）
    if deleted > 0 and reason:
        notified_uploaders = set()
        for fid in file_ids:
            try:
                m = Material.objects.get(id=fid)
                if m.uploader and m.uploader_id not in notified_uploaders:
                    if m.uploader_id != request.user.id:
                        _create_notification(
                            recipient=m.uploader,
                            type=Notification.Type.FILE_DELETED,
                            title="你的资料被管理员批量删除",
                            message=f"管理员批量删除了你的一部分资料。\n删除理由：{reason}\n如有疑问请联系管理员。",
                            course_code=m.course.code if m.course else "",
                            course_name=m.course.name if m.course else "",
                            triggered_by=request.user,
                        )
                        notified_uploaders.add(m.uploader_id)
            except Material.DoesNotExist:
                continue
    return _ok({"deleted": deleted, "errors": errors, "total": len(file_ids)})


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_file_batch_edit(request):
    """POST /api/files/batch-edit/ — 批量修改文件元信息"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body)
    except Exception:
        return _err("请求格式错误")
    file_ids = body.get("file_ids", [])
    if not file_ids:
        return _err("请选择文件")
    updated = 0
    for fid in file_ids:
        try:
            m = Material.objects.get(id=fid)
            try:
                _check_moderator_access(request.user, m)
            except Exception:
                continue
            changed = False
            if "teacher" in body:
                m.teacher = body["teacher"].strip()
                changed = True
            if "description" in body:
                m.description = body["description"].strip()
                changed = True
            if changed:
                m.save(update_fields=["teacher", "description"])
                updated += 1
        except Material.DoesNotExist:
            continue
    return _ok({"updated": updated})


# ═══════════════════════════════════════════════════════════════
# 用户管理 API（Iter 3 — 仅 super_admin）
# ═══════════════════════════════════════════════════════════════

@require_role(UserProfile.Role.SUPER_ADMIN)
def api_admin_users(request):
    """GET /api/admin/users/ — 用户列表"""
    search = request.GET.get("search", "").strip()
    users = User.objects.select_related("profile").order_by("-date_joined")

    if search:
        users = users.filter(
            Q(username__icontains=search) |
            Q(email__icontains=search) |
            Q(first_name__icontains=search)
        )

    result = []
    for u in users[:200]:
        profile = _get_or_create_profile(u)
        result.append({
            "id": u.id,
            "username": u.username,
            "nickname": u.first_name or u.username,
            "email": u.email,
            "role": profile.role,
            "role_label": profile.get_role_display(),
            "moderated_sections": list(profile.moderated_sections.values_list("id", flat=True)),
            "moderated_sections_info": [
                {"id": c.id, "name": c.name or f"节点 #{c.id}", "parent_id": c.parent_id}
                for c in profile.moderated_sections.all()
            ],
            "managed_majors": list(profile.managed_majors.values_list("id", flat=True)),
            "managed_majors_info": _unique_college_names(profile.managed_majors.all()),
            "can_moderate_general": profile.can_moderate_general,
            "auto_approve": profile.auto_approve,
            "can_auto_approve": profile.can_auto_approve,
            "date_joined": u.date_joined.strftime("%Y-%m-%d"),
            "file_count": Material.objects.filter(uploader=u).count(),
        })
    return _ok(result)


@csrf_exempt
@require_role(UserProfile.Role.SUPER_ADMIN)
def api_admin_set_role(request, uid):
    """POST /api/admin/users/<id>/role/ — 修改角色"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)

    if uid == request.user.id:
        return _err("不能修改自己的角色", 400)

    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("请求格式错误")

    new_role = body.get("role", "")
    if new_role not in (UserProfile.Role.USER, UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR):
        return _err("无效的角色")

    target_user = get_object_or_404(User, id=uid)
    profile = _get_or_create_profile(target_user)
    profile.role = new_role

    # ── 不论新旧角色，先彻底清空所有管辖范围关联 ⚠ 使用原始 SQL 而非 through.delete()
    #    Django 6 的 *.through.objects.filter().delete() 在多 worker 下可能因 SQLite 缓存不生效
    from django.db import connection
    with connection.cursor() as c:
        c.execute("DELETE FROM materials_userprofile_managed_majors WHERE userprofile_id = %s", [profile.pk])
        c.execute("DELETE FROM materials_userprofile_moderated_sections WHERE userprofile_id = %s", [profile.pk])

    if new_role == UserProfile.Role.USER:
        profile.can_moderate_general = False
    elif new_role == UserProfile.Role.MODERATOR:
        # 版主：分配到学院/大类 + 可选通识课子类
        college_ids = body.get("managed_majors", [])
        for c in College.objects.filter(id__in=college_ids):
            profile.managed_majors.add(c)
        profile.can_moderate_general = body.get("can_moderate_general", False)
        section_ids = body.get("moderated_sections", [])
        for cat in CourseCategory.objects.filter(id__in=section_ids):
            profile.moderated_sections.add(cat)
    elif new_role == UserProfile.Role.SUB_MODERATOR:
        # 小版主：分配到具体的专业/课程
        profile.can_moderate_general = False
        cat_ids = body.get("moderated_sections", [])
        for cat in CourseCategory.objects.filter(id__in=cat_ids):
            profile.moderated_sections.add(cat)

    # 总管理员可设置 can_auto_approve（在角色设置之外单独传参）
    if "can_auto_approve" in body:
        profile.can_auto_approve = body["can_auto_approve"]

    profile.save()
    return _ok({
        "message": f"已更新 {target_user.first_name or target_user.username} 的角色为 {profile.get_role_display()}",
    })


@require_role(UserProfile.Role.SUPER_ADMIN)
def api_admin_sections(request):
    """GET /api/admin/sections/ — 返回 CourseCategory 树状列表（供版主板块分配）"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)

    def _walk(cat):
        children = CourseCategory.objects.filter(parent=cat).order_by("order")
        child_list = [_walk(c) for c in children if not c.is_divider]
        result = {
            "id": cat.id,
            "name": cat.name or f"<节点 #{cat.id}>",
            "is_divider": cat.is_divider,
            "is_parent": bool(child_list),
        }
        if child_list:
            result["children"] = child_list
        return result

    roots = CourseCategory.objects.filter(parent__isnull=True, is_divider=False).order_by("order")
    return _ok([_walk(c) for c in roots if not c.is_divider])


@csrf_exempt
@require_login
def api_admin_auto_approve_toggle(request, uid):
    """POST /api/admin/users/<id>/auto-approve/ — 切换自动托管
    自己可以切换自己的 auto_approve（需要 can_auto_approve），
    super_admin 可以切换任意用户的 auto_approve 和 can_auto_approve。"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("请求格式错误")

    target = get_object_or_404(User, id=uid)
    profile = _get_or_create_profile(target)

    # 限制仅版主/小版主可开启自动托管
    if profile.role not in (UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR):
        return _err("仅版主/小版主可开启自动托管")

    is_super = request.user.profile.role == UserProfile.Role.SUPER_ADMIN

    if "auto_approve" in body:
        # 自己改自己的 auto_approve，或者 super_admin 改别人的
        if request.user.id == uid or is_super:
            if not is_super and not profile.can_auto_approve:
                return _err("未被允许开启自动托管", 403)
            profile.auto_approve = body["auto_approve"]
        else:
            return _err("无权修改该用户的自动托管设置", 403)

    if "can_auto_approve" in body:
        if not is_super:
            return _err("仅总管理员可设置 can_auto_approve", 403)
        profile.can_auto_approve = body["can_auto_approve"]

    profile.save(update_fields=["auto_approve", "can_auto_approve"])
    return _ok({"auto_approve": profile.auto_approve, "can_auto_approve": profile.can_auto_approve})
