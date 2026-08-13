"""
BNU Sparks · 木铎星火 — 文件夹操作记录 / 撤销恢复 API
"""

import json
import shutil
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.contrib.auth.models import User
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from ..models import (
    Material, Course, CourseCategory, DeletionRecord, FolderOperation,
    Notification, UserProfile,
)
from .utils import (
    _err, _ok, _get_or_create_profile, _create_notification,
    _safe_int, _safe_dir_name, _get_visible_deletion_records,
    _purge_expired_trash, require_role,
)
from .operations_helpers import _managed_college_subtree_ids

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
            visible_cat_ids |= _managed_college_subtree_ids(college_ids)
        if visible_cat_ids:
            qs = qs.filter(category_id__in=visible_cat_ids)
        else:
            qs = qs.none()

    page = _safe_int(request.GET.get("page"), 1, lo=1)
    per_page = min(_safe_int(request.GET.get("per_page"), 20, lo=1), 100)
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


def _folder_has_materials(cat):
    """该文件夹（含通配代码匹配的课程）下是否已有资料——决定能否撤销创建"""
    if cat.course_id and Material.objects.filter(course_id=cat.course_id).exists():
        return True
    if cat.course_text:
        prefix = cat.course_text.replace("*", "")
        if prefix and Material.objects.filter(course__code__startswith=prefix).exists():
            return True
    return False


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_folder_restore(request, operation_id):
    """POST /api/operations/<id>/restore/ — 撤销文件夹操作"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    op = get_object_or_404(FolderOperation, id=operation_id)
    if op.is_restored:
        return _err("该操作已撤销", 400)
    # 作用域校验：与列表端 can_restore 规则一致——仅超管或操作者本人可撤销
    profile = _get_or_create_profile(request.user)
    if profile.role != UserProfile.Role.SUPER_ADMIN and op.user_id != request.user.id:
        return _err("无权撤销该操作", 403)
    if timezone.now() - op.created_at > timedelta(hours=48):
        return _err("已超过48小时，无法撤销", 400)
    try:
        body = json.loads(request.body) if request.body else {}
    except Exception:
        body = {}
    reason = body.get("reason", "")

    if op.action == FolderOperation.Action.CREATE:
        cat = CourseCategory.objects.filter(id=op.category_id).first()
        if cat is not None:
            # v=147：以「是否有资料」替代「是否绑课程」作撤销判据——
            # 课程申请批准建的文件夹必绑 Course，旧逻辑导致空文件夹也永远撤不掉。
            if _folder_has_materials(cat):
                return _err("该文件夹内已有资料，请先删除资料再撤销", 400)
            course = cat.course
            cat.delete()
            # 连带删除未被其他节点引用且无资料的孤儿 Course，彻底清掉搜索残留
            if course and not CourseCategory.objects.filter(course=course).exists() \
               and not Material.objects.filter(course=course).exists():
                course.delete()
        # cat 已不存在（此前被手动删除）：搜索残留由 api_search 的
        # coursecategory_set__isnull=False 过滤兜底，这里仅标记已撤销。
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
    """POST /api/moderation/deletions/<id>/restore/ — 恢复已删除文件（从暂存区取回物理文件）"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    _purge_expired_trash()  # 顺带清理超期暂存文件
    dr = get_object_or_404(DeletionRecord, id=deletion_id)
    if dr.is_restored:
        return _err("该文件已恢复", 400)
    if timezone.now() - dr.deleted_at > timedelta(hours=48):
        return _err("已超过48小时，无法恢复", 400)
    # 作用域校验：与列表端 _get_visible_deletion_records 一致，防止越权恢复管辖外记录
    profile = _get_or_create_profile(request.user)
    if profile.role != UserProfile.Role.SUPER_ADMIN:
        visible_ids = set(_get_visible_deletion_records(request.user).values_list("id", flat=True))
        if dr.id not in visible_ids:
            return _err("无权恢复该记录", 403)
    try:
        body = json.loads(request.body) if request.body else {}
    except Exception:
        body = {}
    reason = body.get("reason", "")

    course = Course.objects.filter(code=dr.course_code).first()
    if not course:
        return _err("原课程已不存在，无法恢复", 400)

    # v=167 从暂存区取回物理文件：移回课程目录并填真实 file_path，杜绝旧版 file_path=""
    # 的幽灵记录（下载直接 500/404）。暂存文件不存在（历史记录或已超期硬删）→ 拒绝恢复。
    rel_path = ""
    if dr.trash_path:
        staged = Path(settings.MEDIA_ROOT) / dr.trash_path
        if staged.is_file():
            new_dir = Path(settings.MEDIA_ROOT) / _safe_dir_name(course.code)
            new_dir.mkdir(parents=True, exist_ok=True)
            dest = new_dir / staged.name
            try:
                shutil.move(str(staged), str(dest))
                rel_path = f"{course.code}/{staged.name}"
            except OSError:
                return _err("文件恢复失败（暂存文件不可用）", 400)
    if not rel_path:
        return _err("原文件已被物理清除，无法恢复", 400)

    material = Material.objects.create(
        course=course, title=dr.title, file_name=dr.file_name,
        file_size=dr.file_size, file_path=rel_path,
        uploader_name=dr.uploader_name,
        review_status="approved", is_approved=True,
        reviewed_by=dr.deleted_by,
    )

    try:
        from git_storage import commit_file
        commit_file(rel_path)
    except Exception:
        pass

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
