"""
BNU Sparks · 木铎星火 — 公告 API

announcements list, delete
"""

import json

from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User
from django.utils import timezone

from .utils import (
    _err, _ok, _get_user, _get_or_create_profile,
    require_login, UserProfile, Announcement,
)


@csrf_exempt
def api_announcements(request):
    """GET /api/announcements/ — 公告列表
       POST /api/announcements/ — 发布公告（MODERATOR+）"""
    if request.method == "GET":
        qs = Announcement.objects.filter(is_published=True).order_by("-created_at")
        user = _get_user(request)
        is_admin = False
        if user:
            profile = _get_or_create_profile(user)
            is_admin = profile.role in (
                UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN,
            )
        items = [{
            "id": a.id,
            "title": a.title,
            "content": a.content,
            "publisher_name": a.publisher.first_name or a.publisher.username if a.publisher else "管理员",
            "publisher_id": a.publisher_id,
            "publisher_avatar": (a.publisher.userprofile.avatar.url if a.publisher.userprofile.avatar else None) if hasattr(a.publisher, 'userprofile') else None,
            "created_at": a.created_at.strftime("%Y-%m-%d %H:%M") if a.created_at else "",
        } for a in qs]
        return _ok({"items": items, "is_admin": is_admin})

    elif request.method == "POST":
        user = _get_user(request)
        profile = _get_or_create_profile(user)
        if profile.role not in (UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN):
            return _err("权限不足", 403)
        try:
            body = json.loads(request.body)
        except json.JSONDecodeError:
            return _err("请求格式错误")
        title = (body.get("title") or "").strip()
        content = (body.get("content") or "").strip()
        if not title or not content:
            return _err("标题和内容不能为空")
        Announcement.objects.create(
            title=title, content=content,
            publisher=user, is_published=True,
        )
        return _ok({"message": "公告已发布"})

    return _err("仅支持 GET/POST", 405)


@csrf_exempt
@require_login
def api_announcement_delete(request, aid):
    """DELETE /api/announcements/<id>/ — 删除公告"""
    if request.method != "DELETE":
        return _err("仅支持 DELETE", 405)
    user = request.user
    profile = _get_or_create_profile(user)
    if profile.role not in (UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN):
        return _err("权限不足", 403)
    announcement = get_object_or_404(Announcement, id=aid)
    announcement.delete()
    return _ok({"message": "公告已删除"})
