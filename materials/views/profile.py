"""
BNU Sparks · 木铎星火 — 个人资料 API

profile, avatar, my-uploads, my-downloads, user-rankings, user-public
"""

import json
import os
from uuid import uuid4
from pathlib import Path
from datetime import date, timedelta

from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User
from django.conf import settings
from django.db.models import Count, Sum

from .utils import (
    _err, _ok, _get_user, _get_or_create_profile, _strip_exif,
    require_login, Notification, UserProfile, Material, DownloadRecord,
    DeletionRecord, ReviewComment, Course, CourseCategory, F,
)


# ═══════════════════════════════════════════════════════════════
# 个人资料
# ═══════════════════════════════════════════════════════════════

@csrf_exempt
@require_login
def api_profile(request):
    """GET/PATCH /api/auth/profile/"""
    if request.method == "GET":
        profile = _get_or_create_profile(request.user)
        remaining = 60
        today = date.today()
        if profile.role == UserProfile.Role.USER:
            if profile.last_download_date == today:
                remaining = max(0, 60 - profile.daily_download_count)
        daily_download_used = profile.daily_download_count if profile.last_download_date == today else 0
        sections_display = []
        if profile.role in (UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR):
            from .utils import _get_managed_sections_display
            sections_display = _get_managed_sections_display(profile)
        return _ok({
            "id": request.user.id,
            "username": request.user.username,
            "nickname": request.user.first_name or request.user.username,
            "email": request.user.email,
            "role": profile.role,
            "daily_download_remaining": remaining,
            "daily_download_used": daily_download_used,
            "moderated_sections": list(profile.moderated_sections.values_list("id", flat=True)),
            "managed_majors": list(profile.managed_majors.values_list("id", flat=True)),
            "avatar_url": profile.avatar.url if profile.avatar else "",
            "daily_download_count": profile.daily_download_count,
            "last_download_date": str(profile.last_download_date) if profile.last_download_date else "",
            "auto_approve": profile.auto_approve,
            "can_auto_approve": profile.can_auto_approve,
            "can_moderate_general": profile.can_moderate_general,
            "contact_email": profile.contact_email or "",
            "contact_way": profile.contact_way or "",
            "bio": profile.bio or "",
            "sections_display": sections_display,
            "upload_count": Material.objects.filter(uploader=request.user).count(),
            "download_count": DownloadRecord.objects.filter(user=request.user).count(),
        })

    elif request.method == "PATCH":
        try:
            body = json.loads(request.body)
        except json.JSONDecodeError:
            return _err("请求格式错误")

        profile = _get_or_create_profile(request.user)
        changed = []
        allowed_fields = {"contact_email", "contact_way", "bio"}

        if "nickname" in body and isinstance(body["nickname"], str):
            val = body["nickname"].strip()
            if val and val != request.user.first_name:
                request.user.first_name = val
                request.user.save(update_fields=["first_name"])
                changed.append("nickname")

        for field in allowed_fields:
            if field in body and isinstance(body[field], str):
                val = body[field].strip()
                if val != getattr(profile, field, ""):
                    setattr(profile, field, val)
                    changed.append(field)

        if changed:
            profile.save(update_fields=list(allowed_fields & set(changed)))
        return _ok({"message": "已更新" if changed else "无变化", "changed": changed})

    return _err("仅支持 GET/PATCH", 405)


# ═══════════════════════════════════════════════════════════════
# 头像上传
# ═══════════════════════════════════════════════════════════════

from PIL import Image as PILImage


@csrf_exempt
@require_login
def api_avatar_upload(request):
    """POST /api/auth/avatar/ — 上传头像"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)

    if "avatar" not in request.FILES:
        return _err("未选择头像文件")

    avatar_file = request.FILES["avatar"]
    ext = Path(avatar_file.name).suffix.lower()
    if ext not in ('.jpg', '.jpeg', '.png', '.webp'):
        return _err("仅支持 JPG/PNG/WebP 格式")

    # 缩放至 200×200
    try:
        img = PILImage.open(avatar_file)
        img.thumbnail((200, 200), PILImage.LANCZOS)
        fmt = {'jpg': 'JPEG', 'jpeg': 'JPEG', 'png': 'PNG', 'webp': 'WEBP'}.get(ext.lstrip('.'), 'JPEG')
        filename = f"avatar_{request.user.id}_{uuid4().hex[:8]}{ext}"
        save_path = Path(settings.MEDIA_ROOT) / "avatars" / filename
        save_path.parent.mkdir(parents=True, exist_ok=True)
        save_kwargs = {"format": fmt}
        if fmt == "JPEG":
            save_kwargs["quality"] = 85
        img.save(save_path, **save_kwargs)
    except Exception:
        return _err("头像处理失败", 500)

    profile = _get_or_create_profile(request.user)
    if profile.avatar:
        try:
            old_path = Path(profile.avatar.path)
            if old_path.exists():
                old_path.unlink()
        except Exception:
            pass
    profile.avatar.name = f"avatars/{filename}"
    profile.save(update_fields=["avatar"])
    return _ok({
        "avatar_url": profile.avatar.url,
        "message": "头像已更新",
    })


# ═══════════════════════════════════════════════════════════════
# 我的上传
# ═══════════════════════════════════════════════════════════════

@require_login
def api_my_uploads(request):
    """GET /api/user/uploads/ — 我的上传（全部记录，前端按 tab 过滤）"""
    user = request.user
    qs = Material.objects.filter(uploader=user).select_related("course", "material_type").order_by("-created_at")

    return _ok([{
        "id": m.id,
        "title": m.title,
        "course_code": m.course.code if m.course_id else "",
        "course_name": m.course.name if m.course_id else "",
        "course_type": m.course.course_type if m.course_id else "",
        "file_type": m.file_type,
        "file_name": m.file_name,
        "file_size": m.file_size,
        "teacher": m.teacher or "",
        "review_status": m.review_status,
        "review_notes": (m.review_notes or "") if m.review_status == "rejected" else "",
        "download_count": m.download_count,
        "created_at": m.created_at.isoformat() if m.created_at else "",
    } for m in qs])


# ═══════════════════════════════════════════════════════════════
# 我的下载
# ═══════════════════════════════════════════════════════════════

@require_login
def api_my_downloads(request):
    """GET /api/user/downloads/ — 我的下载记录"""
    qs = DownloadRecord.objects.filter(user=request.user).order_by("-created_at")

    return _ok([{
        "id": r.id,
        "material_id": r.material_id,
        "material_title": r.material_title,
        "file_name": r.file_name,
        "course_code": r.course_code,
        "course_name": r.course_name,
        "created_at": r.created_at.strftime("%Y-%m-%d %H:%M") if r.created_at else "",
    } for r in qs])


# ═══════════════════════════════════════════════════════════════
# 用户排行榜
# ═══════════════════════════════════════════════════════════════

def api_user_rankings(request):
    """GET /api/user/rankings/?type=upload|download"""
    rank_type = request.GET.get("type", "upload")

    if rank_type == "upload":
        qs = User.objects.filter(is_active=True, uploads__isnull=False) \
            .annotate(count=Count("uploads")) \
            .filter(count__gt=0) \
            .order_by("-count")[:50]
    else:
        # download: 按用户上传资料的总下载次数降序
        qs = User.objects.filter(is_active=True, uploads__download_count__gt=0) \
            .annotate(count=Sum("uploads__download_count")) \
            .filter(count__gt=0) \
            .order_by("-count")[:50]

    top = []
    rank = 0
    pos = 0
    prev = None
    for u in qs:
        profile = _get_or_create_profile(u)
        nickname = u.first_name or u.username
        pos += 1
        if u.count != prev:
            rank = pos
        prev = u.count
        top.append({
            "rank": rank,
            "user_id": u.id,
            "nickname": nickname,
            "count": u.count,
            "avatar_url": profile.avatar.url if profile.avatar else "",
        })

    return _ok({
        "items": top,
        "total_pages": 1,
        "page": 1,
        "total": len(top),
    })


# ═══════════════════════════════════════════════════════════════
# 用户公开页
# ═══════════════════════════════════════════════════════════════

def api_user_public(request, uid):
    """GET /api/user/public/{uid}/ — 用户公开页（含上传的文件列表）"""
    user = get_object_or_404(User, id=uid, is_active=True)
    profile = _get_or_create_profile(user)
    upload_count = Material.objects.filter(uploader=user, review_status="approved").count()
    download_count = DownloadRecord.objects.filter(user=user).count()
    contact_email = profile.contact_email if profile.contact_email and profile.role != UserProfile.Role.USER else ""

    # 分页查询该用户上传的文件
    page = int(request.GET.get("page", 1))
    per_page = 20
    materials_qs = Material.objects.filter(
        uploader=user, review_status="approved"
    ).select_related("course").order_by("-created_at")
    total = materials_qs.count()
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, total_pages))
    offset = (page - 1) * per_page

    materials_list = []
    for m in materials_qs[offset:offset + per_page]:
        materials_list.append({
            "id": m.id,
            "title": m.title,
            "course_code": m.course.code if m.course_id else "",
            "course_name": m.course.name if m.course_id else "",
            "file_type": m.file_type,
            "download_count": m.download_count,
            "created_at": m.created_at.strftime("%Y-%m-%d") if m.created_at else "",
        })

    return _ok({
        "user": {
            "nickname": user.first_name or user.username,
            "avatar_url": profile.avatar.url if profile.avatar else "",
            "bio": profile.bio or "",
            "contact_email": contact_email,
            "contact_way": profile.contact_way or "",
            "upload_count": upload_count,
            "download_count": download_count,
            "collection_count": 0,
            "member_since": user.date_joined.strftime("%Y-%m"),
        },
        "materials": materials_list,
        "total_pages": total_pages,
        "page": page,
        "total": total,
    })
