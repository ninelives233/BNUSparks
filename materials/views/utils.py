"""
BNU Sparks · 木铎星火 — 共享辅助函数

供 views/ 下各功能模块引用，避免跨模块循环依赖。
"""

import json
import uuid
import hmac
import hashlib
import base64
import io
import os
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
from django.db.models import Q, Count, Sum, F
from django.utils import timezone
from datetime import date, timedelta

from PIL import Image as PILImage

from ..models import (
    College, Course, CourseType, Material, MaterialType,
    CourseCategory, UserProfile, Notification, ReviewComment,
    DownloadRecord, DeletionRecord, FolderOperation, Announcement,
)


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
    if not auth.startswith("Bearer ") or len(auth) < 20:
        return None
    payload = _jwt_decode(auth[7:])
    if payload is None:
        return None
    try:
        return User.objects.get(id=payload["user_id"])
    except User.DoesNotExist:
        return None


# ═══════════════════════════════════════════════════════════════
# 短时下载令牌（替代 JWT 用于 download URL，避免 token 泄露到日志）
# ═══════════════════════════════════════════════════════════════

def _generate_download_token(file_id, user_id, ttl=60):
    """生成短时下载令牌（非 JWT，URL 安全，默认 60s 过期）"""
    payload = f"{file_id}:{user_id}:{int(time.time()) + ttl}"
    sig = hmac.new(settings.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()[:16]
    return base64.urlsafe_b64encode(f"{payload}:{sig}".encode()).rstrip(b"=").decode()


def _verify_download_token(token, expected_file_id):
    """验证短时下载令牌，返回 user_id 或 None"""
    try:
        raw = base64.urlsafe_b64decode(token + "==").decode()
        parts = raw.rsplit(":", 1)
        if len(parts) != 2:
            return None
        data, sig = parts
        file_id, user_id, exp = data.split(":")
        expected = hmac.new(settings.SECRET_KEY.encode(), data.encode(), hashlib.sha256).hexdigest()[:16]
        if not hmac.compare_digest(expected, sig):
            return None
        if int(exp) < time.time():
            return None
        if int(file_id) != expected_file_id:
            return None
        return int(user_id)
    except Exception:
        return None


# ═══════════════════════════════════════════════════════════════
# 装饰器 & 基础响应
# ═══════════════════════════════════════════════════════════════

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


# ═══════════════════════════════════════════════════════════════
# 通知
# ═══════════════════════════════════════════════════════════════

def _create_notification(recipient, type, title, message="", material=None, triggered_by=None,
                         course_code=None, course_name=None):
    """创建通知的便捷方法，自动从 material 冗余存储 course_code/course_name"""
    if course_code is None:
        course_code = ""
        if material and material.course_id:
            try:
                course_code = material.course.code
            except Exception:
                pass
    if course_name is None:
        course_name = ""
        if material and material.course_id:
            try:
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


# ═══════════════════════════════════════════════════════════════
# 下载配额
# ═══════════════════════════════════════════════════════════════

def _check_download_quota(user):
    """检查并扣除下载配额，返回 (allowed, remaining, message)"""
    profile = _get_or_create_profile(user)
    if profile.role in (UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN):
        return True, -1, ""

    today = date.today()
    if profile.last_download_date != today:
        UserProfile.objects.filter(user=user).update(
            daily_download_count=0,
            last_download_date=today,
        )
        profile.refresh_from_db()

    if profile.daily_download_count >= 60:
        return False, 0, "今日下载次数已达上限（60 次）"

    UserProfile.objects.filter(user=user).update(
        daily_download_count=F('daily_download_count') + 1,
        last_download_date=today,
    )
    profile.refresh_from_db()
    remaining = 60 - profile.daily_download_count
    return True, remaining, ""


# ═══════════════════════════════════════════════════════════════
# EXIF 清理
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
        img.load()
        fmt = {'jpg': 'JPEG', 'jpeg': 'JPEG', 'png': 'PNG', 'webp': 'WEBP'}[ext.lstrip('.')]
        save_kwargs = {'format': fmt}
        if fmt == 'JPEG':
            save_kwargs['quality'] = 85
        buf = io.BytesIO()
        img.save(buf, **save_kwargs)
        with open(file_path, 'wb') as f:
            f.write(buf.getvalue())
    except Exception:
        pass


# ═══════════════════════════════════════════════════════════════
# 自动托管
# ═══════════════════════════════════════════════════════════════

def _check_auto_approve(course):
    """检查是否有开启了自动托管的版主/小版主管辖该课程。
    返回自动审核人 User 或 None。"""
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


# ═══════════════════════════════════════════════════════════════
# 课程树
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
            node["courseId"] = cat.course.code
            node["fileCount"] = Material.objects.filter(
                course__code=cat.course.code, is_approved=True
            ).count()
        elif cat.course_text:
            code = cat.course_text.replace("*", "").replace("-", "")
            if code:
                if "*" not in cat.course_text:
                    real = Course.objects.filter(code__startswith=code)
                    if real.count() == 1:
                        node["courseId"] = real[0].code
                    else:
                        node["courseId"] = cat.course_text
                else:
                    node["courseId"] = cat.course_text
                node["fileCount"] = Material.objects.filter(
                    course__code__startswith=code, is_approved=True
                ).count()

        result.append(node)

    if result and not any("children" in r for r in result):
        result.sort(key=lambda r: (0 if r.get("fileCount", 0) else 1, r.get("name", "")))

    return result


# ═══════════════════════════════════════════════════════════════
# 审核路由 & 权限
# ═══════════════════════════════════════════════════════════════

def _find_moderators_for_course(course):
    """查找管辖该课程的版主（通过 managed_majors / can_moderate_general / moderated_sections）"""
    mods = UserProfile.objects.filter(
        role=UserProfile.Role.MODERATOR,
    ).prefetch_related("managed_majors", "moderated_sections")
    result = []
    for mp in mods:
        if course.college_id and mp.managed_majors.filter(id=course.college_id).exists():
            result.append(mp)
            continue
        if course.college_id is None and mp.can_moderate_general:
            result.append(mp)
            continue
        for cat in mp.moderated_sections.all():
            if course in _get_courses_in_category(cat):
                result.append(mp)
                break
    return result


def _calculate_review_assignment(material):
    """
    审核路由逻辑：
    专业课 → 有小版主？→ 推给小版主
           → 无小版主？→ 推给版主
           → 无版主？→ 不指派
    通识课 → 推给板块对应的版主
           → 无对应？→ 不指派
    返回 User 或 None
    """
    course = material.course
    if course.course_type == CourseType.MAJOR and course.college_id:
        sub_mods = UserProfile.objects.filter(
            role=UserProfile.Role.SUB_MODERATOR,
        ).prefetch_related("moderated_sections")
        for sm in sub_mods:
            for cat in sm.moderated_sections.all():
                if course in _get_courses_in_category(cat):
                    return sm.user

        mods = _find_moderators_for_course(course)
        if mods:
            return mods[0].user
    else:
        mods = _find_moderators_for_course(course)
        if mods:
            return mods[0].user

    return None


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
    """获取用户权限范围内的 Material QuerySet"""
    profile = _get_or_create_profile(user)
    if profile.role == UserProfile.Role.SUPER_ADMIN:
        qs = Material.objects.select_related("course", "uploader")
        return qs if include_assigned else qs

    if profile.role == UserProfile.Role.SUB_MODERATOR:
        all_courses = []
        for cat in profile.moderated_sections.all():
            all_courses.extend(_get_courses_in_category(cat))
        q = Q(course__in=set(all_courses)) if all_courses else Q(pk__in=[])
        q |= Q(uploader=user)
        if include_assigned:
            q |= Q(assigned_moderator=user)
        return Material.objects.filter(q).select_related("course", "uploader")

    all_courses = set()
    for college in profile.managed_majors.all():
        all_courses.update(Course.objects.filter(college=college))
    if profile.can_moderate_general:
        all_courses.update(Course.objects.filter(college_id__isnull=True))
    for cat in profile.moderated_sections.all():
        all_courses.update(_get_courses_in_category(cat))
    q = Q(course__in=all_courses) if all_courses else Q(pk__in=[])
    q |= Q(uploader=user)
    if include_assigned:
        q |= Q(assigned_moderator=user)
    return Material.objects.filter(q).select_related("course", "uploader")


def _check_moderator_access(user, material):
    """校验 moderator / sub_moderator 是否有权操作该资料（含自己上传的）"""
    profile = _get_or_create_profile(user)
    if profile.role == UserProfile.Role.SUPER_ADMIN:
        return
    # 自己上传的始终可访问
    if material.uploader_id == user.id:
        return
    if profile.role == UserProfile.Role.SUB_MODERATOR:
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
    colleges = set(profile.managed_majors.values_list("id", flat=True))
    if material.course.college_id is None:
        if profile.can_moderate_general:
            return
        for cat in profile.moderated_sections.all():
            if material.course in _get_courses_in_category(cat):
                return
        if material.assigned_moderator_id != user.id:
            from django.http import Http404
            raise Http404("无权操作该资料")
        return
    if material.course.college_id in colleges:
        return
    for cat in profile.moderated_sections.all():
        if material.course in _get_courses_in_category(cat):
            return
    if material.assigned_moderator_id == user.id:
        return
    from django.http import Http404
    raise Http404("无权操作该资料")


# ═══════════════════════════════════════════════════════════════
# 管辖范围显示
# ═══════════════════════════════════════════════════════════════

def _unique_college_names(colleges):
    """College 列表按全称去重"""
    seen = set()
    result = []
    for c in colleges:
        if c.name not in seen:
            seen.add(c.name)
            result.append({"id": c.id, "name": c.short_name or c.name})
    return result


def _get_managed_sections_display(profile):
    """返回用户管辖范围的可读描述（用于个人中心显示）"""
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
        top = [s for s in sections if s.parent_id not in all_ids]
        parts = []
        for s in top:
            n = s.name or f"节点 #{s.id}"
            if n not in parts:
                parts.append(n)
        return parts or "未分配"
    return []


# ═══════════════════════════════════════════════════════════════
# 删除记录权限
# ═══════════════════════════════════════════════════════════════

def _get_visible_deletion_records(user):
    """获取管理员可见的删除记录（按管辖范围过滤）"""
    from .models import Course  # noqa: F811 — local import to avoid cycles
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
