"""
BNU Sparks · 木铎星火 — 问答区用户参与端（Phase 2 v183）

普通用户提问/回答/编辑/删除（进待审核，管理员批准后可见）、删除申请审批流、
最佳回答采纳、站点开关。所有方法 dispatch 由既有 view（qa_public.api_qa_questions /
api_qa_question_detail）按 request.method 调用，或新增 path 独立映射。

权限要点：
- 提问/回答需站点开关开启（关 → 403），管理端走 admin 端点不受开关限制。
- 编辑/删除仅作者本人（编辑留痕 QaEditHistory；删除必填理由，有互动 → 管理员批准）。
- 采纳 = 提问者本人（开放时）+ 问答区版主/超管。
"""

from django.db import transaction
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from ..models import (
    Notification,
    QaAnswer,
    QaConfig,
    QaDeleteRequest,
    QaEditHistory,
    QaQuestion,
    QaTag,
    UserProfile,
)
from .qa_helpers import (
    _can_manage_qa,
    _json_body,
    _qa_delete_needs_approval,
    _qa_moderator_audience,
    _qa_user_open,
    _sanitize_html,
    _strip_html,
)
from .utils import (
    _create_notification,
    _err,
    _get_user,
    _ok,
    _safe_int,
    require_role,
)

# ═══════════════════════════════════════════════════════════════
# 站点开关
# ═══════════════════════════════════════════════════════════════

def api_qa_config(request):
    """GET /api/qa/config/ — 公开：普通用户提问/回答开放状态"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    return _ok({"user_open": _qa_user_open()})


@csrf_exempt
@require_role(UserProfile.Role.SUPER_ADMIN)
def api_qa_admin_config_toggle(request):
    """POST /api/admin/qa/config/ — 总管理员切换开放状态（记操作人）"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    cfg, _ = QaConfig.objects.get_or_create(pk=1)
    cfg.user_open = not cfg.user_open
    cfg.updated_by = request.user
    cfg.save(update_fields=["user_open", "updated_by", "updated_at"])
    return _ok({"user_open": cfg.user_open})


# ═══════════════════════════════════════════════════════════════
# 用户提问（method dispatch：POST /api/qa/questions/）
# ═══════════════════════════════════════════════════════════════

def _require_user(request):
    """登录守卫（dispatch 场景 request.user 未由装饰器注入）"""
    user = _get_user(request)
    if user is None:
        return None, _err("请先登录", 401)
    return user, None


def _qa_broadcast_new_pending(title, requester):
    """新待审内容 → 广播问答区版主（NEW_PENDING，排除自己）"""
    for u in _qa_moderator_audience():
        if u.id == requester.id:
            continue
        _create_notification(
            recipient=u, type=Notification.Type.NEW_PENDING,
            title="有新的问答内容待审核",
            message=f"「{title}」待审核，请前往『论坛管理』处理。",
            triggered_by=requester,
        )


def api_qa_question_create_user(request):
    """POST /api/qa/questions/ — 普通用户提问（进待审核，管理员批准后可见）"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    if not _qa_user_open():
        return _err("提问功能暂未开放，敬请期待", 403)
    user, err = _require_user(request)
    if err:
        return err

    data = _json_body(request)
    title = (data.get("title") or "").strip()
    content = (data.get("content") or "").strip()
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

    q = QaQuestion.objects.create(
        title=title, content=_sanitize_html(content), author=user,
        tag_l1=t1, tag_l2=t2,
        status=QaQuestion.Status.PENDING,  # 普通用户一律进待审核
        is_pinned=False,  # 置顶仅管理端
    )
    _qa_broadcast_new_pending(f"提问 · {q.title}", user)
    return _ok({"id": q.id, "status": q.status})


# ═══════════════════════════════════════════════════════════════
# 用户编辑/删除问题（method dispatch：GET/PUT/DELETE /api/qa/questions/{qid}/）
# ═══════════════════════════════════════════════════════════════

def _soft_delete_question(q):
    """软删除问题（镜像 admin 删除：清置顶，48h 后 qa_purge 硬删）"""
    q.status = QaQuestion.Status.DELETED
    q.deleted_at = timezone.now()
    q.is_pinned = False
    q.pinned_at = None
    q.save(update_fields=["status", "deleted_at", "is_pinned", "pinned_at", "updated_at"])


def _soft_delete_answer(a):
    """软删除回答"""
    a.status = QaAnswer.Status.DELETED
    a.deleted_at = timezone.now()
    a.is_pinned = False
    a.pinned_at = None
    a.save(update_fields=["status", "deleted_at", "is_pinned", "pinned_at", "updated_at"])


def _record_delete_request(target_type, target_id, requester, reason, auto_approved, approved_immediately):
    """删除申请落库（自动批准/待批准两种），返回 (row, created)。
    approved_immediately=True 表示已立即软删（auto 分支或手动补删）。
    待批准分支先查重：同一用户对同一目标已有 PENDING 申请 → 返回 (None, False)（并发下
    部分唯一约束 uniq_qa_delreq_pending 兜底 IntegrityError）。"""
    if not auto_approved:
        dup = QaDeleteRequest.objects.filter(
            requester=requester, target_type=target_type, target_id=target_id,
            status=QaDeleteRequest.Status.PENDING).exists()
        if dup:
            return None, False
    row = QaDeleteRequest.objects.create(
        target_type=target_type, target_id=target_id,
        requester=requester, reason=reason,
        status=QaDeleteRequest.Status.APPROVED if auto_approved else QaDeleteRequest.Status.PENDING,
        auto_approved=auto_approved,
        handled_by=requester if auto_approved else None,
        handled_at=timezone.now() if auto_approved else None,
    )
    return row, True


def api_qa_question_edit_user(request, qid):
    """GET/PUT/DELETE /api/qa/questions/{qid}/ — 作者本人的问题编辑/删除"""
    user, err = _require_user(request)
    if err:
        return err
    q = QaQuestion.objects.select_related("author", "tag_l1", "tag_l2").filter(id=qid).first()
    if not q:
        return _err("内容不存在", 404)
    if q.author_id != user.id:
        return _err("只能操作自己发布的内容", 403)

    if request.method == "GET":
        return _ok({
            "id": q.id, "title": q.title, "content": q.content,
            "tag_l1_id": q.tag_l1_id, "tag_l2_id": q.tag_l2_id,
            "status": q.status,
        })

    if request.method == "DELETE":
        data = _json_body(request)
        reason = (data.get("reason") or "").strip()
        if not reason:
            return _err("请填写删除理由", 400)
        if len(reason) > 500:
            return _err("删除理由最长 500 字", 400)
        needs = _qa_delete_needs_approval(q)
        if needs:
            # 已有回答 → 需管理员批准，先建申请并广播，内容保持可见
            _, created = _record_delete_request(
                "question", q.id, user, reason, auto_approved=False, approved_immediately=False)
            if not created:
                return _err("删除申请已提交，等待审核", 400)
            _qa_broadcast_new_pending(f"删除申请 · {q.title}", user)
            return _ok({"id": q.id, "status": "pending", "submitted": True})
        # 简单删除（无回答）→ 自动批准立即软删
        _record_delete_request("question", q.id, user, reason, auto_approved=True, approved_immediately=True)
        _soft_delete_question(q)
        return _ok({"id": q.id, "status": "deleted", "submitted": False})

    if request.method != "PUT":
        return _err("仅支持 GET/PUT/DELETE", 405)

    data = _json_body(request)
    old_title, old_content = q.title, q.content
    new_title, new_content = q.title, q.content
    changed = []

    if "title" in data:
        title = (data["title"] or "").strip()
        if not title:
            return _err("标题不能为空", 400)
        if len(title) > 100:
            return _err("标题最长 100 字", 400)
        new_title = title
        changed.append("title")
    if "content" in data:
        content = (data["content"] or "").strip()
        if not content:
            return _err("描述不能为空", 400)
        if len(_strip_html(content)) > 1000:
            return _err("描述最长 1000 字", 400)
        new_content = _sanitize_html(content)
        changed.append("content")
    t1, t2 = q.tag_l1, q.tag_l2
    if "tag_l1" in data:
        t1 = QaTag.objects.filter(id=_safe_int(data["tag_l1"], None), level=1).first()
        if t1:
            changed.append("tag_l1")
        else:
            t1 = q.tag_l1
    if "tag_l2" in data:
        t2 = QaTag.objects.filter(id=_safe_int(data["tag_l2"], None), level=2).first()
        if t2:
            changed.append("tag_l2")
        else:
            t2 = q.tag_l2

    # REJECTED 编辑 → 回 PENDING 重新提交（避免被驳回内容死锁）
    back_to_pending = False
    if q.status == QaQuestion.Status.REJECTED:
        q.status = QaQuestion.Status.PENDING
        changed.append("status")
        back_to_pending = True

    if not changed:
        return _ok({"id": q.id, "status": q.status})

    q.title, q.content, q.tag_l1, q.tag_l2 = new_title, new_content, t1, t2
    q.save(update_fields=changed + ["updated_at"])
    QaEditHistory.objects.create(
        target_type="question", target_id=q.id, editor=user,
        old_title=old_title, new_title=q.title,
        old_content=old_content, new_content=q.content,
    )
    if back_to_pending:
        _qa_broadcast_new_pending(f"重新提交 · {q.title}", user)
    return _ok({"id": q.id, "status": q.status})


# ═══════════════════════════════════════════════════════════════
# 用户回答（新增 path：POST /api/qa/questions/{qid}/answers/）
# ═══════════════════════════════════════════════════════════════

@csrf_exempt
def api_qa_answer_create_user(request, qid):
    """POST /api/qa/questions/{qid}/answers/ — 普通用户回答（进待审核）"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    if not _qa_user_open():
        return _err("回答功能暂未开放，敬请期待", 403)
    user, err = _require_user(request)
    if err:
        return err
    q = QaQuestion.objects.filter(id=qid, status=QaQuestion.Status.PUBLISHED).first()
    if not q:
        return _err("问题不存在", 404)
    data = _json_body(request)
    content = (data.get("content") or "").strip()
    if not content:
        return _err("回答正文不能为空", 400)
    if len(_strip_html(content)) > 20000:
        return _err("回答最长 2 万字", 400)
    a = QaAnswer.objects.create(
        question=q, author=user, content=_sanitize_html(content),
        status=QaAnswer.Status.PENDING, is_pinned=False,
    )
    _qa_broadcast_new_pending(f"回答 · {q.title}", user)
    return _ok({"id": a.id, "status": a.status})


# ═══════════════════════════════════════════════════════════════
# 用户编辑/删除回答（新增 path：GET/PUT/DELETE /api/qa/answers/{aid}/）
# ═══════════════════════════════════════════════════════════════

@csrf_exempt
def api_qa_answer_edit_user(request, aid):
    """GET/PUT/DELETE /api/qa/answers/{aid}/ — 作者本人的回答编辑/删除"""
    user, err = _require_user(request)
    if err:
        return err
    a = QaAnswer.objects.select_related("author", "question").filter(id=aid).first()
    if not a:
        return _err("内容不存在", 404)
    if a.author_id != user.id:
        return _err("只能操作自己发布的内容", 403)

    if request.method == "GET":
        return _ok({"id": a.id, "question_id": a.question_id, "content": a.content, "status": a.status})

    if request.method == "DELETE":
        data = _json_body(request)
        reason = (data.get("reason") or "").strip()
        if not reason:
            return _err("请填写删除理由", 400)
        if len(reason) > 500:
            return _err("删除理由最长 500 字", 400)
        needs = _qa_delete_needs_approval(a)
        if needs:
            # 有赞/收藏 → 需管理员批准
            _, created = _record_delete_request(
                "answer", a.id, user, reason, auto_approved=False, approved_immediately=False)
            if not created:
                return _err("删除申请已提交，等待审核", 400)
            _qa_broadcast_new_pending(f"删除申请 · {a.question.title}", user)
            return _ok({"id": a.id, "status": "pending", "submitted": True})
        _record_delete_request("answer", a.id, user, reason, auto_approved=True, approved_immediately=True)
        _soft_delete_answer(a)
        return _ok({"id": a.id, "status": "deleted", "submitted": False})

    if request.method != "PUT":
        return _err("仅支持 GET/PUT/DELETE", 405)

    data = _json_body(request)
    old_content = a.content
    changed = []
    if "content" in data:
        content = (data["content"] or "").strip()
        if not content:
            return _err("回答正文不能为空", 400)
        if len(_strip_html(content)) > 20000:
            return _err("回答最长 2 万字", 400)
        a.content = _sanitize_html(content)
        changed.append("content")
    back_to_pending = False
    if a.status == QaAnswer.Status.REJECTED:
        a.status = QaAnswer.Status.PENDING
        changed.append("status")
        back_to_pending = True
    if not changed:
        return _ok({"id": a.id, "status": a.status})
    a.save(update_fields=changed + ["updated_at"])
    QaEditHistory.objects.create(
        target_type="answer", target_id=a.id, editor=user,
        old_title="", new_title="",
        old_content=old_content, new_content=a.content,
    )
    if back_to_pending:
        _qa_broadcast_new_pending(f"重新提交回答 · {a.question.title}", user)
    return _ok({"id": a.id, "status": a.status})


# ═══════════════════════════════════════════════════════════════
# 最佳回答采纳（新增 path：POST /api/qa/answers/{aid}/accept/）
# ═══════════════════════════════════════════════════════════════

@csrf_exempt
def api_qa_answer_accept(request, aid):
    """POST /api/qa/answers/{aid}/accept/ — 采纳/取消最佳回答

    权限 = 问答区版主/超管（任意时） 或 提问者本人（站点开放时）。
    同一问题仅一条 is_accepted；重复点击同一采纳 = 取消。
    """
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    user, err = _require_user(request)
    if err:
        return err
    a = QaAnswer.objects.select_related("question", "author").filter(
        id=aid, status=QaAnswer.Status.PUBLISHED).first()
    if not a:
        return _err("回答不存在", 404)
    q = a.question
    is_manager = _can_manage_qa(user)
    is_asker = q.author_id == user.id
    if not is_manager and not is_asker:
        return _err("只有提问者或管理员可以采纳最佳回答", 403)
    if is_asker and not is_manager and not _qa_user_open():
        return _err("该功能暂未开放", 403)

    with transaction.atomic():
        if a.is_accepted:
            # 重复点同一采纳 → 取消
            QaAnswer.objects.filter(id=a.id).update(is_accepted=False)
            accepted = False
        else:
            # 清同问题其他采纳，再置本条
            QaAnswer.objects.filter(question=q, is_accepted=True).update(is_accepted=False)
            QaAnswer.objects.filter(id=a.id).update(is_accepted=True)
            accepted = True
            if a.author_id != user.id:
                _create_notification(
                    recipient=a.author, type=Notification.Type.OPERATION,
                    title="你的回答被采纳为最佳回答",
                    message=f"你的回答被采纳为「{q.title}」的最佳回答。",
                    triggered_by=user,
                )
    return _ok({"accepted": accepted})
