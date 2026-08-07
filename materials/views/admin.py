"""
BNU Sparks · 木铎星火 — 管理员 API

admin-users, set-role, sections, auto-approve-toggle
"""

import json

from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User
from django.db import connection
from django.db.models import Q, Count

from .utils import (
    _err, _ok, _get_or_create_profile, _safe_int,
    require_login, require_role, UserProfile, CourseCategory,
)


@require_role(UserProfile.Role.SUPER_ADMIN)
def api_admin_users(request):
    """GET /api/admin/users/ — 用户列表（仅 super_admin）"""
    qs = User.objects.filter(is_active=True).select_related(
        'profile'
    ).prefetch_related(
        'profile__managed_majors', 'profile__moderated_sections'
    ).annotate(
        material_count=Count('uploads')
    ).order_by("-date_joined")
    search = request.GET.get("search", "").strip()
    if search:
        qs = qs.filter(
            Q(first_name__icontains=search) |
            Q(email__icontains=search) |
            Q(username__icontains=search)
        )
    # 角色分类：admin = 管理员（版主/小版主/总管理员），user = 普通用户
    role_filter = request.GET.get("role", "").strip()
    if role_filter == "admin":
        qs = qs.filter(profile__role__in=[
            UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN,
        ])
    elif role_filter == "user":
        qs = qs.filter(profile__role=UserProfile.Role.USER)
    page = _safe_int(request.GET.get("page"), 1, lo=1)
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
                "avatar_url": u.profile.avatar.url if u.profile.avatar else "",
                "role": u.profile.role,
                "date_joined": u.date_joined.strftime("%Y-%m-%d"),
                "material_count": u.material_count,
                "auto_approve": u.profile.auto_approve,
                "can_auto_approve": u.profile.can_auto_approve,
                "can_moderate_general": u.profile.can_moderate_general,
                "managed_majors_info": [
                    {"id": c.id, "name": c.name}
                    for c in u.profile.managed_majors.all()
                ],
                "moderated_sections_info": [
                    {"id": cat.id, "name": cat.name, "parent_id": cat.parent_id}
                    for cat in u.profile.moderated_sections.all()
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
    """GET /api/admin/sections/ — 板块列表（含管辖分配数据，内存组装版）"""
    # 一次性加载所有节点，在内存中按 parent_id 组装
    all_nodes = CourseCategory.objects.all().order_by('order')
    child_map = {}
    for n in all_nodes:
        pid = n.parent_id if n.parent_id else None
        child_map.setdefault(pid, []).append(n)

    def build_tree(parent_id=None, depth=0):
        result = []
        for cat in child_map.get(parent_id, []):
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
            children = child_map.get(cat.id)
            if children:
                node["children"] = build_tree(cat.id, depth + 1)
            result.append(node)
        return result

    all_mods = UserProfile.objects.filter(
        role__in=[UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR]
    ).select_related("user")

    return _ok({
        "tree": build_tree(None),
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
@require_role(UserProfile.Role.SUPER_ADMIN)
def api_admin_auto_approve_toggle(request, uid):
    """POST /api/admin/users/<uid>/auto-approve/ — 切换自动托管（仅总管理员）"""
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
