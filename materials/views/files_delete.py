"""
BNU Sparks · 木铎星火 — 文件删除 / 详情 API

delete, detail
"""

import json

from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import Count

from .utils import (
    _err, _ok, _get_or_create_profile,
    _check_moderator_access, _user_can_edit_material,
    _purge_expired_trash, _stage_file_to_trash,
    _create_notification,
    require_login,
    UserProfile, Material, Notification, DeletionRecord,
)


def _scope_matched_moderators(material, actor, include_super_admin=False):
    """删除资料时应通知的版主/小版主（按资料所属学院匹配管辖范围，与
    管理后台「删除记录」的可见范围一致）。include_super_admin 时总管理员始终包含。
    不含 actor，去重返回 User 列表。"""
    college_id = material.course.college_id if material.course else None
    roles = [UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR]
    if include_super_admin:
        roles.append(UserProfile.Role.SUPER_ADMIN)
    qs = User.objects.filter(
        profile__role__in=roles
    ).exclude(id=actor.id).distinct()
    recipients = []
    seen = set()
    for u in qs:
        p = _get_or_create_profile(u)
        in_scope = False
        if p.role == UserProfile.Role.SUPER_ADMIN:
            in_scope = True  # 总管理员全局可见，始终通知
        elif p.role == UserProfile.Role.MODERATOR:
            if college_id and p.managed_majors.filter(id=college_id).exists():
                in_scope = True
            if p.can_moderate_general and material.course and material.course.course_type == 'general':
                in_scope = True
        else:  # SUB_MODERATOR
            if material.course and p.moderated_sections.filter(course=material.course).exists():
                in_scope = True
        if in_scope and u.id not in seen:
            seen.add(u.id)
            recipients.append(u)
    return recipients


@csrf_exempt
@require_login
def api_file_delete(request, file_id):
    """DELETE /api/files/<id>/delete/ — 删除文件（软删除：物理文件移入暂存，48h 内可恢复）"""
    if request.method != "DELETE":
        return _err("仅支持 DELETE", 405)

    _purge_expired_trash()  # 顺带清理超期暂存文件

    material = get_object_or_404(Material, id=file_id)
    profile = _get_or_create_profile(request.user)

    # 自己上传的文件始终可删
    is_self_delete = material.uploader_id == request.user.id

    if profile.role == UserProfile.Role.SUPER_ADMIN:
        pass
    elif material.uploader_id == request.user.id:
        pass  # 自己上传的始终允许
    elif profile.role in (UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR):
        try:
            _check_moderator_access(request.user, material)
        except Exception:
            return _err("无权删除该资料", 403)
    else:
        return _err("无权删除该资料", 403)

    try:
        body = json.loads(request.body) if request.body else {}
    except Exception:
        body = {}
    delete_reason = body.get("reason", "")

    # v=182：DB 关键操作原子提交（建记录→移文件→存路径→删行），任一步失败整体回滚，
    # 杜绝「DeletionRecord 已建但 Material 行未删」的幽灵残留（此前的非原子间隙在通知段，
    # 一旦通知抛异常即留下幽灵）。_stage_file_to_trash 内部吞掉文件缺失/移动失败异常。
    with transaction.atomic():
        dr = DeletionRecord.objects.create(
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
        # 软删除：物理文件移入暂存区（48h 内可恢复），记录暂存路径
        trash_rel = _stage_file_to_trash(material)
        if trash_rel:
            dr.trash_path = trash_rel
            dr.save(update_fields=["trash_path"])
        material.delete()

    # 通知为 best-effort：material 行已删，不再带 material FK（删后 FK 悬空无意义），
    # 用快照的 course_code/course_name 落库；通知失败不回滚删除、不产生幽灵。
    try:
        # 非自删时通知辖区的版主/小版主（按资料所属学院匹配管辖范围）
        if not is_self_delete and material.course:
            for u in _scope_matched_moderators(material, request.user):
                _create_notification(
                    recipient=u,
                    type=Notification.Type.FILE_DELETED,
                    title="辖区内的资料被删除",
                    message=f"管理员{request.user.first_name or request.user.username}删除了你辖区内的资料「{material.title}」（{material.course.name if material.course else '未知课程'}）。",
                    course_code=material.course.code if material.course else "",
                    course_name=material.course.name if material.course else "",
                    triggered_by=request.user,
                )

        if not is_self_delete and delete_reason and material.uploader and material.uploader_id != request.user.id:
            _create_notification(
                recipient=material.uploader,
                type=Notification.Type.FILE_DELETED,
                title="你的资料被管理员删除",
                message=f"管理员{request.user.first_name or request.user.username}删除了你的资料「{material.title}」（{material.course.name if material.course else '未知课程'}）。\n删除理由：{delete_reason}\n你可以在此课程目录下重新上传。",
                course_code=material.course.code if material.course else "",
                course_name=material.course.name if material.course else "",
                triggered_by=request.user,
            )

        if is_self_delete:
            _create_notification(
                recipient=request.user,
                type=Notification.Type.FILE_DELETED,
                title="你删除了资料",
                message=f"你已删除资料「{material.title}」（{material.course.name if material.course else '未知课程'}）。",
                course_code=material.course.code if material.course else "",
                course_name=material.course.name if material.course else "",
            )
            for admin in _scope_matched_moderators(material, request.user, include_super_admin=True):
                _create_notification(
                    recipient=admin,
                    type=Notification.Type.FILE_DELETED,
                    title="用户自行删除资料",
                    message=f"用户 {material.uploader_name or request.user.username} 删除了资料「{material.title}」（{material.course.name if material.course else '未知课程'}）。",
                    course_code=material.course.code if material.course else "",
                    course_name=material.course.name if material.course else "",
                    triggered_by=request.user,
                )
    except Exception:
        pass

    return _ok({"message": "文件已删除"})


@require_login
def api_file_detail(request, file_id):
    """GET /api/files/<id>/ — 返回单个文件的完整信息"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    material = get_object_or_404(
        Material.objects.select_related("material_type", "course", "uploader").annotate(
            favorite_count=Count("favorited_by")
        ),
        id=file_id,
    )
    user = request.user
    # v=XXX：未批准资料（pending/rejected）仅上传者本人 / 辖区管理员可见，
    # 其他登录用户一律 404，防元数据被枚举（标题/教师/描述等）。
    if material.review_status != "approved":
        can_view = user.is_authenticated and material.uploader_id == user.id
        if not can_view and user.is_authenticated:
            try:
                _check_moderator_access(user, material)
                can_view = True
            except Exception:
                can_view = False
        if not can_view:
            return _err("文件不存在", 404)
    from ..models import Favorite
    is_favorited = Favorite.objects.filter(user=user, material=material).exists() if user.is_authenticated else False
    rs = material.review_status
    uploader_profile = getattr(material.uploader, 'profile', None) if material.uploader else None
    return _ok({
        "id": material.id,
        "title": material.title,
        "file_name": material.file_name,
        "file_size": material.file_size,
        "file_type": material.material_type.name if material.material_type else (material.file_type or "其他"),
        "user_material_type": material.material_type.name if material.material_type else "",
        "uploader": (material.uploader.first_name if material.uploader else material.uploader_name) or "匿名",
        "uploader_id": material.uploader_id or 0,
        "uploader_avatar": uploader_profile.avatar.url if uploader_profile and uploader_profile.avatar else "",
        "teacher": material.teacher,
        "description": material.description or "",
        "course_name": material.course.name if material.course else "",
        "course_code": material.course.code if material.course else "",
        "download_count": material.download_count,
        "favorite_count": getattr(material, "favorite_count", 0),
        "is_favorited": is_favorited,
        "created_at": material.created_at.strftime("%Y-%m-%d") if material.created_at else "",
        "review_status": rs,
        "is_uploader": user.is_authenticated and material.uploader_id == user.id,
        "can_download": material.is_approved or (user.is_authenticated and material.uploader_id == user.id),
        "can_delete": user.is_authenticated and _user_can_edit_material(user, material),
        "is_approved": material.is_approved,
        "is_pinned": material.is_pinned,
    })
