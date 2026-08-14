"""
BNU Sparks · 木铎星火 — 审核 API

pending, batch-approve, approve, reject, reassign, comments, history, stats, deletions
"""

import json
from datetime import date, timedelta

from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.db.models import F, Q, Count
from django.utils import timezone
from django.contrib.auth.models import User
from django.core.cache import cache
from django.http import Http404

from .utils import (
    _err, _ok, _get_or_create_profile, _create_notification,
    _get_moderated_material_qs, _get_subordinate_covered_course_ids,
    _get_courses_in_category, _check_moderator_access, _user_covers_course,
    _get_visible_deletion_records, require_login, require_role, _safe_int,
    _get_category_preload, _purge_expired_trash,
    UserProfile, Material, CourseCategory, Notification,
    ReviewComment, DeletionRecord, Course, _bump_user_public_gen,
)
from ..models import COURSE_TREE_CACHE_KEY


@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_pending(request):
    """GET /api/moderation/pending/ — 待审核列表"""
    recently = timezone.now() - timedelta(hours=24)
    include_subordinate = request.GET.get("include_subordinate") == "1"
    _get_category_preload()  # 预热分类缓存
    qs = _get_moderated_material_qs(request.user).filter(
        Q(review_status="pending") |
        (Q(review_status="approved", reviewed_at__gte=recently) & ~Q(reviewed_by=request.user))
    )
    # v=147：新建课程申请的随附文件（creation_request 非空）不进「文件上传」待审核，
    # 只在课程创建卡片内按申请审核，避免被单独批准成无文件夹的野鬼文件。
    qs = qs.exclude(creation_request_id__isnull=False)

    hide_peer_approved = request.GET.get("hide_peer_approved") == "1"
    if hide_peer_approved:
        qs = qs.filter(review_status="pending")

    qs = qs.order_by("-created_at")

    # 清理失效指派：仅清理指派给「非版主/小版主」的失效指派（普通用户/停用账号等
    # 无法审核的角色），版主与小版主指派一律保留（自动路由 + 总管理员手动指派均生效，
    # 修复此前误清版主指派导致 assigned_moderator 字段失效的问题）。
    stale_qs = qs.filter(
        review_status="pending",
        assigned_moderator__isnull=False,
    ).exclude(
        assigned_moderator__profile__role__in=[
            UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR,
        ]
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

    def _avatar_of(u):
        try:
            return u.profile.avatar.url if u and u.profile and u.profile.avatar else ""
        except Exception:
            return ""

    def _serialize(m):
        is_peer_approved = m.review_status == "approved" and m.reviewed_by_id != request.user.id
        is_sub = (m.review_status == "pending" and m.course_id in subordinate_course_ids)
        _course = m.course  # select_related 已加载；悬空外键时 Django 置 None
        _creq = m.creation_request if m.creation_request_id else None
        # 新建课程申请随附文件 course 可为 NULL/悬空，回退到申请信息
        _cname = _course.name if _course else (
            _creq.course_name if _creq else "新建课程申请"
        )
        _ccode = _course.code if _course else (
            _creq.course_code if _creq else ""
        )
        _mtype = m.material_type
        return {
            "id": m.id,
            "title": m.title or "",
            "course_name": _cname,
            "course_code": _ccode,
            "uploader_name": m.uploader_name or (m.uploader.first_name if m.uploader else "匿名"),
            "uploader_id": m.uploader_id,
            "uploader_avatar": _avatar_of(m.uploader),
            "file_size": m.file_size,
            "file_type": _mtype.name if _mtype else (m.file_type or "其他"),
            "created_at": m.created_at.strftime("%Y-%m-%d %H:%M") if m.created_at else "",
            "is_own": m.uploader_id == request.user.id,
            "is_peer_approved": is_peer_approved,
            "is_subordinate_handled": is_sub,
            "approved_by_name": (m.reviewed_by.first_name or m.reviewed_by.username) if is_peer_approved and m.reviewed_by else None,
            "approved_at": m.reviewed_at.strftime("%Y-%m-%d %H:%M") if is_peer_approved and m.reviewed_at else None,
            "review_notes": m.review_notes if m.review_status == "rejected" else "",
            "review_status": m.review_status,
        }

    try:
        return _ok([_serialize(m) for m in qs])
    except Exception:
        # 安全网：任一条目序列化异常不返回 500 HTML（前端会报 Unexpected token '<'），
        # 而是记录日志并返回可读 JSON 错误。
        import logging
        logging.getLogger(__name__).exception("moderation/pending 序列化失败")
        return _err("待审核列表加载失败，请刷新后重试", 500)


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_batch_approve(request):
    """POST /api/moderation/batch-approve/ — 一键通过全部待审核"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    _get_category_preload()  # 预热分类缓存
    qs = _get_moderated_material_qs(request.user).filter(
        review_status="pending"
    ).exclude(uploader=request.user)
    count = qs.count()
    if count == 0:
        return _ok({"approved_count": 0})
    # v=175.2：更新前先按上传者聚合计数——qs.update() 之后 qs 仍带
    # review_status="pending" 过滤，若 update 后再 count 会全部归零（通知永远
    # 显示「0 份」，且 material=None 匹配不上补发守卫）。先取数再更新。
    uploader_counts = dict(
        qs.filter(uploader_id__isnull=False)
          .values_list("uploader_id")
          .annotate(c=Count("id"))
    )
    uploader_ids = list(uploader_counts.keys())
    now = timezone.now()
    qs.update(
        is_approved=True, review_status="approved",
        reviewed_by=request.user, reviewed_at=now,
    )
    # qs.update() 不触发 post_save 信号，手动失效树缓存 + 首页统计 + 递增上传者公开页代际
    cache.delete(COURSE_TREE_CACHE_KEY)
    cache.delete("api_stats_data")
    # 按上传者聚合通知（与单条 approve 一致，避免「一键过审后上传者零感知」）
    for uid in uploader_ids:
        _bump_user_public_gen(uid)
        try:
            up = User.objects.get(id=uid)
        except User.DoesNotExist:
            continue
        n = uploader_counts.get(uid, 0)
        _create_notification(
            recipient=up, type=Notification.Type.APPROVED,
            title="你的资料已通过审核",
            message=f"你上传的 {n} 份资料已通过审核，现在可以下载了。",
            triggered_by=request.user,
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
    try:
        _check_moderator_access(request.user, material)
    except Http404:
        # 返回 JSON 404：既保住「越权即视为不存在」的语义（含 null-course 随附文件对
        # 非指派版主的隐藏），又避免 Django 渲染 HTML 404 破坏前端 api() 的 JSON 解析。
        return _err("无权操作该资料", 404)

    # v=147：新建课程申请的随附文件在申请批准前 course 为 NULL，
    # 禁止单独批准（否则变成「已通过却无处可下载」的野鬼文件），
    # 必须先批准课程创建申请、文件夹创建后随附文件才可过审。
    if material.creation_request_id and material.course_id is None:
        return _err("请先批准该课程创建申请，随附文件将随文件夹一并创建", 400)

    # 上传者本人不可审核自己的上传（与 batch-approve 的 exclude(uploader) 一致）
    if material.uploader_id == request.user.id:
        return _err("不能审核自己上传的资料", 400)

    notes = (body.get("notes") or "").strip()
    # 原子条件更新：并发双审只有一个成功（SQLite 不支持 select_for_update，
    # 用 filter(status=pending).update() 保证「读-判-写」不丢失）；同时清空指派字段。
    updated = Material.objects.filter(id=file_id, review_status="pending").update(
        is_approved=True, review_status="approved",
        review_notes=notes,
        reviewed_by=request.user, reviewed_at=timezone.now(),
        assigned_moderator=None,
    )
    if updated == 0:
        return _err("该资料已审核，不可重复操作")
    # update() 不触发 post_save 信号，手动失效缓存 + 递增上传者公开页代际
    cache.delete(COURSE_TREE_CACHE_KEY)
    cache.delete("api_stats_data")
    _bump_user_public_gen(material.uploader_id)

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
    try:
        _check_moderator_access(request.user, material)
    except Http404:
        # 同 approve：JSON 404 隐藏越权资料的「存在」，且避免 HTML 404 破坏 JSON 解析
        return _err("无权操作该资料", 404)

    # 上传者本人不可驳回自己的上传（与 approve 一致）
    if material.uploader_id == request.user.id:
        return _err("不能审核自己上传的资料", 400)

    # 原子条件更新：并发双审只有一个成功（同 approve 的并发处理模式）；同时清空指派字段。
    updated = Material.objects.filter(id=file_id, review_status="pending").update(
        is_approved=False, review_status="rejected",
        review_notes=notes,
        reviewed_by=request.user, reviewed_at=timezone.now(),
        assigned_moderator=None,
    )
    if updated == 0:
        return _err("该资料已审核，不可重复操作")
    # update() 不触发 post_save 信号，手动失效缓存 + 递增上传者公开页代际
    cache.delete(COURSE_TREE_CACHE_KEY)
    cache.delete("api_stats_data")
    _bump_user_public_gen(material.uploader_id)

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
@require_role(UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_reassign(request, file_id):
    """POST /api/moderation/<id>/reassign/ — 手动指派审核人

    - super_admin：可指派给任意版主/小版主
    - moderator：只能向下指派给小版主（目标必须覆盖该课程，限辖区）
    """
    if request.method != "POST":
        return _err("仅支持 POST", 405)

    material = get_object_or_404(Material, id=file_id, review_status="pending")
    profile = _get_or_create_profile(request.user)
    if profile.role == UserProfile.Role.MODERATOR:
        try:
            _check_moderator_access(request.user, material)
        except Exception:
            return _err("无权操作该资料", 403)

    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("请求格式错误")

    new_mod_id = body.get("assigned_moderator")
    if new_mod_id is not None:
        target = get_object_or_404(User, id=new_mod_id)
        target_profile = _get_or_create_profile(target)
        # 指派对象必须是能审核的管理员角色，否则「能看不能审」且 pending 会定期被清理
        if target_profile.role not in (
            UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR,
        ):
            return _err("指派对象必须是版主或小版主", 400)
        # 版主只能向下指派给小版主，且目标必须覆盖该课程（防止乱派给无关管理员）
        if profile.role == UserProfile.Role.MODERATOR:
            if target_profile.role != UserProfile.Role.SUB_MODERATOR:
                return _err("版主只能向下指派给小版主", 400)
            if material.course_id is None:
                return _err("该资料无课程归属，版主不可下派", 400)
            if not _user_covers_course(target, material.course):
                return _err("该小版主不覆盖这门课程，无法指派", 400)
        if material.assigned_moderator_id != target.id:
            material.assigned_moderator = target
            material.save(update_fields=["assigned_moderator"])
            # 通知新指派人（旧指派人不再持有，无残留状态需清理）
            _create_notification(
                recipient=target,
                type=Notification.Type.OPERATION,
                title="有资料指派给你审核",
                message=f"资料「{material.title}」已指派给你审核，请前往待审核列表处理。",
                material=material,
                triggered_by=request.user,
            )
    else:
        material.assigned_moderator = None
        material.save(update_fields=["assigned_moderator"])

    return _ok({"message": "已重新指派"})


@csrf_exempt
@require_role(UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_assignable(request, file_id):
    """GET /api/moderation/<id>/assignable/ — 待审资料可指派的审核员列表

    - super_admin → 全部版主 + 小版主（沿用原下拉范围）
    - moderator → 仅覆盖该课程的小版主（限辖区向下指派）
    """
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    material = get_object_or_404(Material, id=file_id, review_status="pending")
    profile = _get_or_create_profile(request.user)
    if profile.role == UserProfile.Role.MODERATOR:
        try:
            _check_moderator_access(request.user, material)
        except Exception:
            return _err("无权查看该资料的指派对象", 403)
        if material.course_id is None:
            return _ok({"users": []})
        targets = UserProfile.objects.filter(
            role=UserProfile.Role.SUB_MODERATOR,
        ).select_related("user").prefetch_related("moderated_sections")
        return _ok({
            "users": [
                {"id": tp.user.id, "nickname": tp.user.first_name or tp.user.username, "role": tp.role}
                for tp in targets
                if _user_covers_course(tp.user, material.course)
            ]
        })
    # super_admin：全部版主 + 小版主
    targets = UserProfile.objects.filter(
        role__in=[UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR],
    ).select_related("user")
    return _ok({
        "users": [
            {"id": tp.user.id, "nickname": tp.user.first_name or tp.user.username, "role": tp.role}
            for tp in targets
        ]
    })


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
    _get_category_preload()  # 预热分类缓存
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

    page = _safe_int(request.GET.get("page"), 1, lo=1)
    per_page = min(_safe_int(request.GET.get("per_page"), 20, lo=1), 100)
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
                "course_name": m.course.name if m.course_id else (
                    m.creation_request.course_name if m.creation_request_id else "新建课程申请"
                ),
                "course_code": m.course.code if m.course_id else (
                    m.creation_request.course_code if m.creation_request_id else ""
                ),
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
    """GET /api/moderation/stats/ — 审核统计概览（单次聚合）"""
    _get_category_preload()  # 预热分类缓存
    qs = _get_moderated_material_qs(request.user)
    today = date.today()

    from django.db.models import Count, Q
    stats = qs.aggregate(
        pending_count=Count('pk', filter=Q(review_status='pending')),
        approved_today=Count('pk', filter=Q(review_status='approved', reviewed_at__date=today)),
        rejected_today=Count('pk', filter=Q(review_status='rejected', reviewed_at__date=today)),
        total_approved=Count('pk', filter=Q(review_status='approved')),
        total_materials=Count('pk'),
    )
    return _ok(stats)


@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_deletion_records(request):
    """GET /api/moderation/deletions/ — 删除记录列表"""
    _purge_expired_trash()  # 顺带清理超期暂存文件
    page = _safe_int(request.GET.get("page"), 1, lo=1)
    per_page = min(_safe_int(request.GET.get("per_page"), 20, lo=1), 100)
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


@csrf_exempt
@require_login
def api_auto_approve_toggle_self(request):
    """POST /api/moderation/auto-approve/ — 版主/小版主自行开关自动托管（需超管授权）

    超管通过 /api/admin/users/<uid>/auto-approve/ 授予 can_auto_approve 后，
    被授权者可在待审页自行开启/关闭 auto_approve；未授权返回 403。
    """
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    profile = _get_or_create_profile(request.user)
    if profile.role not in (UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR):
        return _err("仅版主/小版主可操作自动托管", 400)
    if not profile.can_auto_approve:
        return _err("未被授权开启自动托管，请联系总管理员", 403)
    profile.auto_approve = not profile.auto_approve
    profile.save(update_fields=["auto_approve"])
    return _ok({"auto_approve": profile.auto_approve})
