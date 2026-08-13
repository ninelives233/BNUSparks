"""
BNU Sparks · 木铎星火 — 批量删除 / 批量编辑 API
"""

import json

from django.views.decorators.csrf import csrf_exempt

from ..models import Material, UserProfile, DeletionRecord, Notification
from .utils import (
    _err, _ok, _get_or_create_profile, _check_moderator_access,
    _create_notification, _stage_file_to_trash, _purge_expired_trash,
    require_login, require_role,
)

@csrf_exempt
@require_login
def api_file_batch_delete(request):
    """POST /api/files/batch-delete/ — 批量删除文件（软删除：物理文件移入暂存，48h 内可恢复）"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    _purge_expired_trash()  # 顺带清理超期暂存文件
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
            dr = DeletionRecord.objects.create(
                material_id=m.id, title=m.title,
                file_name=m.file_name, file_size=m.file_size,
                course_code=m.course.code if m.course else "",
                course_name=m.course.name if m.course else "",
                college_id=m.course.college_id if m.course and m.course.college else None,
                uploader_name=m.uploader_name or (m.uploader.first_name if m.uploader else "匿名"),
                deleted_by=request.user, delete_reason=reason,
            )
            # 软删除：物理文件移入暂存区（顺带修复此前批删不留文件、磁盘残留孤儿的问题）
            trash_rel = _stage_file_to_trash(m)
            if trash_rel:
                dr.trash_path = trash_rel
                dr.save(update_fields=["trash_path"])
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
            update_fields = []
            if "teacher" in body:
                m.teacher = body["teacher"].strip()
                changed = True
                update_fields.append("teacher")
            if "description" in body:
                m.description = body["description"].strip()
                changed = True
                update_fields.append("description")
            if "material_type_id" in body:
                mtid = body["material_type_id"]
                if mtid and str(mtid).isdigit():
                    m.material_type_id = int(mtid)
                    changed = True
                    update_fields.append("material_type")
                elif mtid == "" or mtid is None:
                    m.material_type = None
                    changed = True
                    update_fields.append("material_type")
            if changed:
                m.save(update_fields=update_fields)
                updated += 1
        except Material.DoesNotExist:
            continue
    return _ok({"updated": updated})
