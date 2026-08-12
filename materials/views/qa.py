"""
BNU Sparks · 木铎星火 — 问答区（新生指南）API

Phase 1：管理员/问答区版主（can_moderate_qa）发布图文问题与回答；
已认证学生及通过 2026 门控的未注册新生浏览、搜索、收藏、点赞。
Phase 2 预留（仅字段/枚举，不实现）：用户提问/回答、最佳回答采纳、通知、热度排序。
"""

import json
import re
from datetime import date, timedelta
from functools import wraps
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.db import IntegrityError
from django.db.models import F, Q, Sum
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from PIL import Image as PILImage

from ..models import (
    Notification,
    QaAnswer,
    QaAnswerLike,
    QaAskClickDaily,
    QaEditHistory,
    QaFavorite,
    QaQuestion,
    QaTag,
    QaViewLog,
    UserProfile,
)
from .utils import (
    _create_notification,
    _err,
    _get_or_create_profile,
    _get_user,
    _ok,
    _safe_int,
    require_login,
)

# ═══════════════════════════════════════════════════════════════
# HTML 净化（白名单，create/edit 每次服务端强制，最高安全面）
# ═══════════════════════════════════════════════════════════════

_QA_ALLOWED_TAGS = {"p", "br", "strong", "em", "u", "s", "ul", "ol", "li", "img", "a"}
_QA_ATTRS = {"img": {"src", "alt"}, "a": {"href", "title", "rel", "target"}}


class _QaSanitizer(HTMLParser):
    """白名单 HTML 净化器：只保留允许标签/属性，剥 script/on*/javascript:"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []

    def _attrs(self, tag, attrs):
        out = []
        for k, v in attrs:
            kl = k.lower()
            if kl.startswith("on"):
                continue
            if kl == "href" and v.strip().lower().startswith("javascript:"):
                continue
            if tag == "img":
                if kl == "src":
                    sv = v.strip()
                    if not (sv.startswith("/media/") or sv.startswith("http://")):
                        continue
                if kl not in _QA_ATTRS["img"]:
                    continue
                out.append((k, v))
            elif tag == "a" and kl in _QA_ATTRS["a"]:
                if kl == "target":
                    v = "_blank"
                elif kl == "rel":
                    v = "noopener noreferrer"
                out.append((k, v))
        return "".join(f' {k}="{v}"' for k, v in out)

    def handle_starttag(self, tag, attrs):
        if tag == "br":
            self.out.append("<br>")
        elif tag in _QA_ALLOWED_TAGS:
            self.out.append(f"<{tag}{self._attrs(tag, attrs)}>")

    def handle_startendtag(self, tag, attrs):
        if tag == "img":
            self.out.append(f"<img{self._attrs(tag, attrs)}>")
        else:
            self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag in _QA_ALLOWED_TAGS and tag != "br":
            self.out.append(f"</{tag}>")

    def handle_data(self, data):
        self.out.append(data)

    def handle_comment(self, data):
        pass


def _sanitize_html(raw):
    if not raw:
        return ""
    try:
        parser = _QaSanitizer()
        parser.feed(raw)
        parser.close()
        return "".join(parser.out)
    except Exception:
        return ""


def _strip_html(raw):
    """粗略去标签 + 反转义，用于字数统计（正文以可见字符计）"""
    if not raw:
        return ""
    return unescape(re.sub(r"<[^>]*>", "", raw))


def _nickname(user):
    return user.first_name or user.username


# ═══════════════════════════════════════════════════════════════
# 问答区版主判定与受众广播
# ═══════════════════════════════════════════════════════════════

def _can_manage_qa(user):
    """超管或 can_moderate_qa 即问答区版主（独立标志，不进课程树辖区）"""
    if not user or not user.is_authenticated:
        return False
    profile = _get_or_create_profile(user)
    return profile.role == UserProfile.Role.SUPER_ADMIN or profile.can_moderate_qa


def _qa_moderator_audience():
    """问答区版主受众 = 全部超管 + can_moderate_qa（每日报表等广播用）"""
    return [p.user for p in UserProfile.objects.filter(
        Q(role=UserProfile.Role.SUPER_ADMIN) | Q(can_moderate_qa=True),
    ).select_related("user")]


def require_qa_manager(view):
    """管理端点守卫：登录 + 问答区版主/超管"""
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        user = _get_user(request)
        if user is None:
            return _err("请先登录", 401)
        if not _can_manage_qa(user):
            return _err("权限不足", 403)
        request.user = user
        return view(request, *args, **kwargs)
    return wrapper


def _qa_question_summary(q):
    return {
        "id": q.id,
        "title": q.title,
        "author": _nickname(q.author),
        "tag_l1_id": q.tag_l1_id,
        "tag_l1": q.tag_l1.name if q.tag_l1_id else "",
        "tag_l2_id": q.tag_l2_id,
        "tag_l2": q.tag_l2.name if q.tag_l2_id else "",
        "view_count": q.view_count,
        "favorite_count": q.favorite_count,
        "answer_count": q.answers.filter(status=QaAnswer.Status.PUBLISHED).count(),
        "is_pinned": q.is_pinned,
        "created_at": q.created_at.strftime("%Y-%m-%d %H:%M"),
        "content_preview": _strip_html(q.content)[:80],
    }


def _qa_answer_item(a, user=None):
    liked = False
    is_favorited = False
    if user is not None:
        liked = QaAnswerLike.objects.filter(user=user, answer=a).exists()
        is_favorited = QaFavorite.objects.filter(user=user, answer=a).exists()
    return {
        "id": a.id,
        "content": a.content,
        "author": _nickname(a.author),
        "is_pinned": a.is_pinned,
        "like_count": a.like_count,
        "favorite_count": QaFavorite.objects.filter(answer=a).count(),
        "liked": liked,
        "is_favorited": is_favorited,
        "created_at": a.created_at.strftime("%Y-%m-%d %H:%M"),
    }


def _json_body(request):
    try:
        return json.loads(request.body or b"{}")
    except Exception:
        return {}


# ═══════════════════════════════════════════════════════════════
# 公开：标签 / 列表 / 详情 / 浏览量 / 收藏 / 点赞 / 门控 / 埋点
# ═══════════════════════════════════════════════════════════════

def api_qa_tags(request):
    """GET /api/qa/tags/ — 两级标签"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    l1 = QaTag.objects.filter(level=1)
    l2 = QaTag.objects.filter(level=2)
    return _ok({
        "l1": [{"id": t.id, "name": t.name, "icon": t.icon, "color": t.color} for t in l1],
        "l2": [{"id": t.id, "name": t.name, "description": t.description} for t in l2],
    })


def api_qa_questions(request):
    """GET /api/qa/questions/ — 列表（置顶优先 + 新在前；可选 tag/keyword 筛选）"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
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


def api_qa_question_detail(request, qid):
    """GET /api/qa/questions/{id}/ — 详情 + 回答；deleted → 占位结构"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    q = QaQuestion.objects.select_related("author", "tag_l1", "tag_l2").filter(id=qid).first()
    if not q:
        return _err("内容不存在", 404)
    user = _get_user(request)

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

    answers = list(QaAnswer.objects.filter(
        question=q, status=QaAnswer.Status.PUBLISHED,
    ).select_related("author").order_by("-is_pinned", "-created_at"))

    return _ok({
        "deleted": False,
        "id": q.id,
        "title": q.title,
        "content": q.content,
        "author": _nickname(q.author),
        "tag_l1_id": q.tag_l1_id,
        "tag_l1": q.tag_l1.name if q.tag_l1_id else "",
        "tag_l2_id": q.tag_l2_id,
        "tag_l2": q.tag_l2.name if q.tag_l2_id else "",
        "view_count": q.view_count,
        "favorite_count": q.favorite_count,
        "is_pinned": q.is_pinned,
        "is_favorited": is_favorited,
        "created_at": q.created_at.strftime("%Y-%m-%d %H:%M"),
        "answers": [_qa_answer_item(a, user) for a in answers],
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
        favorited = False
    else:
        QaFavorite.objects.create(user=request.user, question=q, answer=None)
        QaQuestion.objects.filter(id=q.id).update(favorite_count=F("favorite_count") + 1)
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
    a = QaAnswer.objects.filter(id=aid, status=QaAnswer.Status.PUBLISHED).first()
    if not a:
        return _err("内容不存在", 404)
    like = QaAnswerLike.objects.filter(user=request.user, answer=a).first()
    if like:
        like.delete()
        QaAnswer.objects.filter(id=a.id, like_count__gt=0).update(
            like_count=F("like_count") - 1)
        liked = False
    else:
        try:
            QaAnswerLike.objects.create(user=request.user, answer=a)
            QaAnswer.objects.filter(id=a.id).update(like_count=F("like_count") + 1)
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

    questions = QaQuestion.objects.all().select_related("author", "tag_l1", "tag_l2")
    answers = QaAnswer.objects.all().select_related("author", "question")

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
    """GET /api/admin/qa/pending/ — 论坛管理待审（Phase 1 管理员直发，恒空；Phase 2 用户提问/回答待审）"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    # Phase 2 TODO：pending 状态的用户提问/回答列表 + 审核（通过/驳回/附原因）
    return _ok({"items": [], "total": 0, "page": 1, "pageSize": 10, "total_pages": 1})


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


# ═══════════════════════════════════════════════════════════════
# 每日「我要提问」埋点报表（管理命令 qa_daily_report 调用）
# ═══════════════════════════════════════════════════════════════

def _send_daily_qa_report(today=None):
    """聚合当日 + 累积点击，通知全体超管 + 问答区版主。返回通知数。"""
    today = today or date.today()
    row = QaAskClickDaily.objects.filter(date=today).first()
    today_count = row.count if row else 0
    total = QaAskClickDaily.objects.aggregate(s=Sum("count"))["s"] or 0
    audience = _qa_moderator_audience()
    sent = 0
    for u in audience:
        _create_notification(
            recipient=u, type=Notification.Type.OPERATION,
            title="「我要提问」点击量日报",
            message=f"今日 {today_count} 次，累计 {total} 次。若点击持续增多，可考虑提前开放提问功能。",
        )
        sent += 1
    return sent


# ═══════════════════════════════════════════════════════════════
# 48h 硬删（管理命令 qa_purge 调用，镜像 _purge_expired_trash）
# ═══════════════════════════════════════════════════════════════

def _purge_expired_qa(retention_hours=48):
    """硬删软删除超过 retention_hours 的问答区问题/回答，并清理孤儿留痕。

    - 回答真删：级联清 QaAnswerLike + 回答级 QaFavorite
    - 问题真删：级联清 QaAnswer/QaViewLog/问题级 QaFavorite（含其下回答的点赞与收藏）
    - 兜底清理：QaEditHistory 是 target_type/target_id 无 FK，硬删内容后需按现存 id 收尾；
      QaFavorite 正常路径已级联，仅防 SQLite FK 未强制时的残留。
    返回 (硬删问题数, 硬删回答数)。
    """
    now = timezone.now()
    cutoff = now - timedelta(hours=retention_hours)

    expired_answers = QaAnswer.objects.filter(
        status=QaAnswer.Status.DELETED, deleted_at__lt=cutoff)
    answer_count = expired_answers.count()
    expired_answers.delete()

    expired_questions = QaQuestion.objects.filter(
        status=QaQuestion.Status.DELETED, deleted_at__lt=cutoff)
    question_count = expired_questions.count()
    expired_questions.delete()

    # 孤儿编辑留痕（无 FK，硬删后 target 已不存在 → 删除，保留 target 仍存在的）
    QaEditHistory.objects.exclude(
        Q(target_type="question", target_id__in=QaQuestion.objects.values("id"))
        | Q(target_type="answer", target_id__in=QaAnswer.objects.values("id"))
    ).delete()
    # 兜底：孤儿收藏（正常路径 FK 级联已清，防 SQLite 未强制 FK 时残留）
    QaFavorite.objects.exclude(question_id__in=QaQuestion.objects.values("id")).delete()
    return question_count, answer_count
