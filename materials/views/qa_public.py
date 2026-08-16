"""
BNU Sparks · 木铎星火 — 问答区公开 API（标签 / 列表 / 详情 / 收藏 / 点赞 / 门控 / 埋点）
"""

from datetime import date

from django.db import IntegrityError
from django.db.models import Count, F, Q
from django.views.decorators.csrf import csrf_exempt

from ..models import (
    QaAnswer,
    QaAnswerLike,
    QaAskClickDaily,
    QaFavorite,
    QaQuestion,
    QaTag,
    QaViewLog,
)
from .qa_helpers import (
    _can_manage_qa,
    _ensure_qa_l1_tags,
    _json_body,
    _nickname,
    _qa_answer_item,
    _qa_bump_heat,
    _qa_question_summary,
    _qa_user_open,
)
from .qa_user import (
    api_qa_question_create_user,
    api_qa_question_edit_user,
)
from .utils import (
    _err,
    _get_user,
    _ok,
    _safe_int,
    require_login,
)

# ═══════════════════════════════════════════════════════════════
# 公开：标签 / 列表 / 详情 / 浏览量 / 收藏 / 点赞 / 门控 / 埋点
# ═══════════════════════════════════════════════════════════════


def api_qa_tags(request):
    """GET /api/qa/tags/ — 两级标签"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    _ensure_qa_l1_tags()
    l1 = QaTag.objects.filter(level=1)
    l2 = QaTag.objects.filter(level=2)
    return _ok({
        "l1": [{"id": t.id, "name": t.name, "icon": t.icon, "color": t.color} for t in l1],
        "l2": [{"id": t.id, "name": t.name, "description": t.description} for t in l2],
    })


@csrf_exempt
def api_qa_questions(request):
    """GET /api/qa/questions/ — 列表（置顶优先 + 新在前；可选 tag/keyword/sort 筛选）
    POST /api/qa/questions/ — 普通用户提问（开关开 → PENDING 待审核，v183）"""
    if request.method == "POST":
        return api_qa_question_create_user(request)
    if request.method != "GET":
        return _err("仅支持 GET/POST", 405)
    qs = QaQuestion.objects.filter(status=QaQuestion.Status.PUBLISHED).select_related(
        "author", "tag_l1", "tag_l2")

    tag_l1 = _safe_int(request.GET.get("tag_l1"), None, lo=1)
    tag_l2 = _safe_int(request.GET.get("tag_l2"), None, lo=1)
    if tag_l1:
        qs = qs.filter(tag_l1_id=tag_l1)
    if tag_l2:
        qs = qs.filter(tag_l2_id=tag_l2)

    keyword = (request.GET.get("keyword") or "").strip()
    if keyword:
        qs = qs.filter(Q(title__icontains=keyword) | Q(content__icontains=keyword))

    sort = request.GET.get("sort") or "default"
    if sort == "latest":
        qs = qs.order_by("-created_at")
    elif sort == "heat":
        # v183：最热 = 热度分降序（置顶仍最前）
        qs = qs.order_by("-is_pinned", "-heat_score", "-created_at")
    else:
        qs = qs.order_by("-is_pinned", "-created_at")

    page = _safe_int(request.GET.get("page"), 1, lo=1)
    page_size = _safe_int(request.GET.get("pageSize"), 10, lo=1, hi=50)
    total = qs.count()
    items = qs[(page - 1) * page_size: page * page_size]
    return _ok({
        "total": total,
        "page": page,
        "pageSize": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "items": [_qa_question_summary(q) for q in items],
    })


@csrf_exempt
def api_qa_question_detail(request, qid):
    """GET /api/qa/questions/{id}/ — 详情 + 回答；deleted → 占位结构
    PUT/DELETE /api/qa/questions/{id}/ — 作者本人编辑/删除（dispatch → qa_user，v183）
    安全收紧（v183）：PENDING/REJECTED 全文仅作者/问答区版主可见，他人 404。"""
    if request.method in ("PUT", "DELETE"):
        return api_qa_question_edit_user(request, qid)
    if request.method != "GET":
        return _err("仅支持 GET/PUT/DELETE", 405)
    q = QaQuestion.objects.select_related("author", "tag_l1", "tag_l2").filter(id=qid).first()
    if not q:
        return _err("内容不存在", 404)
    user = _get_user(request)

    # v183 安全收紧：非发布态内容（待审核/已驳回）仅作者或管理端可见，防待审内容泄露
    if q.status in (QaQuestion.Status.PENDING, QaQuestion.Status.REJECTED):
        is_owner = user is not None and q.author_id == user.id
        if not is_owner and not _can_manage_qa(user):
            return _err("内容不存在", 404)

    if q.status == QaQuestion.Status.DELETED:
        # 旧链接直达 → 占位页，保留元信息，正文替换为占位文案
        return _ok({
            "deleted": True,
            "id": q.id,
            "title": q.title,
            "status": q.status,
            "deleted_hint": "该内容已被删除",
            "created_at": q.created_at.strftime("%Y-%m-%d %H:%M"),
            "author": _nickname(q.author),
        })

    is_favorited = False
    if user is not None:
        is_favorited = QaFavorite.objects.filter(
            user=user, question=q, answer__isnull=True).exists()

    # v183：annotate 收藏总数消除 N+1；排序最佳回答前置
    answers = list(QaAnswer.objects.filter(
        question=q, status=QaAnswer.Status.PUBLISHED,
    ).select_related("author").annotate(fav_n=Count("qa_favorited_by"))
        .order_by("-is_pinned", "-is_accepted", "-created_at"))

    return _ok({
        "deleted": False,
        "id": q.id,
        "title": q.title,
        "content": q.content,
        "status": q.status,
        "author": _nickname(q.author),
        "owner_id": q.author_id,
        "tag_l1_id": q.tag_l1_id,
        "tag_l1": q.tag_l1.name if q.tag_l1_id else "",
        "tag_l2_id": q.tag_l2_id,
        "tag_l2": q.tag_l2.name if q.tag_l2_id else "",
        "view_count": q.view_count,
        "favorite_count": q.favorite_count,
        "is_pinned": q.is_pinned,
        "is_favorited": is_favorited,
        "has_accepted": q.answers.filter(is_accepted=True).exists(),
        "qa_user_open": _qa_user_open(),
        "created_at": q.created_at.strftime("%Y-%m-%d %H:%M"),
        "answers": [_qa_answer_item(a, user, qa_fav_count=a.fav_n) for a in answers],
    })


@csrf_exempt
def api_qa_question_view(request, qid):
    """POST /api/qa/questions/{id}/view/ — 浏览量 +1（同一用户每日只算一次）"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    q = QaQuestion.objects.filter(id=qid, status=QaQuestion.Status.PUBLISHED).first()
    if not q:
        return _err("内容不存在", 404)
    user = _get_user(request)
    today = date.today()
    try:
        if user is not None:
            _, created = QaViewLog.objects.get_or_create(user=user, question=q, date=today)
        else:
            # 匿名走 (question,date) 条件唯一约束去重
            _, created = QaViewLog.objects.get_or_create(user=None, question=q, date=today)
        if created:
            QaQuestion.objects.filter(id=q.id).update(view_count=F("view_count") + 1)
            _qa_bump_heat(q, 1)  # v183：浏览 +1 热度
    except IntegrityError:
        pass  # 并发下唯一约束兜底，不重复计数
    q.refresh_from_db(fields=["view_count"])
    return _ok({"view_count": q.view_count})


@csrf_exempt
@require_login
def api_qa_question_favorite(request, qid):
    """POST /api/qa/questions/{id}/favorite/ — toggle 收藏问题"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    q = QaQuestion.objects.filter(id=qid, status=QaQuestion.Status.PUBLISHED).first()
    if not q:
        return _err("内容不存在", 404)
    fav = QaFavorite.objects.filter(user=request.user, question=q, answer__isnull=True).first()
    if fav:
        fav.delete()
        QaQuestion.objects.filter(id=q.id, favorite_count__gt=0).update(
            favorite_count=F("favorite_count") - 1)
        _qa_bump_heat(q, -3)  # v183：取消收藏 -3 热度
        favorited = False
    else:
        QaFavorite.objects.create(user=request.user, question=q, answer=None)
        QaQuestion.objects.filter(id=q.id).update(favorite_count=F("favorite_count") + 1)
        _qa_bump_heat(q, 3)  # v183：收藏 +3 热度
        favorited = True
    q.refresh_from_db(fields=["favorite_count"])
    return _ok({"favorited": favorited, "favorite_count": q.favorite_count})


def _ensure_question_fav(user, question):
    """收藏回答时同步建立问题级收藏（我的收藏合并显示）"""
    if not QaFavorite.objects.filter(user=user, question=question, answer__isnull=True).exists():
        QaFavorite.objects.create(user=user, question=question, answer=None)
        QaQuestion.objects.filter(id=question.id).update(favorite_count=F("favorite_count") + 1)


@csrf_exempt
@require_login
def api_qa_answer_favorite(request, aid):
    """POST /api/qa/answers/{id}/favorite/ — toggle 收藏回答；新增时自动收藏问题"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    a = QaAnswer.objects.select_related("question").filter(
        id=aid, status=QaAnswer.Status.PUBLISHED).first()
    if not a:
        return _err("内容不存在", 404)
    fav = QaFavorite.objects.filter(user=request.user, answer=a).first()
    if fav:
        # 取消回答收藏不撤销问题级收藏（问题仍在我的收藏）
        fav.delete()
        return _ok({"favorited": False, "favorite_count": QaFavorite.objects.filter(answer=a).count()})
    QaFavorite.objects.create(user=request.user, question=a.question, answer=a)
    _ensure_question_fav(request.user, a.question)
    return _ok({"favorited": True, "favorite_count": QaFavorite.objects.filter(answer=a).count()})


@csrf_exempt
@require_login
def api_qa_answer_like(request, aid):
    """POST /api/qa/answers/{id}/like/ — toggle 点赞回答"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    a = QaAnswer.objects.select_related("question").filter(
        id=aid, status=QaAnswer.Status.PUBLISHED).first()
    if not a:
        return _err("内容不存在", 404)
    like = QaAnswerLike.objects.filter(user=request.user, answer=a).first()
    if like:
        like.delete()
        QaAnswer.objects.filter(id=a.id, like_count__gt=0).update(
            like_count=F("like_count") - 1)
        _qa_bump_heat(a.question, -2)  # v183：取消点赞 -2 热度
        liked = False
    else:
        try:
            QaAnswerLike.objects.create(user=request.user, answer=a)
            QaAnswer.objects.filter(id=a.id).update(like_count=F("like_count") + 1)
            _qa_bump_heat(a.question, 2)  # v183：点赞 +2 热度
            liked = True
        except IntegrityError:
            liked = True  # 并发下已存在视为已点赞
    a.refresh_from_db(fields=["like_count"])
    return _ok({"liked": liked, "like_count": a.like_count})


@require_login
def api_qa_user_favorites(request):
    """GET /api/qa/user/favorites/ — 我的收藏·帖子（问题/回答按问题合并去重）"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    favs = QaFavorite.objects.filter(user=request.user).select_related(
        "question", "question__author", "question__tag_l1", "question__tag_l2",
    ).order_by("-created_at")

    seen = {}
    for fav in favs:
        q = fav.question
        if q.id in seen:
            continue
        seen[q.id] = {
            "id": q.id,
            "title": q.title,
            "status": q.status,
            "kind": "answer" if fav.answer else "question",
            "author": _nickname(q.author),
            "tag_l1": q.tag_l1.name if q.tag_l1_id else "",
            "tag_l2": q.tag_l2.name if q.tag_l2_id else "",
            "favorited_at": fav.created_at.strftime("%Y-%m-%d"),
        }
    return _ok({"items": list(seen.values())})


@csrf_exempt
def api_qa_guest_verify(request):
    """POST /api/qa/guest/verify/ — 2026 门控：学号前四位为 2026 才可浏览"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    data = _json_body(request)
    sid = (data.get("sid") or "").strip()
    if not sid:
        return _err("请输入学号", 400)
    if not sid[:4].isdigit() or not sid[:4].startswith("2026"):
        return _err("仅限 2026 级新生浏览，敬请期待后续开放", 403)
    return _ok({"verified": True})


@csrf_exempt
def api_qa_ask_click(request):
    """POST /api/qa/ask-click/ — 「我要提问」按钮无权限点击埋点（当日聚合）"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    today = date.today()
    row, _ = QaAskClickDaily.objects.get_or_create(date=today, defaults={"count": 0})
    QaAskClickDaily.objects.filter(id=row.id).update(count=F("count") + 1)
    return _ok({})
