"""
BNU Sparks · 木铎星火 — 管理员 API

admin-users, set-role, sections, auto-approve-toggle
"""

import json

from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User
from django.db import connection
from django.db.models import Q

from .utils import (
    _err, _ok, _get_or_create_profile,
    require_login, require_role, UserProfile, CourseCategory,
)


@require_role(UserProfile.Role.SUPER_ADMIN)
def api_admin_users(request):
    """GET /api/admin/users/ — 用户列表（仅 super_admin）"""
    qs = User.objects.filter(is_active=True).order_by("-date_joined")
    search = request.GET.get("search", "").strip()
    if search:
        qs = qs.filter(
            Q(first_name__icontains=search) |
            Q(email__icontains=search) |
            Q(username__icontains=search)
        )
    page = int(request.GET.get("page", 1))
    per_page = 20
    total = qs.count()
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, total_pages))
    offset = (page - 1) * per_page

    return _ok({
        "users": [
            {
                "id": u.id,
                "nickname": u.first_name or u.username,
                "email": u.email,
                "role": _get_or_create_profile(u).role,
                "date_joined": u.date_joined.strftime("%Y-%m-%d"),
                "material_count": u.uploads.count(),
                "auto_approve": _get_or_create_profile(u).auto_approve,
                "can_auto_approve": _get_or_create_profile(u).can_auto_approve,
                "can_moderate_general": _get_or_create_profile(u).can_moderate_general,
                "managed_majors_info": [
                    {"id": c.id, "name": c.name}
                    for c in _get_or_create_profile(u).managed_majors.all()
                ],
                "moderated_sections_info": [
                    {"id": cat.id, "name": cat.name, "parent_id": cat.parent_id}
                    for cat in _get_or_create_profile(u).moderated_sections.all()
                ],
            }
            for u in qs[offset:offset + per_page]
        ],
        "total": total,
        "page": page,
        "total_pages": total_pages,
    })


@csrf_exempt
@require_role(UserProfile.Role.SUPER_ADMIN)
def api_admin_set_role(request, uid):
    """POST /api/admin/users/<uid>/role/ — 设置用户角色"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("请求格式错误")

    new_role = body.get("role", "").strip()
    valid_roles = {UserProfile.Role.USER, UserProfile.Role.SUB_MODERATOR,
                   UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN}
    if new_role not in valid_roles:
        return _err("无效的角色")

    target_user = get_object_or_404(User, id=uid)
    profile = _get_or_create_profile(target_user)

    # 清理旧权限
    profile.moderated_sections.clear()
    profile.managed_majors.clear()
    profile.can_moderate_general = False
    profile.auto_approve = False

    profile.role = new_role
    profile.save()

    # 设置新权限（前端在弹窗中提交的管辖范围数据）
    if new_role == UserProfile.Role.MODERATOR:
        managed_majors = body.get("managed_majors", [])
        if managed_majors:
            profile.managed_majors.set(managed_majors)
        moderated_sections = body.get("moderated_sections", [])
        if moderated_sections:
            profile.moderated_sections.set(moderated_sections)
        if body.get("can_moderate_general", False):
            profile.can_moderate_general = True
        profile.save()

    elif new_role == UserProfile.Role.SUB_MODERATOR:
        moderated_sections = body.get("moderated_sections", [])
        if moderated_sections:
            profile.moderated_sections.set(moderated_sections)
        profile.save()

    return _ok({"message": f"已设置 {target_user.first_name or target_user.username} 为 {new_role}"})


@require_role(UserProfile.Role.SUPER_ADMIN)
def api_admin_sections(request):
    """GET /api/admin/sections/ — 板块列表（含管辖分配数据）"""
    sections = CourseCategory.objects.filter(parent__isnull=True).prefetch_related("children")
    all_mods = UserProfile.objects.filter(
        role__in=[UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR]
    ).select_related("user")

    def build_tree(cats, depth=0):
        result = []
        for cat in cats:
            node = {
                "id": cat.id,
                "name": cat.name or "(未命名)",
                "icon": cat.icon_class or "",
                "is_divider": cat.is_divider,
                "order": cat.order,
                "depth": depth,
            }
            if cat.is_divider:
                node["type"] = "divider"
            else:
                node["type"] = "folder"
            children = cat.children.all()
            if children:
                node["children"] = build_tree(children, depth + 1)
            result.append(node)
        return result

    return _ok({
        "tree": build_tree(sections),
        "moderators": [
            {
                "id": pu.id,
                "user_id": pu.user.id,
                "name": pu.user.first_name or pu.user.username,
                "role": pu.role,
            }
            for pu in all_mods
        ],
    })


@csrf_exempt
@require_login
def api_admin_auto_approve_toggle(request, uid):
    """POST /api/admin/users/<uid>/auto-approve/ — 切换自动托管"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)

    target = get_object_or_404(User, id=uid)
    target_profile = _get_or_create_profile(target)

    # 非管理员角色不能开启自动托管
    if target_profile.role not in (UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR):
        return _err("仅版主/小版主可开启自动托管", 400)

    target_profile.auto_approve = not target_profile.auto_approve
    target_profile.save(update_fields=["auto_approve"])
    return _ok({"auto_approve": target_profile.auto_approve})
