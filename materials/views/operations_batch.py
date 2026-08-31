"""
BNU Sparks · 木铎星火 — 批量删除 / 批量编辑 API
"""

import json

from django.views.decorators.csrf import csrf_exempt

from ..models import Material, UserProfile, Notification
from .utils import (
    _err, _ok, _get_or_create_profile, _check_moderator_access,
    _create_notification, _perform_soft_delete, _purge_expired_trash,
    TrashStageError,
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
    uploader_snapshots = {}
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
            uploader = m.uploader
            course = m.course
            snapshot = {
                "recipient": uploader,
                "course_code": course.code if course else "",
                "course_name": course.name if course else "",
            }
            _perform_soft_delete(m, request.user, delete_reason=reason)
            deleted += 1
            if reason and uploader and uploader.id != request.user.id:
                uploader_snapshots.setdefault(uploader.id, snapshot)
        except Material.DoesNotExist:
            errors.append(f"文件#{fid}：不存在")
        except TrashStageError:
            errors.append(f"文件#{fid}：文件暂存失败，未删除")
        except Exception:
            errors.append(f"文件#{fid}：删除失败，已回滚")
    if deleted > 0 and reason:
        # 快照在删除前保存；不能在 Material 行删除后重新按 fid 查询。
        for snapshot in uploader_snapshots.values():
            try:
                _create_notification(
                    recipient=snapshot["recipient"], type=Notification.Type.FILE_DELETED,
                    title="你的资料被管理员批量删除",
                    message=f"管理员批量删除了你的一部分资料。\n删除理由：{reason}\n如有疑问请联系管理员。",
                    course_code=snapshot["course_code"],
                    course_name=snapshot["course_name"],
                    triggered_by=request.user,
                )
            except Exception:
                pass
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
