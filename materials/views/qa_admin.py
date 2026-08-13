"""
BNU Sparks · 木铎星火 — 问答区管理 API（问答区版主 / 超管：发布/编辑/审核/留痕/插图）
"""

from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from PIL import Image as PILImage

from ..models import (
    Notification,
    QaAnswer,
    QaEditHistory,
    QaQuestion,
    QaTag,
)
from .qa_helpers import (
    _json_body,
    _nickname,
    _sanitize_html,
    _strip_html,
    require_qa_manager,
)
from .utils import (
    _create_notification,
    _err,
    _ok,
    _safe_int,
)

# ═══════════════════════════════════════════════════════════════
# 管理（问答区版主 / 超管）
# ═══════════════════════════════════════════════════════════════

_QA_PIN_LIMIT = 5


def _pinned_count():
    return QaQuestion.objects.filter(status=QaQuestion.Status.PUBLISHED, is_pinned=True).count()


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

    pinned_at = None
    if is_pinned:
        if _pinned_count() >= _QA_PIN_LIMIT:
            return _err("置顶已满，请先取消其他置顶", 400)
        pinned_at = timezone.now()

    q = QaQuestion.objects.create(
        title=title, content=_sanitize_html(content), author=request.user,
        tag_l1=t1, tag_l2=t2, is_pinned=is_pinned, pinned_at=pinned_at,
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
        if pin and not q.is_pinned:
            if _pinned_count() >= _QA_PIN_LIMIT:
                return _err("置顶已满，请先取消其他置顶", 400)
            q.is_pinned = True
            q.pinned_at = timezone.now()
            changed += ["is_pinned", "pinned_at"]
        elif not pin and q.is_pinned:
            q.is_pinned = False
            q.pinned_at = None
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


@require_qa_manager
def api_qa_admin_question_history(request, qid):
    """GET /api/admin/qa/questions/{id}/history/ — 编辑历史"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    if not QaQuestion.objects.filter(id=qid).exists():
        return _err("内容不存在", 404)
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
@require_qa_manager
def api_qa_admin_answer_history(request, aid):
    """GET /api/admin/qa/answers/{id}/history/ — 回答编辑历史"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    if not QaAnswer.objects.filter(id=aid).exists():
        return _err("内容不存在", 404)
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
    return _ok({
        "total": total,
        "page": page,
        "pageSize": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "items": items,
    })


def _qa_approve_question(qid):
    """原子条件更新防双审：仅 pending 可置 published。返回 (ok, err)"""
    updated = QaQuestion.objects.filter(id=qid, status=QaQuestion.Status.PENDING).update(
        status=QaQuestion.Status.PUBLISHED)
    return (True, "") if updated else (False, "该内容已审核，不可重复操作")


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


def _qa_approve_answer(aid):
    updated = QaAnswer.objects.filter(id=aid, status=QaAnswer.Status.PENDING).update(
        status=QaAnswer.Status.PUBLISHED)
    return (True, "") if updated else (False, "该内容已审核，不可重复操作")


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
    ok, err = _qa_approve_question(qid)
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
    ok, err = _qa_approve_answer(aid)
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
