"""
BNU Sparks · 木铎星火 — 文件管理 & 文件夹管理 API

file-update, folder-create/delete, operations, folder-restore,
batch-delete/edit, restore-deletion
"""

import json
from datetime import timedelta

from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User
from django.db.models import Q
from django.utils import timezone

from .utils import (
    _err, _ok, _get_or_create_profile, _create_notification,
    _check_moderator_access, require_login, require_role,
    UserProfile, Material, Course, CourseCategory, College,
    Notification, FolderOperation, DeletionRecord,
)


@csrf_exempt
@require_login
def api_file_update(request, file_id):
    """PATCH /api/files/<id>/update/ — 更新文件元信息"""
    if request.method != "PATCH":
        return _err("仅支持 PATCH", 405)
    material = get_object_or_404(Material, id=file_id)
    profile = _get_or_create_profile(request.user)
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
    folder_type = body.get("folder_type", "")
    if not name:
        return _err("文件夹名称不能为空")
    if parent_id:
        parent = get_object_or_404(CourseCategory, id=parent_id)
    else:
        parent = None
    cat = CourseCategory.objects.create(name=name, parent=parent, order=0)
    path_parts = []
    p = cat.parent
    while p:
        path_parts.append(p.name or f"#{p.id}")
        p = p.parent
    parent_path = "/".join(reversed(path_parts))
    FolderOperation.objects.create(
        user=request.user, action=FolderOperation.Action.CREATE,
        category_id=cat.id, category_name=cat.name,
        parent_path=parent_path, folder_type=folder_type,
    )
    return _ok({"id": cat.id, "name": cat.name, "parent_id": cat.parent_id})


@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_folder_delete(request, folder_id):
    """DELETE /api/folders/<id>/ — 删除文件夹"""
    if request.method != "DELETE":
        return _err("仅支持 DELETE", 405)
    cat = get_object_or_404(CourseCategory, id=folder_id)
    if cat.course_id or cat.course_text:
        return _err("系统文件夹不可删除", 403)
    children = CourseCategory.objects.filter(parent=cat)
    child_count = children.count()
    if child_count > 0:
        return _err(f"文件夹不为空，已包含 {child_count} 个子文件夹，请先清空后再删除", 400)

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
        user=request.user, action=FolderOperation.Action.DELETE,
        category_id=cat_id, category_name=cat_name, parent_path=parent_path,
    )
    if request.user.profile.role != UserProfile.Role.SUPER_ADMIN:
        admins = User.objects.filter(
            profile__role=UserProfile.Role.SUPER_ADMIN
        ).exclude(id=request.user.id)
        for admin in admins:
            _create_notification(
                recipient=admin, type=Notification.Type.OPERATION,
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
    if profile.role == UserProfile.Role.SUPER_ADMIN:
        pass
    else:
        visible_cat_ids = set(profile.moderated_sections.values_list("id", flat=True))
        if profile.role == UserProfile.Role.MODERATOR:
            college_ids = list(profile.managed_majors.values_list("id", flat=True))
            for cc in College.objects.filter(id__in=college_ids):
                for cat in CourseCategory.objects.filter(
                    Q(course_text__startswith=cc.slug.upper()[:3]) | Q(name=cc.short_name)
                ):
                    visible_cat_ids.add(cat.id)
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

    now = timezone.now()

    def _serialize(op):
        can_restore = False
        if not op.is_restored:
            age = now - op.created_at
            if age.total_seconds() < 48 * 3600:
                p = _get_or_create_profile(request.user)
                if p.role == UserProfile.Role.SUPER_ADMIN or op.user_id == request.user.id:
                    can_restore = True
        return {
            "id": op.id, "user_id": op.user_id,
            "user_name": op.user.first_name or op.user.username if op.user else "未知",
            "action": op.action, "action_label": op.get_action_display(),
            "category_id": op.category_id, "category_name": op.category_name,
            "parent_path": op.parent_path, "folder_type": op.folder_type,
            "reason": op.reason or "", "is_restored": op.is_restored,
            "can_restore": can_restore,
            "created_at": op.created_at.strftime("%Y-%m-%d %H:%M") if op.created_at else "",
        }

    return _ok({
        "items": [_serialize(r) for r in records],
        "total": total, "page": page, "per_page": per_page, "total_pages": total_pages,
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
    if timezone.now() - op.created_at > timedelta(hours=48):
        return _err("已超过48小时，无法撤销", 400)
    try:
        body = json.loads(request.body) if request.body else {}
    except Exception:
        body = {}
    reason = body.get("reason", "")

    if op.action == FolderOperation.Action.CREATE:
        try:
            cat = CourseCategory.objects.get(id=op.category_id)
            if cat.course_id or cat.course_text:
                return _err("无法撤销：该文件夹已被系统使用", 400)
            cat.delete()
        except CourseCategory.DoesNotExist:
            pass
    elif op.action == FolderOperation.Action.DELETE:
        CourseCategory.objects.create(name=op.category_name, parent=None, order=0)

    op.is_restored = True
    op.restored_at = timezone.now()
    op.restored_by = request.user
    op.reason = reason
    op.save(update_fields=["is_restored", "restored_at", "restored_by", "reason"])

    if reason and op.user and op.user_id != request.user.id:
        _create_notification(
            recipient=op.user, type=Notification.Type.OPERATION,
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
    if timezone.now() - dr.deleted_at > timedelta(hours=48):
        return _err("已超过48小时，无法恢复", 400)
    try:
        body = json.loads(request.body) if request.body else {}
    except Exception:
        body = {}
    reason = body.get("reason", "")

    course = Course.objects.filter(code=dr.course_code).first()
    if not course:
        return _err("原课程已不存在，无法恢复", 400)
    material = Material.objects.create(
        course=course, title=dr.title, file_name=dr.file_name,
        file_size=dr.file_size, file_path="",
        uploader_name=dr.uploader_name,
        review_status="approved", is_approved=True,
        reviewed_by=dr.deleted_by,
    )
    dr.is_restored = True
    dr.restored_at = timezone.now()
    dr.restored_by = request.user
    dr.save(update_fields=["is_restored", "restored_at", "restored_by"])

    original_uploader = User.objects.filter(username=dr.uploader_name).first()
    if original_uploader and original_uploader != request.user:
        _create_notification(
            recipient=original_uploader, type=Notification.Type.OPERATION,
            title="你的资料已被恢复",
            message=f"管理员恢复了你的资料「{dr.title}」，现在可以查看和下载了。",
            material=material, triggered_by=request.user,
        )

    if reason and dr.deleted_by and dr.deleted_by_id != request.user.id:
        _create_notification(
            recipient=dr.deleted_by, type=Notification.Type.OPERATION,
            title="你的删除操作已被撤销",
            message=f"管理员撤销了你对资料「{dr.title}」的删除操作。撤销理由：{reason}",
            material=material, course_code=dr.course_code,
            course_name=dr.course_name, triggered_by=request.user,
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
                deleted_by=request.user, delete_reason=reason,
            )
            m.delete()
            deleted += 1
        except Material.DoesNotExist:
            errors.append(f"文件#{fid}：不存在")
    if deleted > 0 and reason:
        notified_uploaders = set()
        for fid in file_ids:
            try:
                m = Material.objects.get(id=fid)
                if m.uploader and m.uploader_id not in notified_uploaders:
                    if m.uploader_id != request.user.id:
                        _create_notification(
                            recipient=m.uploader, type=Notification.Type.FILE_DELETED,
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
