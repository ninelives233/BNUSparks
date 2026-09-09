"""
BNU Sparks · 木铎星火 — 问答区共享辅助（HTML 净化 / 版主判定 / 序列化 / 标签兜底）
"""

import json
import re
from functools import wraps
from html import escape, unescape
from html.parser import HTMLParser
from urllib.parse import urlsplit

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
_QA_TAG_ALIASES = {"div": "p", "b": "strong", "i": "em", "strike": "s"}
_QA_DROP_CONTENT_TAGS = {"script", "style", "iframe", "object", "embed", "svg", "math"}


class _QaSanitizer(HTMLParser):
    """白名单 HTML 净化器：只保留允许标签/属性，剥 script/on*/javascript:"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self._drop_depth = 0

    @staticmethod
    def _safe_url(tag, attr, value):
        value = (value or "").strip()
        # 协议名中的换行、制表符和控制字符会被浏览器忽略；校验时也必须消除，
        # 才能拦住 java\nscript: / data: 等混淆写法。
        compact = re.sub(r"[\x00-\x20\x7f]+", "", unescape(value)).lower()
        if attr == "src" and tag == "img":
            if value.startswith("/media/") and not value.startswith("//"):
                return value
            try:
                return value if urlsplit(compact).scheme in {"http", "https"} else None
            except ValueError:
                return None
        if attr == "href" and tag == "a":
            if value.startswith("#") or (value.startswith("/") and not value.startswith("//")):
                return value
            try:
                return value if urlsplit(compact).scheme in {"http", "https", "mailto"} else None
            except ValueError:
                return None
        return value

    def _attrs(self, tag, attrs):
        out = []
        seen = set()
        for k, v in attrs:
            kl = k.lower()
            if kl.startswith("on") or kl in seen:
                continue
            if tag == "img":
                if kl == "src":
                    v = self._safe_url(tag, kl, v)
                    if v is None:
                        continue
                if kl not in _QA_ATTRS["img"]:
                    continue
                out.append((kl, v or ""))
                seen.add(kl)
            elif tag == "a" and kl in _QA_ATTRS["a"]:
                if kl == "href":
                    v = self._safe_url(tag, kl, v)
                    if v is None:
                        continue
                elif kl == "target":
                    v = "_blank"
                elif kl == "rel":
                    v = "noopener noreferrer"
                out.append((kl, v or ""))
                seen.add(kl)
        if tag == "a" and "target" in seen and "rel" not in seen:
            out.append(("rel", "noopener noreferrer"))
        return "".join(f' {escape(k, quote=True)}="{escape(v, quote=True)}"' for k, v in out)

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if self._drop_depth:
            if tag in _QA_DROP_CONTENT_TAGS:
                self._drop_depth += 1
            return
        if tag in _QA_DROP_CONTENT_TAGS:
            self._drop_depth = 1
            return
        tag = _QA_TAG_ALIASES.get(tag, tag)
        if tag == "br":
            self.out.append("<br>")
        elif tag in _QA_ALLOWED_TAGS:
            self.out.append(f"<{tag}{self._attrs(tag, attrs)}>")

    def handle_startendtag(self, tag, attrs):
        tag = tag.lower()
        if tag == "img":
            self.out.append(f"<img{self._attrs(tag, attrs)}>")
        else:
            self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self._drop_depth:
            if tag in _QA_DROP_CONTENT_TAGS:
                self._drop_depth -= 1
            return
        tag = _QA_TAG_ALIASES.get(tag, tag)
        if tag in _QA_ALLOWED_TAGS and tag != "br":
            self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if self._drop_depth:
            return
        # contenteditable 在不同浏览器里可能把回车保留成文本换行；
        # 转成 <br>，避免 HTML 的空白折叠再次吞掉用户的换行。
        lines = data.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        for index, line in enumerate(lines):
            self.out.append(escape(line, quote=False))
            if index < len(lines) - 1:
                self.out.append("<br>")

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


def _avatar_url(user):
    """返回问答详情所需的头像地址；没有头像或历史用户缺资料时返回空串。"""
    try:
        profile = user.profile
    except UserProfile.DoesNotExist:
        return ""
    return profile.avatar.url if profile.avatar else ""


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
        "avatar_url": _avatar_url(a.author),
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
