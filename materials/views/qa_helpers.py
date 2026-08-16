"""
BNU Sparks · 木铎星火 — 问答区共享辅助（HTML 净化 / 版主判定 / 序列化 / 标签兜底）
"""

import json
import re
from functools import wraps
from html import unescape
from html.parser import HTMLParser

from django.db.models import F, Q

from ..models import (
    College,
    QaAnswer,
    QaAnswerLike,
    QaConfig,
    QaFavorite,
    QaQuestion,
    QaTag,
    UserProfile,
)
from ..qa_seed import seed_qa_tags
from .utils import (
    _err,
    _get_or_create_profile,
    _get_user,
)

# ═══════════════════════════════════════════════════════════════
# HTML 净化（白名单，create/edit 每次服务端强制，最高安全面）
# ═══════════════════════════════════════════════════════════════

# v175：加 h2/h3 支持长文小标题（无属性，走 _QA_ALLOWED_TAGS 分支天然安全）
_QA_ALLOWED_TAGS = {"p", "br", "strong", "em", "u", "s", "ul", "ol", "li", "img", "a", "h2", "h3"}
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
                    # v175：补 https://（此前 https 外链图被剥，bug）
                    if not (sv.startswith("/media/") or sv.startswith("http://") or sv.startswith("https://")):
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


# ═══════════════════════════════════════════════════════════════
# 站点开关 / 热度 / 删除判定（Phase 2 v183）
# ═══════════════════════════════════════════════════════════════

def _qa_user_open():
    """普通用户提问/回答开放开关（站点级单例 QaConfig pk=1）"""
    return QaConfig.user_can_post()


def _qa_bump_heat(q, delta):
    """问题热度 +delta（F 原子更新；负增量加防负护栏，热度永不回退为负）"""
    if delta >= 0:
        QaQuestion.objects.filter(id=q.id).update(heat_score=F("heat_score") + delta)
    else:
        QaQuestion.objects.filter(id=q.id, heat_score__gte=abs(delta)).update(
            heat_score=F("heat_score") + delta)


def _qa_delete_needs_approval(target):
    """删除是否需要管理员批准：
    - question → 有 PUBLISHED 回答
    - answer → 有赞或有收藏
    简单删除（无互动）自动批准直接软删，留 auto_approved 痕。
    """
    if isinstance(target, QaAnswer):
        if target.like_count > 0:
            return True
        return QaFavorite.objects.filter(answer=target).exists()
    # question
    return QaAnswer.objects.filter(question=target, status=QaAnswer.Status.PUBLISHED).exists()


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
        # v183：热度分 / 是否有最佳回答
        "heat_score": q.heat_score,
        "has_accepted": q.answers.filter(is_accepted=True).exists(),
        "created_at": q.created_at.strftime("%Y-%m-%d %H:%M"),
        "content_preview": _strip_html(q.content)[:80],
    }


def _qa_answer_item(a, user=None, qa_fav_count=None):
    liked = False
    is_favorited = False
    if user is not None:
        liked = QaAnswerLike.objects.filter(user=user, answer=a).exists()
        is_favorited = QaFavorite.objects.filter(user=user, answer=a).exists()
    # v183：favorite_count 传参避免逐条查询 N+1（未传时保持旧行为）
    favorite_count = qa_fav_count if qa_fav_count is not None else QaFavorite.objects.filter(answer=a).count()
    return {
        "id": a.id,
        "content": a.content,
        "author": _nickname(a.author),
        "author_id": a.author_id,
        "is_pinned": a.is_pinned,
        "is_accepted": a.is_accepted,
        "like_count": a.like_count,
        "favorite_count": favorite_count,
        "liked": liked,
        "is_favorited": is_favorited,
        "created_at": a.created_at.strftime("%Y-%m-%d %H:%M"),
    }


def _json_body(request):
    try:
        return json.loads(request.body or b"{}")
    except Exception:
        return {}


def _ensure_qa_l1_tags():
    """新学院自动补一级标签（migration 0024 只跑一次，后台后续新增学院靠此兜底）"""
    if QaTag.objects.filter(level=1).count() < College.objects.count() + 1:
        seed_qa_tags(QaTag, College)
