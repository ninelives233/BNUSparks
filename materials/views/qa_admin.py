"""
BNU Sparks · 木铎星火 — 问答区管理 API（问答区版主 / 超管：发布/编辑/审核/留痕/插图）
"""

from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from PIL import Image as PILImage

from ..models import (
    Notification,
    QaAnswer,
    QaConfig,
    QaDeleteRequest,
    QaEditHistory,
    QaQuestion,
    QaTag,
)
from .qa_helpers import (
    _can_manage_qa,
    _json_body,
    _nickname,
    _qa_bump_heat,
    _sanitize_html,
    _strip_html,
    require_qa_manager,
)
from .qa_user import (
    _soft_delete_answer,
    _soft_delete_question,
)
from .utils import (
    _create_notification,
    _err,
    _get_user,
    _ok,
    _safe_int,
)

# ═══════════════════════════════════════════════════════════════
# 管理（问答区版主 / 超管）
# ═══════════════════════════════════════════════════════════════

_QA_PIN_LIMIT = 5


def _pinned_count():
    return QaQuestion.objects.filter(status=QaQuestion.Status.PUBLISHED, is_pinned=True).count()


def _lock_qa_pin_gate():
    """串行化“统计置顶数 → 写入置顶”的临界区。

    PostgreSQL 会锁定单例配置行；SQLite 的 no-op UPDATE 会先取得数据库写锁。
    因而多个 Gunicorn worker 不能同时看到“还剩最后一个名额”后都写入。
    """
    cfg, _ = QaConfig.objects.get_or_create(pk=1)
    QaConfig.objects.filter(pk=cfg.pk).update(user_open=F("user_open"))


def _set_question_pin_state(question_id, pin):
    """原子设置问题置顶状态，返回 (是否允许, 是否改变, pinned_at)。"""
    with transaction.atomic():
        _lock_qa_pin_gate()
        current = QaQuestion.objects.only("is_pinned", "pinned_at").get(id=question_id)
        if current.is_pinned == pin:
            return True, False, current.pinned_at
        if pin and _pinned_count() >= _QA_PIN_LIMIT:
            return False, False, current.pinned_at
        pinned_at = timezone.now() if pin else None
        QaQuestion.objects.filter(id=question_id).update(
            is_pinned=pin, pinned_at=pinned_at,
        )
        return True, True, pinned_at


@csrf_exempt
@require_qa_manager
def api_qa_admin_question_create(request):
    """POST /api/admin/qa/questions/ — 发布问题"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    data = _json_body(request)
    title = (data.get("title") or "").strip()
    content = (data.get("content") or "").strip()
    is_pinned = bool(data.get("is_pinned"))

    if not title:
        return _err("标题不能为空", 400)
    if len(title) > 100:
        return _err("标题最长 100 字", 400)
    if not content:
        return _err("描述不能为空", 400)
    if len(_strip_html(content)) > 1000:
        return _err("描述最长 1000 字", 400)

    t1 = QaTag.objects.filter(id=_safe_int(data.get("tag_l1"), None), level=1).first()
    t2 = QaTag.objects.filter(id=_safe_int(data.get("tag_l2"), None), level=2).first()
    if not t1 or not t2:
        return _err("请选择分类标签", 400)

    if is_pinned:
        with transaction.atomic():
            _lock_qa_pin_gate()
            if _pinned_count() >= _QA_PIN_LIMIT:
                return _err("置顶已满，请先取消其他置顶", 400)
            q = QaQuestion.objects.create(
                title=title, content=_sanitize_html(content), author=request.user,
                tag_l1=t1, tag_l2=t2, is_pinned=True, pinned_at=timezone.now(),
            )
    else:
        q = QaQuestion.objects.create(
            title=title, content=_sanitize_html(content), author=request.user,
            tag_l1=t1, tag_l2=t2, is_pinned=False, pinned_at=None,
        )
    return _ok({"id": q.id})


@csrf_exempt
@require_qa_manager
def api_qa_admin_question_update(request, qid):
    """PUT /api/admin/qa/questions/{id}/ — 编辑问题（写留痕；status=published 可恢复）
       GET 同路由 — 返回完整问题（含已删除，供编辑预填）"""
    q = QaQuestion.objects.filter(id=qid).first()
    if not q:
        return _err("内容不存在", 404)
    if request.method == "GET":
        return _ok({"id": q.id, "title": q.title, "content": q.content,
                    "tag_l1_id": q.tag_l1_id, "tag_l2_id": q.tag_l2_id,
                    "is_pinned": q.is_pinned, "status": q.status})
    if request.method != "PUT":
        return _err("仅支持 PUT", 405)
    data = _json_body(request)

    old_title, old_content = q.title, q.content
    changed = []

    if "status" in data and data["status"] == QaQuestion.Status.PUBLISHED and q.status == QaQuestion.Status.DELETED:
        q.status = QaQuestion.Status.PUBLISHED
        q.deleted_at = None
        changed += ["status", "deleted_at"]

    if "title" in data:
        title = (data["title"] or "").strip()
        if not title:
            return _err("标题不能为空", 400)
        if len(title) > 100:
            return _err("标题最长 100 字", 400)
        q.title = title
        changed.append("title")
    if "content" in data:
        content = (data["content"] or "").strip()
        if not content:
            return _err("描述不能为空", 400)
        if len(_strip_html(content)) > 1000:
            return _err("描述最长 1000 字", 400)
        q.content = _sanitize_html(content)
        changed.append("content")
    if "tag_l1" in data:
        t1 = QaTag.objects.filter(id=_safe_int(data["tag_l1"], None), level=1).first()
        if t1:
            q.tag_l1 = t1
            changed.append("tag_l1")
    if "tag_l2" in data:
        t2 = QaTag.objects.filter(id=_safe_int(data["tag_l2"], None), level=2).first()
        if t2:
            q.tag_l2 = t2
            changed.append("tag_l2")
    if "is_pinned" in data:
        pin = bool(data["is_pinned"])
        allowed, pin_changed, pinned_at = _set_question_pin_state(q.id, pin)
        if not allowed:
            return _err("置顶已满，请先取消其他置顶", 400)
        q.is_pinned = pin
        q.pinned_at = pinned_at
        if pin_changed:
            changed += ["is_pinned", "pinned_at"]

    if not changed:
        return _ok({"id": q.id})
    q.save(update_fields=changed + ["updated_at"])
    # 每次编辑留痕（快照式）
    QaEditHistory.objects.create(
        target_type="question", target_id=q.id, editor=request.user,
        old_title=old_title, new_title=q.title,
        old_content=old_content, new_content=q.content,
    )
    return _ok({"id": q.id})


@csrf_exempt
@require_qa_manager
def api_qa_admin_question_delete(request, qid):
    """DELETE /api/admin/qa/questions/{id}/ — 软删除（48h 后硬删）"""
    if request.method != "DELETE":
        return _err("仅支持 DELETE", 405)
    q = QaQuestion.objects.filter(id=qid).first()
    if not q:
        return _err("内容不存在", 404)
    if q.status != QaQuestion.Status.DELETED:
        q.status = QaQuestion.Status.DELETED
        q.deleted_at = timezone.now()
        q.is_pinned = False
        q.pinned_at = None
        q.save(update_fields=["status", "deleted_at", "is_pinned", "pinned_at", "updated_at"])
    return _ok({"id": q.id})


def api_qa_admin_question_history(request, qid):
    """GET /api/admin/qa/questions/{id}/history/ — 编辑历史（作者可读自己，管理端可读全部）

    安全（v183）：待审核/已驳回目标的 history 仅作者/管理端可读——非作者一律 403，
    天然防经 history 侧漏待审内容。
    """
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    user = _get_user(request)
    if user is None:
        return _err("请先登录", 401)
    q = QaQuestion.objects.filter(id=qid).first()
    if not q:
        return _err("内容不存在", 404)
    if not _can_manage_qa(user) and q.author_id != user.id:
        return _err("权限不足", 403)
    rows = QaEditHistory.objects.filter(target_type="question", target_id=qid).select_related(
        "editor").order_by("-created_at")
    return _ok({"items": [{
        "id": h.id,
        "editor": _nickname(h.editor),
        "old_title": h.old_title,
        "new_title": h.new_title,
        "created_at": h.created_at.strftime("%Y-%m-%d %H:%M"),
    } for h in rows]})


@csrf_exempt
@require_qa_manager
def api_qa_admin_question_rollback(request, qid):
    """POST /api/admin/qa/questions/{id}/rollback/ — 回滚到某历史版本（回滚本身也留痕）"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    data = _json_body(request)
    history_id = _safe_int(data.get("history_id"), None)
    h = QaEditHistory.objects.filter(id=history_id, target_type="question", target_id=qid).first()
    if not h:
        return _err("历史版本不存在", 404)
    q = QaQuestion.objects.filter(id=qid).first()
    if not q:
        return _err("内容不存在", 404)
    # 回滚动作本身记一条历史（旧=当前，新=回滚目标）
    QaEditHistory.objects.create(
        target_type="question", target_id=q.id, editor=request.user,
        old_title=q.title, new_title=h.old_title,
        old_content=q.content, new_content=h.old_content,
    )
    q.title = h.old_title or q.title
    q.content = h.old_content or q.content
    q.save(update_fields=["title", "content", "updated_at"])
    return _ok({"id": q.id})


@csrf_exempt
@require_qa_manager
def api_qa_admin_answer_create(request, qid):
    """POST /api/admin/qa/questions/{id}/answers/ — 发布回答"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    q = QaQuestion.objects.filter(id=qid, status=QaQuestion.Status.PUBLISHED).first()
    if not q:
        return _err("问题不存在", 404)
    data = _json_body(request)
    content = (data.get("content") or "").strip()
    if not content:
        return _err("回答正文不能为空", 400)
    if len(_strip_html(content)) > 20000:
        return _err("回答最长 2 万字", 400)
    is_pinned = bool(data.get("is_pinned"))
    a = QaAnswer.objects.create(
        question=q, author=request.user, content=_sanitize_html(content),
        is_pinned=is_pinned, pinned_at=timezone.now() if is_pinned else None,
    )
    # v183 通知闭环：管理端直发回答 → 通知提问者（非自己）
    if q.author_id != request.user.id:
        _create_notification(
            recipient=q.author, type=Notification.Type.OPERATION,
            title="有新的回答", message=f"「{q.title}」收到一条新回答。",
        )
    return _ok({"id": a.id})


@csrf_exempt
@require_qa_manager
def api_qa_admin_answer_update(request, aid):
    """PUT /api/admin/qa/answers/{id}/ — 编辑回答（写留痕；status=published 可恢复）
       GET 同路由 — 返回完整回答（含已删除，供编辑预填）"""
    a = QaAnswer.objects.filter(id=aid).first()
    if not a:
        return _err("内容不存在", 404)
    if request.method == "GET":
        return _ok({"id": a.id, "question_id": a.question_id, "content": a.content,
                    "is_pinned": a.is_pinned, "status": a.status})
    if request.method != "PUT":
        return _err("仅支持 PUT", 405)
    data = _json_body(request)
    old_content = a.content
    changed = []
    if "status" in data and data["status"] == QaAnswer.Status.PUBLISHED and a.status == QaAnswer.Status.DELETED:
        a.status = QaAnswer.Status.PUBLISHED
        a.deleted_at = None
        changed += ["status", "deleted_at"]
    if "content" in data:
        content = (data["content"] or "").strip()
        if not content:
            return _err("回答正文不能为空", 400)
        if len(_strip_html(content)) > 20000:
            return _err("回答最长 2 万字", 400)
        a.content = _sanitize_html(content)
        changed.append("content")
    if "is_pinned" in data:
        pin = bool(data["is_pinned"])
        if pin != a.is_pinned:
            a.is_pinned = pin
            a.pinned_at = timezone.now() if pin else None
            changed += ["is_pinned", "pinned_at"]
    if not changed:
        return _ok({"id": a.id})
    a.save(update_fields=changed + ["updated_at"])
    QaEditHistory.objects.create(
        target_type="answer", target_id=a.id, editor=request.user,
        old_title="", new_title="",
        old_content=old_content, new_content=a.content,
    )
    return _ok({"id": a.id})


@csrf_exempt
@require_qa_manager
def api_qa_admin_answer_delete(request, aid):
    """DELETE /api/admin/qa/answers/{id}/ — 软删除回答"""
    if request.method != "DELETE":
        return _err("仅支持 DELETE", 405)
    a = QaAnswer.objects.filter(id=aid).first()
    if not a:
        return _err("内容不存在", 404)
    if a.status != QaAnswer.Status.DELETED:
        a.status = QaAnswer.Status.DELETED
        a.deleted_at = timezone.now()
        a.is_pinned = False
        a.pinned_at = None
        a.save(update_fields=["status", "deleted_at", "is_pinned", "pinned_at", "updated_at"])
    return _ok({"id": a.id})


@csrf_exempt
def api_qa_admin_answer_history(request, aid):
    """GET /api/admin/qa/answers/{id}/history/ — 回答编辑历史（作者可读自己，管理端可读全部）"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    user = _get_user(request)
    if user is None:
        return _err("请先登录", 401)
    a = QaAnswer.objects.filter(id=aid).first()
    if not a:
        return _err("内容不存在", 404)
    if not _can_manage_qa(user) and a.author_id != user.id:
        return _err("权限不足", 403)
    rows = QaEditHistory.objects.filter(target_type="answer", target_id=aid).select_related(
        "editor").order_by("-created_at")
    return _ok({"items": [{
        "id": h.id,
        "editor": _nickname(h.editor),
        "old_content": h.old_content,
        "new_content": h.new_content,
        "created_at": h.created_at.strftime("%Y-%m-%d %H:%M"),
    } for h in rows]})


@csrf_exempt
@require_qa_manager
def api_qa_admin_answer_rollback(request, aid):
    """POST /api/admin/qa/answers/{id}/rollback/ — 回滚回答到某历史版本"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    data = _json_body(request)
    history_id = _safe_int(data.get("history_id"), None)
    h = QaEditHistory.objects.filter(id=history_id, target_type="answer", target_id=aid).first()
    if not h:
        return _err("历史版本不存在", 404)
    a = QaAnswer.objects.filter(id=aid).first()
    if not a:
        return _err("内容不存在", 404)
    QaEditHistory.objects.create(
        target_type="answer", target_id=a.id, editor=request.user,
        old_title="", new_title="",
        old_content=a.content, new_content=h.old_content,
    )
    a.content = h.old_content or a.content
    a.save(update_fields=["content", "updated_at"])
    return _ok({"id": a.id})


@require_qa_manager
def api_qa_admin_records(request):
    """GET /api/admin/qa/records/ — 论坛记录：问题+回答的过审情况（合并列表）"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    page = _safe_int(request.GET.get("page"), 1, lo=1)
    page_size = _safe_int(request.GET.get("pageSize"), 10, lo=1, hi=50)

    # v175：按状态筛选（published/deleted/pending/rejected；非法值 → 空结果）
    status = (request.GET.get("status") or "").strip()
    questions = QaQuestion.objects.all().select_related("author", "tag_l1", "tag_l2")
    answers = QaAnswer.objects.all().select_related("author", "question")
    if status:
        questions = questions.filter(status=status)
        answers = answers.filter(status=status)

    combined = []
    for q in questions:
        combined.append({
            "kind": "question",
            "id": q.id,
            "title": q.title,
            "content_preview": _strip_html(q.content)[:60],
            "author": _nickname(q.author),
            "status": q.status,
            "is_pinned": q.is_pinned,
            "tag_l1": q.tag_l1.name if q.tag_l1_id else "",
            "tag_l2": q.tag_l2.name if q.tag_l2_id else "",
            "created_at": q.created_at.strftime("%Y-%m-%d %H:%M"),
        })
    for a in answers:
        combined.append({
            "kind": "answer",
            "id": a.id,
            "question_id": a.question_id,
            "title": f"回答 · {a.question.title}",
            "content_preview": _strip_html(a.content)[:60],
            "author": _nickname(a.author),
            "status": a.status,
            "is_pinned": a.is_pinned,
            "tag_l1": "",
            "tag_l2": "",
            "created_at": a.created_at.strftime("%Y-%m-%d %H:%M"),
        })

    combined.sort(key=lambda r: r["created_at"], reverse=True)
    total = len(combined)
    items = combined[(page - 1) * page_size: page * page_size]
    return _ok({
        "total": total,
        "page": page,
        "pageSize": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "items": items,
    })


@require_qa_manager
def api_qa_admin_pending(request):
    """GET /api/admin/qa/pending/ — 论坛管理待审：pending 状态的问题/回答合并列表"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    page = _safe_int(request.GET.get("page"), 1, lo=1)
    page_size = _safe_int(request.GET.get("pageSize"), 10, lo=1, hi=50)

    questions = QaQuestion.objects.filter(status=QaQuestion.Status.PENDING).select_related(
        "author", "tag_l1", "tag_l2")
    answers = QaAnswer.objects.filter(status=QaAnswer.Status.PENDING).select_related(
        "author", "question")

    combined = []
    for q in questions:
        combined.append({
            "kind": "question",
            "id": q.id,
            "question_id": q.id,
            "title": q.title,
            "content_preview": _strip_html(q.content)[:60],
            "author": _nickname(q.author),
            "status": q.status,
            "created_at": q.created_at.strftime("%Y-%m-%d %H:%M"),
        })
    for a in answers:
        combined.append({
            "kind": "answer",
            "id": a.id,
            "question_id": a.question_id,
            "title": f"回答 · {a.question.title}",
            "content_preview": _strip_html(a.content)[:60],
            "author": _nickname(a.author),
            "status": a.status,
            "created_at": a.created_at.strftime("%Y-%m-%d %H:%M"),
        })

    combined.sort(key=lambda r: r["created_at"], reverse=True)
    total = len(combined)
    items = combined[(page - 1) * page_size: page * page_size]

    # v183：待批准的删除申请（用户对有互动内容提交的删除请求）
    delreq_items = []
    for r in QaDeleteRequest.objects.filter(
            status=QaDeleteRequest.Status.PENDING).select_related("requester").order_by("-created_at"):
        delreq_items.append({
            "id": r.id,
            "target_type": r.target_type,
            "target_id": r.target_id,
            "target_title": _delreq_target_title(r),
            "requester": _nickname(r.requester),
            "requester_id": r.requester_id,
            "reason": r.reason,
            "created_at": r.created_at.strftime("%Y-%m-%d %H:%M"),
        })

    return _ok({
        "total": total,
        "page": page,
        "pageSize": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "items": items,
        "delete_requests": delreq_items,
    })


def _delreq_target_title(r):
    """删除申请目标标题（target 可能已 48h 硬删，容错返回占位）"""
    if r.target_type == "question":
        q = QaQuestion.objects.filter(id=r.target_id).first()
        return q.title if q else "内容已删除"
    a = QaAnswer.objects.select_related("question").filter(id=r.target_id).first()
    return f"回答 · {a.question.title}" if a else "内容已删除"


@require_qa_manager
def api_qa_admin_delete_requests(request):
    """GET /api/admin/qa/delete-requests/ — 删除申请记录（含已处理，管理后台留痕）"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    page = _safe_int(request.GET.get("page"), 1, lo=1)
    page_size = _safe_int(request.GET.get("pageSize"), 10, lo=1, hi=50)
    qs = QaDeleteRequest.objects.select_related("requester", "handled_by")
    status = (request.GET.get("status") or "").strip()
    if status:
        qs = qs.filter(status=status)
    total = qs.count()
    rows = qs.order_by("-created_at")[(page - 1) * page_size: page * page_size]
    return _ok({
        "total": total,
        "page": page,
        "pageSize": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "items": [{
            "id": r.id,
            "target_type": r.target_type,
            "target_id": r.target_id,
            "target_title": _delreq_target_title(r),
            "requester": _nickname(r.requester),
            "reason": r.reason,
            "status": r.status,
            "auto_approved": r.auto_approved,
            "handled_by": _nickname(r.handled_by) if r.handled_by_id else "",
            "handled_at": r.handled_at.strftime("%Y-%m-%d %H:%M") if r.handled_at else "",
            "created_at": r.created_at.strftime("%Y-%m-%d %H:%M"),
        } for r in rows],
    })


@csrf_exempt
@require_qa_manager
def api_qa_admin_delete_request_approve(request, req_id):
    """POST /api/admin/qa/delete-requests/{id}/approve/ — 批准删除申请：软删目标 + 通知申请人

    原子条件更新防双批（并发下仅一个请求能把 PENDING → APPROVED）。
    """
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    with transaction.atomic():
        updated = QaDeleteRequest.objects.filter(
            id=req_id, status=QaDeleteRequest.Status.PENDING).update(
            status=QaDeleteRequest.Status.APPROVED,
            handled_by=request.user, handled_at=timezone.now())
    if not updated:
        return _err("该申请已处理", 400)
    req = QaDeleteRequest.objects.get(id=req_id)
    _apply_delreq_soft_delete(req)
    _create_notification(
        recipient=req.requester, type=Notification.Type.OPERATION,
        title="你的删除申请已通过",
        message=f"你申请删除的{'问题' if req.target_type == 'question' else '回答'}已删除。",
    )
    return _ok({"id": req_id})


@csrf_exempt
@require_qa_manager
def api_qa_admin_delete_request_reject(request, req_id):
    """POST /api/admin/qa/delete-requests/{id}/reject/ — 驳回删除申请：内容保留 + 通知申请人（可选备注）"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    data = _json_body(request)
    note = (data.get("reason") or "").strip()
    with transaction.atomic():
        updated = QaDeleteRequest.objects.filter(
            id=req_id, status=QaDeleteRequest.Status.PENDING).update(
            status=QaDeleteRequest.Status.REJECTED,
            handled_by=request.user, handled_at=timezone.now())
    if not updated:
        return _err("该申请已处理", 400)
    req = QaDeleteRequest.objects.get(id=req_id)
    msg = f"你申请删除的{'问题' if req.target_type == 'question' else '回答'}未获批准，内容已保留。"
    if note:
        msg += f"管理员备注：{note}"
    _create_notification(
        recipient=req.requester, type=Notification.Type.OPERATION,
        title="你的删除申请未通过", message=msg,
    )
    return _ok({"id": req_id})


def _apply_delreq_soft_delete(req):
    """按申请软删目标（幂等：目标已删/不存在则跳过）"""
    if req.target_type == "question":
        q = QaQuestion.objects.filter(id=req.target_id).first()
        if q:
            _soft_delete_question(q)
    else:
        a = QaAnswer.objects.filter(id=req.target_id).first()
        if a:
            _soft_delete_answer(a)


def _qa_approve_question(qid, approver=None):
    """原子条件更新防双审：仅 pending 可置 published。返回 (ok, err)
    通过后通知作者（v183 通知闭环，自审自查不发给自己）"""
    updated = QaQuestion.objects.filter(id=qid, status=QaQuestion.Status.PENDING).update(
        status=QaQuestion.Status.PUBLISHED)
    if not updated:
        return (False, "该内容已审核，不可重复操作")
    q = QaQuestion.objects.filter(id=qid).first()
    if q and (approver is None or q.author_id != approver.id):
        _create_notification(
            recipient=q.author, type=Notification.Type.OPERATION,
            title="你的提问已通过审核", message=f"「{q.title}」已在问答区发布。",
        )
    return (True, "")


def _qa_reject_question(qid, reason=""):
    """原子条件更新防双审：仅 pending 可置 rejected；带原因则通知作者。返回 (ok, err)"""
    updated = QaQuestion.objects.filter(id=qid, status=QaQuestion.Status.PENDING).update(
        status=QaQuestion.Status.REJECTED)
    if not updated:
        return False, "该内容已审核，不可重复操作"
    if reason:
        q = QaQuestion.objects.filter(id=qid).first()
        if q:
            _create_notification(
                recipient=q.author, type=Notification.Type.OPERATION,
                title="你的提问被驳回", message=f"驳回原因：{reason}",
            )
    return True, ""


def _qa_approve_answer(aid, approver=None):
    """原子条件更新防双审：仅 pending 可置 published。返回 (ok, err)
    通过后通知作者 + 热度 +5（v183 通知闭环/热度）"""
    updated = QaAnswer.objects.filter(id=aid, status=QaAnswer.Status.PENDING).update(
        status=QaAnswer.Status.PUBLISHED)
    if not updated:
        return (False, "该内容已审核，不可重复操作")
    a = QaAnswer.objects.select_related("question").filter(id=aid).first()
    if a:
        _qa_bump_heat(a.question, 5)
        if approver is None or a.author_id != approver.id:
            _create_notification(
                recipient=a.author, type=Notification.Type.OPERATION,
                title="你的回答已通过审核", message=f"你的回答已在「{a.question.title}」下发布。",
            )
    return (True, "")


def _qa_reject_answer(aid, reason=""):
    updated = QaAnswer.objects.filter(id=aid, status=QaAnswer.Status.PENDING).update(
        status=QaAnswer.Status.REJECTED)
    if not updated:
        return False, "该内容已审核，不可重复操作"
    if reason:
        a = QaAnswer.objects.filter(id=aid).first()
        if a:
            _create_notification(
                recipient=a.author, type=Notification.Type.OPERATION,
                title="你的回答被驳回", message=f"驳回原因：{reason}",
            )
    return True, ""


@csrf_exempt
@require_qa_manager
def api_qa_admin_question_approve(request, qid):
    """POST /api/admin/qa/questions/{id}/approve/ — 通过待审问题"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    ok, err = _qa_approve_question(qid, approver=request.user)
    return _ok({"id": qid}) if ok else _err(err, 400)


@csrf_exempt
@require_qa_manager
def api_qa_admin_question_reject(request, qid):
    """POST /api/admin/qa/questions/{id}/reject/ — 驳回待审问题（可选 reason）"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    data = _json_body(request)
    ok, err = _qa_reject_question(qid, (data.get("reason") or "").strip())
    return _ok({"id": qid}) if ok else _err(err, 400)


@csrf_exempt
@require_qa_manager
def api_qa_admin_answer_approve(request, aid):
    """POST /api/admin/qa/answers/{id}/approve/ — 通过待审回答"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    ok, err = _qa_approve_answer(aid, approver=request.user)
    return _ok({"id": aid}) if ok else _err(err, 400)


@csrf_exempt
@require_qa_manager
def api_qa_admin_answer_reject(request, aid):
    """POST /api/admin/qa/answers/{id}/reject/ — 驳回待审回答（可选 reason）"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    data = _json_body(request)
    ok, err = _qa_reject_answer(aid, (data.get("reason") or "").strip())
    return _ok({"id": aid}) if ok else _err(err, 400)


@csrf_exempt
@require_qa_manager
def api_qa_admin_upload_image(request):
    """POST /api/admin/qa/upload-image/ — 编辑器插图上传（存 MEDIA_ROOT/qa_images/）"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    if "image" not in request.FILES:
        return _err("未接收到图片", 400)
    img_file = request.FILES["image"]
    ext = Path(img_file.name).suffix.lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        return _err("仅支持 JPG/PNG/WebP/GIF 图片", 400)
    try:
        img = PILImage.open(img_file)
        img.load()
        fmt = {'.jpg': 'JPEG', '.jpeg': 'JPEG', '.png': 'PNG', '.webp': 'WEBP', '.gif': 'GIF'}[ext]
        filename = f"qa_{uuid4().hex[:8]}{ext}"
        save_path = Path(settings.MEDIA_ROOT) / "qa_images" / filename
        save_path.parent.mkdir(parents=True, exist_ok=True)
        if img.mode not in ("RGB", "RGBA", "P"):
            img = img.convert("RGB")
        save_kwargs = {"format": fmt}
        if fmt == "JPEG":
            save_kwargs["quality"] = 85
        img.save(save_path, **save_kwargs)
    except Exception:
        return _err("图片处理失败", 500)
    return _ok({"url": f"/media/qa_images/{filename}"})
