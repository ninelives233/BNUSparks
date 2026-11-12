"""
BNU Sparks · 木铎星火 — 搜索 v2（独立搜索结果页后端）

v2 通过旧地址上的显式版本参数进入：/api/search/?v=2 与 /api/qa/search/?v=2。
没有 v 或 v=1 时旧入口行为完全不变；本模块不被旧分支调用。
v2 仅支持 GET；未支持的显式版本由入口返回 400。

边界（对应实施方案 §5–§6）：
- 前端 type=all 是页面聚合状态，不是本模块的一个大响应；v2 /api/search/
  只接受 course|material，问答走 /api/qa/search/?v=2。
- 课程先在 Python 内收敛合并链与目录挂载，再计数、排序、分页——
  不先截断候选再冒充完整搜索；公开资料计数在根去重之后批量聚合。
- 资料按批准状态检索标题/教师/描述；摘要只取真实命中的描述窗口，
  不返回 file_path / 下载令牌 / 未审核内容。
- 问答沿用 v1 公开范围（已发布问题与已发布回答），并在计数与切页之前
  完成纯文本最终命中确认，避免 v1「分页后 continue」的总数漂移。
- 关键词只进入参数化 ORM；只读，不引入迁移、事务或文件操作。
"""

import logging

from django.db.models import Count, Q
from django.utils import timezone

from ..models import (
    College,
    Course,
    CourseCategory,
    Material,
    MaterialType,
    QaAnswer,
    QaQuestion,
    QaTag,
)
from .qa_helpers import _nickname, _qa_snippet, _strip_html
from .utils import _err, _ok, _get_user
from .utils_course_tree import _normalize_course_code, course_display_names
from ..services.course_visibility import education_for_user, visible_category_ids

logger = logging.getLogger(__name__)

MAX_KEYWORD_LEN = 200

COURSE_SORTS = ("relevance", "name")
MATERIAL_SORTS = ("relevance", "latest", "downloads")
QA_SORTS = ("default", "latest")

_COURSE_PAGE_SIZE = 20
_MATERIAL_PAGE_SIZE = 20
_QA_PAGE_SIZE = 10


# ═══════════════════════════════════════════════════════════════
# 参数解析（非法已声明参数 → 400，与 v1 的收敛式 _safe_int 不同）
# ═══════════════════════════════════════════════════════════════

class _ParamError(Exception):
    pass


def _strict_int(raw, name, lo, hi, default=None):
    """缺失返回 default；非法/越界抛 _ParamError。"""
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise _ParamError(f"{name} 参数无效")
    if value < lo or value > hi:
        raise _ParamError(f"{name} 参数超出范围")
    return value


def _clean_keyword(request):
    query = (request.GET.get("q") or "").strip()
    if len(query) > MAX_KEYWORD_LEN:
        raise _ParamError("搜索关键词过长")
    return query


def _iso_time(value):
    """v2 统一输出带时区的 ISO 8601 字符串；USE_TZ=False 时补当前时区。"""
    if not value:
        return ""
    if timezone.is_naive(value):
        value = timezone.make_aware(value, timezone.get_current_timezone())
    return value.isoformat()


def _normalize_file_type(value):
    return (value or "").strip().lower().lstrip(".")


def _v2_envelope(query, type_, keyword_total, total, page, page_size, sort, items, facets):
    total_pages = max(1, -(-total // page_size))
    return _ok({
        "query": query,
        "type": type_,
        "keyword_total": keyword_total,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "has_more": page < total_pages,
        "sort": sort,
        "items": items,
        "facets": facets or {},
    })


def _v2_zero(query, type_, page_size, sort):
    """空关键词：零结果结构，不查业务数据。"""
    return _v2_envelope(query, type_, 0, 0, 1, page_size, sort, [], {})


# ═══════════════════════════════════════════════════════════════
# 课程：先收敛身份，再计数与分页
# ═══════════════════════════════════════════════════════════════

class _CourseMount:
    """一个真实课程在导航树中的一个可定位挂载点（叶子）。"""

    __slots__ = ("category_id", "name", "segments")

    def __init__(self, category_id, name, segments):
        self.category_id = category_id
        self.name = name
        self.segments = segments


def _course_topology(request=None):
    """一次请求内可复用的目录拓扑与合并关系映射。

    轻量字段批量读取（cat/course/college 各 1 次查询），构建：
    - mounts: course_id → [挂载点]（树序）
    - display: course_id → 树内首个叶子显示名（与 course_display_names 同口径）
    - root_of / aliases: 合并链终点与别名组（带环、缺失保护）
    - colleges: College 行映射
    """
    cats = list(CourseCategory.objects.only(
        "id", "parent_id", "name", "order", "is_divider", "education_level",
        "course_id", "course_text",
    ).order_by("order", "id"))
    education = education_for_user(_get_user(request)) if request is not None else "本科"
    if request is not None and (education != "本科" or any(cat.education_level for cat in cats)):
        allowed = visible_category_ids(
            ({"id": cat.id, "parent_id": cat.parent_id, "name": cat.name,
              "education_level": cat.education_level} for cat in cats),
            education,
        )
        cats = [cat for cat in cats if cat.id in allowed]
    child_map = {}
    for cat in cats:
        child_map.setdefault(cat.parent_id, []).append(cat)

    # course_text 前缀解析（与 _build_tree_node 同语义：无 * 时唯一命中才成真实叶子）
    text_patterns = []
    for cat in cats:
        raw = (cat.course_text or "").strip()
        if raw and "*" not in raw:
            stripped = raw.replace("*", "").replace("-", "")
            if stripped:
                text_patterns.append((cat, stripped))
    text_match = {}
    if text_patterns:
        for course in Course.objects.order_by("id").only("id", "code"):
            code = course.code or ""
            if not code:
                continue
            for cat, stripped in text_patterns:
                if code.startswith(stripped):
                    text_match.setdefault(cat.id, []).append(course.id)

    mounts = {}
    display = {}

    def walk(cat, segments):
        if cat.is_divider:
            return
        children = child_map.get(cat.id)
        if children:
            for child in children:
                walk(child, segments + [child.name])
            return
        if cat.course_id:
            mounts.setdefault(cat.course_id, []).append(
                _CourseMount(cat.id, cat.name, segments))
            display.setdefault(cat.course_id, cat.name)
        elif cat.course_text and "*" not in cat.course_text:
            matched = text_match.get(cat.id) or []
            if len(matched) == 1:
                mounts.setdefault(matched[0], []).append(
                    _CourseMount(cat.id, cat.name, segments))
                display.setdefault(matched[0], cat.name)

    for root_cat in child_map.get(None, []):
        walk(root_cat, [root_cat.name])

    courses = list(Course.objects.order_by("id").only(
        "id", "code", "name", "course_type", "college_id", "merged_into_id"))
    by_id = {c.id: c for c in courses}
    root_of = {}
    for course in courses:
        seen = {course.id}
        current = course
        while (current.merged_into_id
               and current.merged_into_id not in seen
               and current.merged_into_id in by_id):
            seen.add(current.merged_into_id)
            current = by_id[current.merged_into_id]
        root_of[course.id] = current.id
    aliases = {}
    for course in courses:
        if course.merged_into_id:
            aliases.setdefault(root_of[course.id], []).append(course)

    colleges = {
        col.id: col
        for col in College.objects.only("id", "name", "short_name", "order").order_by("order", "id")
    }
    return {
        "courses": courses,
        "by_id": by_id,
        "root_of": root_of,
        "aliases": aliases,
        "mounts": mounts,
        "display": display,
        "colleges": colleges,
    }


def _college_payload(colleges, college_id):
    if not college_id:
        return None
    col = colleges.get(college_id)
    if col is None:
        return None
    return {"id": col.id, "name": col.name, "short_name": col.short_name or ""}


def _search_courses_v2(request, query, page, page_size):
    """返回 (keyword_total, total, page, items, facets)。page 为收敛后的有效页码。"""
    sort = request.GET.get("sort") or "relevance"
    if sort not in COURSE_SORTS:
        raise _ParamError("sort 参数无效")
    course_type = request.GET.get("course_type") or ""
    if course_type and course_type not in ("major", "general"):
        raise _ParamError("course_type 参数无效")
    college_id = _strict_int(request.GET.get("college"), "college", 1, 10 ** 9)
    if college_id is not None and college_id not in _college_ids():
        raise _ParamError("college 参数无效")
    if course_type == "general" and college_id is not None:
        raise _ParamError("通识课不支持按学院筛选")

    topo = _course_topology(request)
    ql = query.lower()
    qnorm = _normalize_course_code(query)

    # 1) 关键词按课程行命中，再收敛到合并根（别名代码命中回到根）
    groups = {}

    def group_of(course):
        root_id = topo["root_of"][course.id]
        group = groups.get(root_id)
        if group is None:
            group = {"root": topo["by_id"][root_id], "code_hit": False, "name_hit": False}
            groups[root_id] = group
        return group

    for course in topo["courses"]:
        code = course.code or ""
        code_hit = bool(ql) and (ql in code.lower()
                                 or (qnorm and qnorm in _normalize_course_code(code)))
        name_hit = bool(ql) and ql in (course.name or "").lower()
        if not code_hit and not name_hit:
            display_hit = any(
                ql in (mount.name or "").lower()
                for mount in topo["mounts"].get(course.id, ()))
            if not display_hit:
                continue
            name_hit = True
        group = group_of(course)
        group["code_hit"] = group["code_hit"] or code_hit
        group["name_hit"] = group["name_hit"] or name_hit

    def members_of(group):
        return [group["root"]] + topo["aliases"].get(group["root"].id, [])

    # 有效课程来源与树一致：根与别名都没有有效挂载的组（孤儿课程）排除；
    # 根本身没挂目录但有效别名挂树时仍返回（路径取别名挂载点）。
    pre_filter = [
        g for g in groups.values()
        if any(member.id in topo["mounts"] for member in members_of(g))
    ]
    visible_groups = list(pre_filter)
    keyword_total = len(pre_filter)

    # 2) 过滤（作用于根课程字段）
    if course_type:
        pre_filter = [g for g in pre_filter if g["root"].course_type == course_type]
    if college_id is not None:
        pre_filter = [g for g in pre_filter if g["root"].college_id == college_id]
    total = len(pre_filter)
    # 页码超过末页时返回末页（前端负责 replace 修正 URL）
    total_pages = max(1, -(-total // page_size))
    if page > total_pages:
        page = total_pages

    # 3) 排序（相关度分层 → 代码、根 ID；名称按显示名、根 ID）
    def primary_display(group):
        for member in members_of(group):
            name = topo["display"].get(member.id)
            if name:
                return name
        return group["root"].name or ""

    for group in pre_filter:
        members = members_of(group)
        codes = [(c.code or "") for c in members]
        names = [topo["display"].get(c.id, "") for c in members if topo["display"].get(c.id)]
        if qnorm and any(_normalize_course_code(c) == qnorm for c in codes):
            tier = 1
        elif any(n == query for n in names):
            tier = 2
        elif (any(c.lower().startswith(ql) for c in codes)
              or (qnorm and any(
                  _normalize_course_code(c).startswith(qnorm) for c in codes))
              or any(n.lower().startswith(ql) for n in names)
              or any((c.name or "").lower().startswith(ql) for c in members)):
            tier = 3
        else:
            tier = 4
        group["tier"] = tier
        group["display_name"] = primary_display(group)

    if sort == "name":
        pre_filter.sort(key=lambda g: (g["display_name"], g["root"].id))
    else:
        pre_filter.sort(key=lambda g: (g["tier"], g["root"].code or "", g["root"].id))

    start = (page - 1) * page_size
    page_groups = pre_filter[start:start + page_size]

    # 4) 分页后批量补齐：别名代码、有效路径、公开资料计数
    count_ids = set()
    for group in page_groups:
        for member in members_of(group):
            count_ids.add(member.id)
    count_map = {}
    if count_ids:
        count_map = {
            row["course_id"]: row["n"]
            for row in Material.objects.filter(
                course_id__in=count_ids, review_status="approved",
            ).values("course_id").annotate(n=Count("id"))
        }

    items = []
    for group in page_groups:
        root = group["root"]
        members = members_of(group)
        codes = []
        for member in members:
            if member.code and member.code not in codes:
                codes.append(member.code)
        paths = []
        for member in members:
            for mount in topo["mounts"].get(member.id, ()):
                paths.append({
                    "category_id": mount.category_id,
                    "segments": list(mount.segments),
                })
        paths.sort(key=lambda p: (len(p["segments"]), p["segments"]))
        count = sum(count_map.get(member.id, 0) for member in members)
        matched = []
        if group["code_hit"]:
            matched.append("code")
        if group["name_hit"]:
            matched.append("name")
        items.append({
            "id": root.id,
            "code": root.code or "",
            "codes": codes,
            "name": group["display_name"],
            "course_type": root.course_type,
            "college": _college_payload(topo["colleges"], root.college_id),
            "approved_material_count": count,
            "matched_fields": matched,
            "paths": paths,
        })

    # 5) facets：按当前关键词的未附加筛选匹配集合生成
    facet_colleges = []
    seen = set()
    for group in visible_groups:
        cid = group["root"].college_id
        if cid and cid not in seen and cid in topo["colleges"]:
            seen.add(cid)
            col = topo["colleges"][cid]
            facet_colleges.append({"id": col.id, "name": col.short_name or col.name})
    facet_colleges.sort(key=lambda c: c["id"])
    return keyword_total, total, page, items, {"colleges": facet_colleges}


def _college_ids():
    return set(College.objects.values_list("id", flat=True))


# ═══════════════════════════════════════════════════════════════
# 资料：批准状态内检索标题/教师/描述
# ═══════════════════════════════════════════════════════════════

def _material_relevance_tier(m, matched, ql):
    title = (m.title or "").lower()
    if title == ql:
        return 1
    if title.startswith(ql):
        return 2
    if "title" in matched:
        return 3
    if "teacher" in matched:
        return 4
    return 5


def _description_snippet(description, keyword, limit=140, window=60):
    """描述命中窗口摘要；未命中/无描述返回空串，不编造。"""
    text = (description or "").strip()
    if not text:
        return ""
    idx = text.lower().find(keyword.lower())
    if idx < 0:
        return ""
    start = max(0, idx - window)
    end = min(len(text), idx + len(keyword) + window)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return prefix + text[start:end] + suffix


def _search_materials_v2(request, query, page, page_size):
    """返回 (keyword_total, total, page, items, facets)。page 为收敛后的有效页码。"""
    sort = request.GET.get("sort") or "relevance"
    if sort not in MATERIAL_SORTS:
        raise _ParamError("sort 参数无效")
    course_type = request.GET.get("course_type") or ""
    if course_type and course_type not in ("major", "general"):
        raise _ParamError("course_type 参数无效")
    college_id = _strict_int(request.GET.get("college"), "college", 1, 10 ** 9)
    if college_id is not None and college_id not in _college_ids():
        raise _ParamError("college 参数无效")
    material_type_id = _strict_int(request.GET.get("material_type"), "material_type", 1, 10 ** 9)
    if material_type_id is not None and not MaterialType.objects.filter(id=material_type_id).exists():
        raise _ParamError("material_type 参数无效")
    fmt = _normalize_file_type(request.GET.get("format") or "")

    ql = query.lower()
    rows_qs = Material.objects.filter(
        Q(title__icontains=query) | Q(teacher__icontains=query) | Q(description__icontains=query),
        review_status="approved",
    )
    from .plaza import _visible_course_ids
    visible_ids = _visible_course_ids(_get_user(request))
    if visible_ids is not None:
        rows_qs = rows_qs.filter(course_id__in=visible_ids)
    rows = list(rows_qs.select_related("course", "course__college", "material_type").only(
        "id", "title", "teacher", "description", "file_type",
        "download_count", "created_at",
        "course__id", "course__code", "course__name",
        "course__course_type", "course__college_id",
        "material_type__id", "material_type__name", "material_type__slug",
    ))

    # 最终命中确认（与 facets 同一口径）
    enriched = []
    for m in rows:
        matched = []
        if ql in (m.title or "").lower():
            matched.append("title")
        if ql in (m.teacher or "").lower():
            matched.append("teacher")
        if ql in (m.description or "").lower():
            matched.append("description")
        if matched:
            enriched.append((m, matched))
    keyword_total = len(enriched)

    def keep(m):
        if material_type_id is not None and m.material_type_id != material_type_id:
            return False
        if fmt and _normalize_file_type(m.file_type) != fmt:
            return False
        course = m.course
        if course_type and (course is None or course.course_type != course_type):
            return False
        if college_id is not None and (course is None or course.college_id != college_id):
            return False
        return True

    if material_type_id is not None or fmt or course_type or college_id is not None:
        enriched = [pair for pair in enriched if keep(pair[0])]
    total = len(enriched)
    # 页码超过末页时返回末页（前端负责 replace 修正 URL）
    total_pages = max(1, -(-total // page_size))
    if page > total_pages:
        page = total_pages

    # 排序（稳定多轮：相关度 → 上传时间倒序、ID 倒序）
    if sort == "latest":
        enriched.sort(key=lambda pair: pair[0].id, reverse=True)
        enriched.sort(key=lambda pair: pair[0].created_at, reverse=True)
    elif sort == "downloads":
        enriched.sort(key=lambda pair: (pair[0].created_at, pair[0].id), reverse=True)
        enriched.sort(key=lambda pair: pair[0].download_count, reverse=True)
    else:
        enriched.sort(key=lambda pair: pair[0].id, reverse=True)
        enriched.sort(key=lambda pair: pair[0].created_at, reverse=True)
        enriched.sort(key=lambda pair: _material_relevance_tier(pair[0], pair[1], ql))

    start = (page - 1) * page_size
    page_rows = enriched[start:start + page_size]

    tree_names = course_display_names({
        m.course_id for (m, _matched) in page_rows if m.course_id
    })

    items = []
    for m, matched in page_rows:
        course = m.course
        course_payload = None
        if course is not None:
            course_payload = {
                "id": course.id,
                "code": course.code or "",
                "name": tree_names.get(course.id) or course.name or "",
                "course_type": course.course_type,
                "college_id": course.college_id,
            }
        mtype = None
        if m.material_type is not None:
            mtype = {
                "id": m.material_type.id,
                "name": m.material_type.name,
                "slug": m.material_type.slug,
            }
        items.append({
            "id": m.id,
            "title": m.title,
            "course": course_payload,
            "material_type": mtype,
            "file_type": _normalize_file_type(m.file_type),
            "teacher": m.teacher or "",
            "snippet": _description_snippet(m.description, query) if "description" in matched else "",
            "matched_fields": matched,
            "created_at": _iso_time(m.created_at),
            "download_count": m.download_count,
        })

    # facets：关键词命中集合（未附加筛选）
    type_by_id = {}
    formats = set()
    facet_colleges = {}
    for m in rows:
        hit = (ql in (m.title or "").lower()
               or ql in (m.teacher or "").lower()
               or ql in (m.description or "").lower())
        if not hit:
            continue
        if m.material_type is not None:
            type_by_id[m.material_type.id] = {
                "id": m.material_type.id,
                "name": m.material_type.name,
                "slug": m.material_type.slug,
            }
        norm = _normalize_file_type(m.file_type)
        if norm:
            formats.add(norm)
        if m.course is not None and m.course.college_id is not None:
            facet_colleges[m.course.college_id] = m.course.college
    facets = {
        "material_types": [type_by_id[k] for k in sorted(type_by_id)],
        "file_types": sorted(formats),
        "colleges": [
            {"id": col.id, "name": col.short_name or col.name}
            for col in sorted(facet_colleges.values(), key=lambda c: c.id)
        ],
    }
    return keyword_total, total, page, items, facets


# ═══════════════════════════════════════════════════════════════
# 问答：v1 公开范围，计数与切页前完成最终命中确认
# ═══════════════════════════════════════════════════════════════

def _search_qa_v2(request, query, page, page_size):
    """返回 (keyword_total, total, page, items)。page 为收敛后的有效页码。"""
    sort = request.GET.get("sort") or "default"
    if sort not in QA_SORTS:
        raise _ParamError("sort 参数无效")
    tag_l1 = _strict_int(request.GET.get("tag_l1"), "tag_l1", 1, 10 ** 9)
    if tag_l1 is not None and not QaTag.objects.filter(id=tag_l1, level=1).exists():
        raise _ParamError("tag_l1 参数无效")
    tag_l2 = _strict_int(request.GET.get("tag_l2"), "tag_l2", 1, 10 ** 9)
    if tag_l2 is not None and not QaTag.objects.filter(id=tag_l2, level=2).exists():
        raise _ParamError("tag_l2 参数无效")

    ql = query.lower()
    qs = QaQuestion.objects.filter(status=QaQuestion.Status.PUBLISHED).select_related(
        "author", "tag_l1", "tag_l2")
    if tag_l1:
        qs = qs.filter(tag_l1_id=tag_l1)
    if tag_l2:
        qs = qs.filter(tag_l2_id=tag_l2)
    qs = qs.filter(
        Q(title__icontains=query)
        | Q(content__icontains=query)
        | Q(answers__status=QaAnswer.Status.PUBLISHED, answers__content__icontains=query),
    ).distinct()
    candidates = list(qs)
    candidate_by_id = {q.id: q for q in candidates}

    # 最终命中确认：标题明文 / 正文去标签明文 / 回答去标签明文
    confirmed = []
    need_answer_ids = []
    for q in candidates:
        if ql in (q.title or "").lower() or ql in _strip_html(q.content).lower():
            confirmed.append((q, None))
        else:
            need_answer_ids.append(q.id)

    # 回答命中批量确认 + 批量择优（已采纳 → 较新 → ID 大），避免每条结果再发 SQL
    best_answer = {}
    if need_answer_ids:
        for a in QaAnswer.objects.filter(
            question_id__in=need_answer_ids,
            status=QaAnswer.Status.PUBLISHED,
            content__icontains=query,
        ).only("id", "question_id", "content", "is_accepted", "created_at").order_by("id"):
            if ql not in _strip_html(a.content).lower():
                continue
            current = best_answer.get(a.question_id)
            if current is None or (a.is_accepted, a.created_at, a.id) > (
                    current.is_accepted, current.created_at, current.id):
                best_answer[a.question_id] = a
    for q_id in need_answer_ids:
        answer = best_answer.get(q_id)
        if answer is not None:
            confirmed.append((candidate_by_id[q_id], answer))

    # 排序：默认置顶优先、时间倒序；最新仅时间倒序（并列按 ID）
    if sort == "latest":
        confirmed.sort(key=lambda pair: pair[0].id, reverse=True)
        confirmed.sort(key=lambda pair: pair[0].created_at, reverse=True)
    else:
        confirmed.sort(key=lambda pair: pair[0].id, reverse=True)
        confirmed.sort(key=lambda pair: pair[0].created_at, reverse=True)
        confirmed.sort(key=lambda pair: not pair[0].is_pinned)

    total = len(confirmed)
    # 页码超过末页时返回末页（前端负责 replace 修正 URL）
    total_pages = max(1, -(-total // page_size))
    if page > total_pages:
        page = total_pages
    start = (page - 1) * page_size
    page_rows = confirmed[start:start + page_size]

    items = []
    for q, answer in page_rows:
        items.append({
            "id": q.id,
            "title": q.title,
            "hit": "answer" if answer is not None else "question",
            "author": _nickname(q.author),
            "tag_l1": q.tag_l1.name if q.tag_l1_id else "",
            "tag_l1_id": q.tag_l1_id,
            "tag_l2": q.tag_l2.name if q.tag_l2_id else "",
            "tag_l2_id": q.tag_l2_id,
            "created_at": _iso_time(q.created_at),
            "snippet": _qa_snippet(q.content, query) if answer is None
                else _qa_snippet(answer.content, query),
            "answer_id": answer.id if answer is not None else None,
        })
    return total, total, page, items


# ═══════════════════════════════════════════════════════════════
# v2 入口（由 courses.api_search / qa_public.api_qa_search 按版本分发）
# ═══════════════════════════════════════════════════════════════

def api_search_v2(request):
    """GET /api/search/?v=2&type=course|material — 独立搜索页课程/资料组。"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    try:
        query = _clean_keyword(request)
        type_ = request.GET.get("type") or "course"
        if type_ not in ("course", "material"):
            raise _ParamError("type 参数无效")
        sort = request.GET.get("sort") or "relevance"
        if sort not in (COURSE_SORTS if type_ == "course" else MATERIAL_SORTS):
            raise _ParamError("sort 参数无效")
        page = _strict_int(request.GET.get("page"), "page", 1, 10 ** 9, default=1)
        page_size = _strict_int(
            request.GET.get("page_size"), "page_size", 1, 50,
            default=_COURSE_PAGE_SIZE if type_ == "course" else _MATERIAL_PAGE_SIZE)
        if not query:
            return _v2_zero(query, type_, page_size, sort)
        keyword_total, total, page, items, facets = (
            _search_courses_v2(request, query, page, page_size) if type_ == "course"
            else _search_materials_v2(request, query, page, page_size))
        return _v2_envelope(query, type_, keyword_total, total, page, page_size,
                            sort, items, facets)
    except _ParamError as exc:
        return _err(str(exc), 400)


def api_qa_search_v2(request):
    """GET /api/qa/search/?v=2 — 独立搜索页问答组。"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    try:
        query = _clean_keyword(request)
        page = _strict_int(request.GET.get("page"), "page", 1, 10 ** 9, default=1)
        page_size = _strict_int(request.GET.get("pageSize"), "pageSize", 1, 50,
                                default=_QA_PAGE_SIZE)
        sort = request.GET.get("sort") or "default"
        if sort not in QA_SORTS:
            raise _ParamError("sort 参数无效")
        if not query:
            return _v2_zero(query, "qa", page_size, sort)
        keyword_total, total, page, items = _search_qa_v2(request, query, page, page_size)
        return _v2_envelope(query, "qa", keyword_total, total, page, page_size, sort,
                            items, {})
    except _ParamError as exc:
        return _err(str(exc), 400)
