"""
BNU Sparks · 木铎星火 — 审核 API

pending, batch-approve, approve, reject, reassign, comments, history, stats, deletions
"""

import json
from datetime import date, timedelta

from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.db.models import F, Q
from django.utils import timezone
from django.contrib.auth.models import User

from .utils import (
    _err, _ok, _get_or_create_profile, _create_notification,
    _get_moderated_material_qs, _get_subordinate_covered_course_ids,
    _get_courses_in_category, _check_moderator_access,
    _get_visible_deletion_records, require_role,
    UserProfile, Material, CourseCategory, Notification,
    ReviewComment, DeletionRecord, Course,
)


@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_pending(request):
    """GET /api/moderation/pending/ — 待审核列表"""
    recently = timezone.now() - timedelta(hours=24)
    include_subordinate = request.GET.get("include_subordinate") == "1"
    qs = _get_moderated_material_qs(request.user).filter(
        Q(review_status="pending") |
        (Q(review_status="approved", reviewed_at__gte=recently) & ~Q(reviewed_by=request.user))
    )

    hide_peer_approved = request.GET.get("hide_peer_approved") == "1"
    if hide_peer_approved:
        qs = qs.filter(review_status="pending")

    qs = qs.order_by("-created_at")

    # 清理失效指派
    stale_qs = qs.filter(
        review_status="pending",
        assigned_moderator__isnull=False,
    ).exclude(
        assigned_moderator__profile__role=UserProfile.Role.SUB_MODERATOR
    )
    stale_ids = list(stale_qs.values_list("id", flat=True)[:200])
    if stale_ids:
        Material.objects.filter(id__in=stale_ids).update(assigned_moderator=None)

    subordinate_course_ids = _get_subordinate_covered_course_ids(request.user)

    if not include_subordinate and subordinate_course_ids:
        qs = qs.filter(
            Q(review_status="approved") |
            ~(Q(review_status="pending") & Q(course_id__in=subordinate_course_ids))
        )

    def _serialize(m):
        is_peer_approved = m.review_status == "approved" and m.reviewed_by_id != request.user.id
        is_sub = (m.review_status == "pending" and m.course_id in subordinate_course_ids)
        return {
            "id": m.id,
            "title": m.title,
            "course_name": m.course.name,
            "course_code": m.course.code,
            "uploader_name": m.uploader_name or (m.uploader.first_name if m.uploader else "匿名"),
            "file_size": m.file_size,
            "file_type": m.material_type.name if hasattr(m, "material_type") and m.material_type else (m.file_type or "其他"),
            "created_at": m.created_at.strftime("%Y-%m-%d %H:%M"),
            "is_own": m.uploader_id == request.user.id,
            "is_peer_approved": is_peer_approved,
            "is_subordinate_handled": is_sub,
            "approved_by_name": (m.reviewed_by.first_name or m.reviewed_by.username) if is_peer_approved and m.reviewed_by else None,
            "approved_at": m.reviewed_at.strftime("%Y-%m-%d %H:%M") if is_peer_approved and m.reviewed_at else None,
            "review_notes": m.review_notes if m.review_status == "rejected" else "",
            "review_status": m.review_status,
        }
    return _ok([_serialize(m) for m in qs])


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_batch_approve(request):
    """POST /api/moderation/batch-approve/ — 一键通过全部待审核"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    qs = _get_moderated_material_qs(request.user).filter(
        review_status="pending"
    ).exclude(uploader=request.user)
    count = qs.count()
    now = timezone.now()
    qs.update(
        is_approved=True, review_status="approved",
        reviewed_by=request.user, reviewed_at=now,
    )
    return _ok({"approved_count": count})


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_approve(request, file_id):
    """POST /api/moderation/<id>/approve/ — 批准"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)

    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        body = {}

    material = get_object_or_404(Material, id=file_id)
    _check_moderator_access(request.user, material)

    if material.review_status != "pending":
        return _err("该资料已审核，不可重复操作")

    notes = (body.get("notes") or "").strip()
    material.review_status = "approved"
    material.is_approved = True
    material.review_notes = notes
    material.reviewed_by = request.user
    material.reviewed_at = timezone.now()
    material.save()

    if material.uploader:
        _create_notification(
            recipient=material.uploader,
            type=Notification.Type.APPROVED,
            title="你的资料已通过审核",
            message=f"你的资料「{material.title}」已通过审核，现在可以下载了。",
            material=material,
            triggered_by=request.user,
        )

    return _ok({"message": "已通过"})


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_reject(request, file_id):
    """POST /api/moderation/<id>/reject/ — 驳回"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)

    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("请求格式错误")

    notes = (body.get("notes") or "").strip()
    if not notes:
        return _err("驳回原因不能为空")

    material = get_object_or_404(Material, id=file_id)
    _check_moderator_access(request.user, material)

    if material.review_status != "pending":
        return _err("该资料已审核，不可重复操作")

    material.review_status = "rejected"
    material.is_approved = False
    material.review_notes = notes
    material.reviewed_by = request.user
    material.reviewed_at = timezone.now()
    material.save()

    if material.uploader:
        _create_notification(
            recipient=material.uploader,
            type=Notification.Type.REJECTED,
            title="你的资料未通过审核",
            message=f"你的资料「{material.title}」未通过审核。\n原因：{notes}",
            material=material,
            triggered_by=request.user,
        )

    return _ok({"message": "已驳回"})


@csrf_exempt
@require_role(UserProfile.Role.SUPER_ADMIN)
def api_moderation_reassign(request, file_id):
    """POST /api/moderation/<id>/reassign/ — 手动指派审核人"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)

    material = get_object_or_404(Material, id=file_id, review_status="pending")

    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("请求格式错误")

    new_mod_id = body.get("assigned_moderator")
    if new_mod_id is not None:
        material.assigned_moderator = get_object_or_404(User, id=new_mod_id)
    else:
        material.assigned_moderator = None
    material.save(update_fields=["assigned_moderator"])

    return _ok({"message": "已重新指派"})


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_review_comments(request, file_id):
    """GET/POST /api/moderation/<id>/comments/ — 审核异议/评论"""
    material = get_object_or_404(Material, id=file_id)
    try:
        _check_moderator_access(request.user, material)
    except Exception:
        return _err("无权查看该资料的评论", 403)

    if request.method == "POST":
        if material.review_status != "approved":
            return _err("仅可对已通过审核的资料提出异议", 400)

        try:
            body = json.loads(request.body)
        except json.JSONDecodeError:
            return _err("请求格式错误")

        parent_id = body.get("parent_id")
        if not parent_id:
            if material.reviewed_by == request.user:
                return _err("不能给自己通过的文件提出异议", 400)

        content = (body.get("content") or "").strip()
        if not content:
            return _err("内容不能为空")

        parent_comment = None
        if parent_id is not None:
            parent_comment = get_object_or_404(ReviewComment, id=parent_id, material=material)

        comment = ReviewComment.objects.create(
            material=material, commenter=request.user,
            content=content, parent=parent_comment,
        )

        if parent_comment:
            notify_user = parent_comment.commenter
            if notify_user != request.user:
                _create_notification(
                    recipient=notify_user,
                    type=Notification.Type.DISAGREE,
                    title="你的异议被回复",
                    message=f"{request.user.first_name or request.user.username} 回复了你的异议：\n{content}",
                    material=material, triggered_by=request.user,
                )
        elif material.reviewed_by and material.reviewed_by != request.user:
            _create_notification(
                recipient=material.reviewed_by,
                type=Notification.Type.DISAGREE,
                title="你的审核被提出异议",
                message=f"{request.user.first_name or request.user.username} 对资料「{material.title}」提出了审核异议：\n{content}",
                material=material, triggered_by=request.user,
            )

    comments = ReviewComment.objects.filter(material=material).select_related("commenter")
    return _ok({
        "comments": [
            {
                "id": c.id, "parent_id": c.parent_id,
                "commenter_name": c.commenter.first_name or c.commenter.username,
                "content": c.content,
                "created_at": c.created_at.strftime("%Y-%m-%d %H:%M"),
            } for c in comments
        ],
        "count": comments.count(),
    })


@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_history(request):
    """GET /api/moderation/history/ — 审核历史"""
    qs = _get_moderated_material_qs(request.user).filter(
        review_status__in=["approved", "rejected"]
    )

    status = request.GET.get("status")
    if status in ("approved", "rejected"):
        qs = qs.filter(review_status=status)

    course_code = request.GET.get("course_code")
    if course_code:
        qs = qs.filter(course__code__icontains=course_code)

    qs = qs.order_by(F("reviewed_at").desc(nulls_first=True))

    page = int(request.GET.get("page", 1))
    per_page = int(request.GET.get("per_page", 20))
    page = max(1, page)
    per_page = min(100, max(1, per_page))
    total = qs.count()
    items = qs[(page - 1) * per_page : page * per_page]

    recently = timezone.now() - timedelta(hours=24)
    return _ok({
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page,
        "items": [
            {
                "id": m.id,
                "title": m.title,
                "course_name": m.course.name,
                "course_code": m.course.code,
                "uploader_name": m.uploader_name or (m.uploader.first_name if m.uploader else "匿名"),
                "review_status": m.review_status,
                "review_notes": m.review_notes,
                "reviewed_by_name": (m.reviewed_by.first_name or m.reviewed_by.username) if m.reviewed_by else "未知",
                "reviewed_at": m.reviewed_at.strftime("%Y-%m-%d %H:%M") if m.reviewed_at else "",
                "created_at": m.created_at.strftime("%Y-%m-%d %H:%M"),
                "can_object": m.review_status == "approved" and m.reviewed_at and m.reviewed_at >= recently and m.reviewed_by_id != request.user.id,
                "is_admin_uploaded": m.reviewed_by is None and m.review_status == "approved",
            } for m in items
        ],
    })


@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_stats(request):
    """GET /api/moderation/stats/ — 审核统计概览"""
    qs = _get_moderated_material_qs(request.user)
    today = date.today()

    return _ok({
        "pending_count": qs.filter(review_status="pending").count(),
        "approved_today": qs.filter(review_status="approved", reviewed_at__date=today).count(),
        "rejected_today": qs.filter(review_status="rejected", reviewed_at__date=today).count(),
        "total_approved": qs.filter(review_status="approved").count(),
        "total_materials": qs.count(),
    })


@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_deletion_records(request):
    """GET /api/moderation/deletions/ — 删除记录列表"""
    page = int(request.GET.get("page", 1))
    per_page = int(request.GET.get("per_page", 20))
    page = max(1, page)
    per_page = min(100, max(1, per_page))

    qs = _get_visible_deletion_records(request.user).order_by("-deleted_at")
    total = qs.count()
    items = qs[(page - 1) * per_page : page * per_page]

    return _ok({
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page,
        "items": [
            {
                "id": r.id,
                "material_id": r.material_id,
                "title": r.title,
                "file_name": r.file_name,
                "file_size": r.file_size,
                "course_code": r.course_code,
                "course_name": r.course_name,
                "uploader_name": r.uploader_name,
                "delete_reason": r.delete_reason or "",
                "deleted_by_name": (r.deleted_by.first_name or r.deleted_by.username) if r.deleted_by else "未知",
                "deleted_at": r.deleted_at.strftime("%Y-%m-%d %H:%M") if r.deleted_at else "",
                "is_restored": r.is_restored,
                "can_restore": not r.is_restored and (timezone.now() - r.deleted_at <= timedelta(hours=48)),
            } for r in items
        ],
    })
