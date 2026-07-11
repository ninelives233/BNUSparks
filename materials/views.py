"""
BNU Sparks · 木铎星火 — JSON API 视图

所有视图返回 JSON，前端通过 fetch() 调用。
"""

import json
import uuid
import hmac
import hashlib
import base64
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
from django.db.models import Q, Count
from django.utils import timezone
from datetime import date, timedelta

from .models import College, Course, CourseType, Material, MaterialType, CourseCategory, UserProfile, Notification, ReviewComment


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
    """创建通知的便捷方法"""
    return Notification.objects.create(
        recipient=recipient,
        type=type,
        title=title,
        message=message,
        material=material,
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
    """POST /api/auth/register — 仅需 email + nickname，自动生成密码"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("请求格式错误")

    email = (body.get("email") or "").strip().lower()
    nickname = (body.get("nickname") or "").strip()

    if not email:
        return _err("邮箱不能为空")
    if not nickname:
        return _err("昵称不能为空")
    if not email.endswith("@mail.bnu.edu.cn"):
        return _err("请使用北师大校内邮箱（@mail.bnu.edu.cn）")

    if User.objects.filter(username=email).exists():
        return _err("该邮箱已注册")

    # 自动生成 10 位随机密码
    password = uuid.uuid4().hex[:10]

    user = User.objects.create_user(
        username=email, password=password, email=email,
        first_name=nickname,
    )
    # 自动创建 UserProfile（默认 role = user）
    _get_or_create_profile(user)

    token = _jwt_encode({
        "user_id": user.id,
        "exp": time.time() + 7 * 86400,
    })
    return _ok({
        "token": token,
        "generated_password": password,
        "user": {
            "id": user.id,
            "username": user.username,
            "nickname": nickname,
            "email": user.email,
            "role": UserProfile.Role.USER,
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
        return _err("邮箱或密码错误")

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
       POST /api/auth/notifications/ — 全部标为已读"""
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
                    "course_code": n.material.course.code if n.material and hasattr(n.material, "course") and n.material.course else None,
                    "course_name": n.material.course.name if n.material and hasattr(n.material, "course") and n.material.course else None,
                    "created_at": n.created_at.strftime("%Y-%m-%d %H:%M"),
                }
                for n in qs[:100]
            ],
        })

    elif request.method == "POST":
        Notification.objects.filter(recipient=request.user, is_read=False).update(is_read=True)
        return _ok({"message": "全部标为已读"})

    return _err("仅支持 GET/POST", 405)


@require_login
def api_notification_read(request, nid):
    """POST /api/auth/notifications/<id>/read/"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    notif = get_object_or_404(Notification, id=nid, recipient=request.user)
    notif.is_read = True
    notif.save(update_fields=["is_read"])
    return _ok({"message": "已标为已读"})


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

        return _ok({
            "id": request.user.id,
            "username": request.user.username,
            "nickname": request.user.first_name or request.user.username,
            "email": request.user.email,
            "role": profile.role,
            "role_label": profile.get_role_display(),
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

        return _ok({
            "nickname": request.user.first_name or request.user.username,
            "message": "资料已更新",
        })

    return _err("仅支持 GET/PATCH", 405)


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
            "review_notes": m.review_notes,
            "download_count": m.download_count,
            "created_at": m.created_at.strftime("%Y-%m-%d"),
        }

    return _ok([_serialize_upload(m) for m in qs])


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
    course = get_object_or_404(Course, code=course_code)
    user = _get_user(request)

    # 普通用户只能看到已通过的资料，上传者可看到自己的待审/驳回资料
    q_filter = Q(course=course, is_approved=True)
    if user is not None:
        q_filter |= Q(course=course, uploader=user)

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
            "download_count": m.download_count,
            "created_at": m.created_at.strftime("%Y-%m-%d"),
            "review_status": rs,
            "is_uploader": user is not None and m.uploader_id == user.id,
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

    if not course_code or not title or not uploaded_file:
        return _err("课程代码、标题和文件不能为空")

    try:
        course = Course.objects.get(code=course_code)
    except Course.DoesNotExist:
        return _err("课程不存在")

    # 保存文件
    ext = Path(uploaded_file.name).suffix
    safe_name = f"{uuid.uuid4().hex[:12]}_{title[:40]}{ext}"
    save_dir = Path(settings.MEDIA_ROOT) / course_code
    save_dir.mkdir(parents=True, exist_ok=True)

    with open(save_dir / safe_name, "wb") as f:
        for chunk in uploaded_file.chunks():
            f.write(chunk)

    file_size = (save_dir / safe_name).stat().st_size

    # 根据用户角色决定审核状态
    profile = _get_or_create_profile(request.user)
    is_auto_approved = profile.role in (
        UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN, UserProfile.Role.SUB_MODERATOR,
    )
    auto_approved_by = None
    if not is_auto_approved:
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
    """GET /api/files/<id>/download"""
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

    # 下载配额校验
    allowed, remaining, msg = _check_download_quota(user)
    if not allowed:
        return _err(msg, 429)

    Material.objects.filter(id=file_id).update(
        download_count=material.download_count + 1
    )

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

    # 权限校验：上传者可删自己的文件，版主可删主责板块下的，总管理员可删任意
    profile = _get_or_create_profile(request.user)
    if profile.role == UserProfile.Role.SUPER_ADMIN:
        pass  # 总管理员可删任意
    elif material.uploader_id == request.user.id:
        pass  # 上传者本人可删
    elif profile.role == UserProfile.Role.MODERATOR:
        # 版主检查是否在管辖板块内
        try:
            _check_moderator_access(request.user, material)
        except Exception:
            return _err("无权删除该资料", 403)
    else:
        return _err("无权删除该资料", 403)

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
            # 叶子节点：通配符代码
            node["courseId"] = cat.course_text
            # 试试能否匹配实际课程
            code = cat.course_text.replace("*", "").replace("-", "")
            if code:
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
        # 小版主：通过 CourseCategory 节点管辖范围内的资料 + 指派给自己的
        all_courses = []
        for cat in profile.moderated_sections.all():
            all_courses.extend(_get_courses_in_category(cat))
        q = Q(course__in=set(all_courses)) if all_courses else Q(pk__in=[])
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
        # 不允许自己给自己通过的文件提异议
        if material.reviewed_by == request.user:
            return _err("不能给自己通过的文件提出异议", 400)
        try:
            body = json.loads(request.body)
        except json.JSONDecodeError:
            return _err("请求格式错误")
        content = (body.get("content") or "").strip()
        if not content:
            return _err("内容不能为空")
        ReviewComment.objects.create(
            material=material,
            commenter=request.user,
            content=content,
        )
        # 通知原审核人
        if material.reviewed_by and material.reviewed_by != request.user:
            _create_notification(
                recipient=material.reviewed_by,
                type=Notification.Type.DISAGREE,
                title="你的审核被提出异议",
                message=f"{request.user.first_name or request.user.username} 对资料「{material.title}」提出了审核异议。",
                material=material,
                triggered_by=request.user,
            )

    comments = ReviewComment.objects.filter(material=material).select_related("commenter")
    return _ok({
        "comments": [
            {
                "id": c.id,
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

    qs = qs.order_by("-reviewed_at")

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
