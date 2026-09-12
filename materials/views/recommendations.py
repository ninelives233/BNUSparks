"""可解释资料推荐。

推荐先召回与用户课程/收藏/近期可靠行为相关的课程，再合并少量热门候选；
所有分数都来自现有课程、收藏、预览和下载记录，不引入新的埋点或模型服务。
"""

import math
from datetime import timedelta

from django.db.models import Count, F, Q
from django.utils import timezone

from .utils import _ok, _get_user, _get_or_create_profile
from ..models import (
    Course, CourseCategory, CourseFavorite, DeletionRecord, DownloadRecord, Favorite,
    Material, UserTimetable,
)


RECOMMENDATION_CONFIG = {
    "course_weights": {"timetable": 1.00, "favorite": 0.85, "browse": 0.65, "major": 0.35, "fallback": 0.10},
    "score_weights": {"relevance": 0.55, "quality": 0.20, "freshness": 0.15, "type_preference": 0.10},
    "freshness_half_life_days": 60,
    "browse_window_days": 30,
    "type_preference_min_actions": 5,
    "desktop_limit": 4,
    "mobile_limit": 3,
    "page_limit": 13,
    "candidate_limit": 500,
}


def _test_account_q():
    """仅排除项目明确使用的脚本账号域名，避免凭昵称猜测真实用户。"""
    return Q(uploader__email__iendswith="@test.com")


def _root_id(course):
    """返回合并链的主课程 ID；当前数据通常是一层，仍保留环保护。"""
    seen = set()
    while course is not None and course.merged_into_id and course.id not in seen:
        seen.add(course.id)
        course = course.merged_into
    return course.id if course is not None else None


def _root_course_ids(courses):
    roots = set()
    for course in courses:
        root = _root_id(course)
        if root:
            roots.add(root)
    return roots


def _course_filter(root_ids):
    """按主课程或其别名召回，避免只匹配一条 Course 行。"""
    return Q(course_id__in=root_ids) | Q(course__merged_into_id__in=root_ids)


def _course_catalog():
    """一次性加载课程代码和合并关系，供课表/课程树语义复用。"""
    return list(Course.objects.select_related("merged_into").only("id", "code", "merged_into_id"))


def _resolve_course_codes(codes, courses):
    """按精确代码优先、课程树已有前缀语义兜底解析课表代码。"""
    resolved = []
    for raw in codes:
        code = str(raw or "").strip()
        if not code:
            continue
        exact = [course for course in courses if course.code == code]
        matches = exact
        if not matches:
            prefix = code.replace("*", "").replace("-", "")
            if prefix:
                matches = [course for course in courses if course.code.startswith(prefix)]
        resolved.extend(matches)
    return resolved


def _category_course_roots(profile, courses):
    """从明确的学院+专业身份递归取课程树节点，不按学院名称猜专业。"""
    if not profile.identity_college or not profile.identity_major:
        return set()
    categories = list(CourseCategory.objects.only("id", "parent_id", "name", "is_divider", "course_id", "course_text"))
    by_parent = {}
    for category in categories:
        by_parent.setdefault(category.parent_id, []).append(category)
    major = next((category for category in categories
                  if category.name == profile.identity_major
                  and not category.is_divider
                  and any(parent.id == category.parent_id and parent.name == profile.identity_college
                          for parent in categories)), None)
    if not major:
        return set()

    roots = set()
    pending = [major]
    visited = set()
    while pending:
        category = pending.pop()
        if category.id in visited:
            continue
        visited.add(category.id)
        if category.course_id:
            course = next((item for item in courses if item.id == category.course_id), None)
            if course:
                roots.add(_root_id(course))
        if category.course_text:
            prefix = category.course_text.replace("*", "").replace("-", "")
            if prefix:
                roots.update(_root_id(course) for course in courses if course.code.startswith(prefix))
        pending.extend(by_parent.get(category.id, []))
    return {root for root in roots if root}


def _course_signals(user, now):
    """返回主课程相关度、理由、信号名称和是否存在个性化信号。"""
    courses = _course_catalog()
    source_by_course = {}
    signal_names = []

    def add_signal(root_id, relevance, reason):
        if not root_id:
            return
        current = source_by_course.get(root_id)
        if not current or current[0] < relevance:
            source_by_course[root_id] = (relevance, reason)

    timetable_codes = set()
    timetable = UserTimetable.objects.filter(user=user).values_list("data", flat=True).first()
    if isinstance(timetable, dict):
        for item in timetable.get("courses", []):
            if isinstance(item, dict) and item.get("code"):
                timetable_codes.add(str(item["code"]).strip())
    timetable_roots = _root_course_ids(_resolve_course_codes(timetable_codes, courses))
    if timetable_roots:
        signal_names.append("课程表")
        for root_id in timetable_roots:
            add_signal(root_id, RECOMMENDATION_CONFIG["course_weights"]["timetable"], "来自你的课程表。")

    favored_courses = list(CourseFavorite.objects.filter(user=user).select_related("course"))
    favorite_roots = _root_course_ids([item.course for item in favored_courses])
    if favorite_roots:
        signal_names.append("收藏课程")
        for root_id in favorite_roots:
            add_signal(root_id, RECOMMENDATION_CONFIG["course_weights"]["favorite"], "来自你收藏的课程。")

    browse_boundary = now - timedelta(days=RECOMMENDATION_CONFIG["browse_window_days"])
    recent_browsed = DownloadRecord.objects.filter(
        user=user,
        activity_type=DownloadRecord.ActivityType.PREVIEW,
        created_at__gte=browse_boundary,
        material__course__isnull=False,
    ).order_by("-created_at", "-id").values_list(
        "material__course_id", "material__course__merged_into_id", "created_at",
    )[:50]
    browsed_roots = set()
    for course_id, merged_into_id, created_at in recent_browsed:
        root_id = merged_into_id or course_id
        if root_id in browsed_roots:
            continue
        browsed_roots.add(root_id)
        age_days = max(0.0, (now - created_at).total_seconds() / 86400) if created_at else 30.0
        decay = 0.5 ** (age_days / RECOMMENDATION_CONFIG["browse_window_days"])
        add_signal(
            root_id,
            max(0.10, RECOMMENDATION_CONFIG["course_weights"]["browse"] * decay),
            "来自你最近浏览的课程。",
        )
    if browsed_roots:
        signal_names.append("最近浏览")

    profile = _get_or_create_profile(user)
    major_roots = _category_course_roots(profile, courses)
    if major_roots:
        signal_names.append("专业相关")
        for root_id in major_roots:
            add_signal(root_id, RECOMMENDATION_CONFIG["course_weights"]["major"], "与你的专业相关。")

    return source_by_course, list(dict.fromkeys(signal_names))


def _interaction_counts(material_ids):
    """统计推荐质量使用的有效互动，不改公开累计数。"""
    if not material_ids:
        return {}, {}
    excluded_users = Q(user__email__iendswith="@test.com")
    valid_downloads = DownloadRecord.objects.filter(
        material_id__in=material_ids,
        activity_type__in=(DownloadRecord.ActivityType.LEGACY, DownloadRecord.ActivityType.DOWNLOAD),
    ).exclude(excluded_users).exclude(user_id=F("material__uploader_id"))
    download_counts = {
        row["material_id"]: row["count"]
        for row in valid_downloads.values("material_id").annotate(count=Count("id"))
    }
    valid_favorites = Favorite.objects.filter(material_id__in=material_ids).exclude(excluded_users).exclude(
        user_id=F("material__uploader_id")
    )
    favorite_counts = {
        row["material_id"]: row["count"]
        for row in valid_favorites.values("material_id").annotate(count=Count("id"))
    }
    return download_counts, favorite_counts


def _quality_scores(materials, download_counts, favorite_counts):
    """log 压缩后按候选池基准归一化，并对低样本使用 0.5 中性先验。"""
    max_download = max((math.log1p(download_counts.get(m.id, 0)) for m in materials), default=0.0)
    max_favorite = max((math.log1p(favorite_counts.get(m.id, 0)) for m in materials), default=0.0)
    result = {}
    for material in materials:
        downloads = math.log1p(download_counts.get(material.id, 0))
        favorites = math.log1p(favorite_counts.get(material.id, 0))
        raw = 0.5 if not max_download and not max_favorite else (
            0.7 * (downloads / max_download if max_download else 0.0)
            + 0.3 * (favorites / max_favorite if max_favorite else 0.0)
        )
        evidence = download_counts.get(material.id, 0) + favorite_counts.get(material.id, 0)
        evidence_weight = min(1.0, evidence / 5.0)
        result[material.id] = 0.5 * (1.0 - evidence_weight) + raw * evidence_weight
    return result


def _type_preference_scores(user):
    """有至少五份不同资料的可靠行为时才启用类型偏好，否则返回 None。"""
    download_ids = set(DownloadRecord.objects.filter(
        user=user,
        activity_type__in=(DownloadRecord.ActivityType.LEGACY, DownloadRecord.ActivityType.DOWNLOAD),
        material_id__isnull=False,
    ).values_list("material_id", flat=True))
    favorite_ids = set(Favorite.objects.filter(user=user).values_list("material_id", flat=True))
    material_ids = download_ids | favorite_ids
    if len(material_ids) < RECOMMENDATION_CONFIG["type_preference_min_actions"]:
        return None
    type_counts = {}
    for type_id, file_type in Material.objects.filter(id__in=material_ids).values_list("material_type_id", "file_type"):
        key = type_id or file_type or "other"
        type_counts[key] = type_counts.get(key, 0) + 1
    if not type_counts:
        return None
    maximum = max(type_counts.values())
    return {key: 0.5 + 0.5 * (count / maximum) for key, count in type_counts.items()}


def _freshness(created_at, now):
    if not created_at:
        return 0.0
    age_days = max(0.0, (now - created_at).total_seconds() / 86400)
    return 0.5 ** (age_days / RECOMMENDATION_CONFIG["freshness_half_life_days"])


def _serialize_candidate(material, score, relevance, reason, is_exploration, is_favorited):
    course = material.course
    return {
        "id": material.id,
        "title": material.title,
        "course_code": course.code if course else "",
        "course_name": course.name if course else "",
        "course_type": course.course_type if course else "",
        "file_type": material.material_type.name if material.material_type else (material.file_type or "其他"),
        "teacher": material.teacher or "",
        "description": material.description or "",
        "created_at": material.created_at.strftime("%Y-%m-%d") if material.created_at else "",
        "download_count": material.download_count or 0,
        "favorite_count": material.favorite_count or 0,
        "is_favorited": is_favorited,
        "score": round(score, 6),
        "relevance": round(relevance, 6),
        "reason": reason,
        "is_exploration": is_exploration,
    }


def api_recommendations(request):
    """GET /api/recommendations/ — 返回结构化理由，并支持刷新时切换候选窗口。"""
    user = _get_user(request)
    requested_limit = request.GET.get("limit", "4")
    try:
        limit = max(1, min(int(requested_limit), RECOMMENDATION_CONFIG["page_limit"]))
    except (TypeError, ValueError):
        limit = RECOMMENDATION_CONFIG["desktop_limit"]
    try:
        refresh_index = max(0, int(request.GET.get("refresh", "0")))
    except (TypeError, ValueError):
        refresh_index = 0

    now = timezone.now()
    source_by_course, signal_names = _course_signals(user, now) if user else ({}, [])
    ghost_ids = DeletionRecord.objects.values_list("material_id", flat=True)
    base = Material.objects.filter(
        review_status="approved", course__isnull=False,
    ).exclude(id__in=ghost_ids).exclude(_test_account_q()).select_related(
        "course", "course__merged_into", "material_type",
    ).annotate(favorite_count=Count("favorited_by", distinct=True))

    if source_by_course:
        related_filter = _course_filter(set(source_by_course))
        related = list(base.filter(related_filter).order_by("-created_at", "id")[:400])
        fallback_limit = max(0, RECOMMENDATION_CONFIG["candidate_limit"] - len(related))
        fallback = list(base.exclude(related_filter).order_by("-download_count", "-created_at", "id")[:fallback_limit])
        candidates = related + fallback
    else:
        candidates = list(base.order_by("-download_count", "-created_at", "id")[:RECOMMENDATION_CONFIG["candidate_limit"]])

    if not candidates:
        return _ok({
            "items": [], "mode": "empty", "signals": [], "has_unacquired_related": False,
            "related_exhausted": False, "type_preference_applied": False, "config": RECOMMENDATION_CONFIG,
        })

    acquired_ids = set()
    favorite_ids = set()
    type_preferences = None
    if user:
        favorite_ids = set(Favorite.objects.filter(user=user).values_list("material_id", flat=True))
        acquired_ids |= favorite_ids
        acquired_ids |= set(DownloadRecord.objects.filter(
            user=user,
            activity_type__in=(DownloadRecord.ActivityType.LEGACY, DownloadRecord.ActivityType.DOWNLOAD),
            material_id__isnull=False,
        ).values_list("material_id", flat=True))
        type_preferences = _type_preference_scores(user)

    download_counts, favorite_counts = _interaction_counts([material.id for material in candidates])
    quality = _quality_scores(candidates, download_counts, favorite_counts)
    scored = []
    for material in candidates:
        root_id = _root_id(material.course)
        relevance, reason = source_by_course.get(root_id, (
            RECOMMENDATION_CONFIG["course_weights"]["fallback"], "热门资料。"
        ))
        if user and material.id in acquired_ids:
            continue
        type_key = material.material_type_id or material.file_type or "other"
        type_preference = type_preferences.get(type_key, 0.5) if type_preferences else 0.5
        fresh = _freshness(material.created_at, now)
        is_exploration = bool(
            user and relevance >= 0.85 and
            material.created_at and (now - material.created_at) <= timedelta(days=30) and
            download_counts.get(material.id, 0) + favorite_counts.get(material.id, 0) <= 2
        )
        score = (
            RECOMMENDATION_CONFIG["score_weights"]["relevance"] * relevance
            + RECOMMENDATION_CONFIG["score_weights"]["quality"] * quality[material.id]
            + RECOMMENDATION_CONFIG["score_weights"]["freshness"] * fresh
            + RECOMMENDATION_CONFIG["score_weights"]["type_preference"] * type_preference
        )
        scored.append((score, material, relevance, reason, is_exploration))

    scored.sort(key=lambda row: (
        -row[0], -row[2],
        -(row[1].created_at.timestamp() if row[1].created_at else 0), row[1].id,
    ))
    if user and len(scored) > 2:
        explore = next((row for row in scored if row[4]), None)
        if explore and explore is not scored[min(2, len(scored) - 1)]:
            scored.remove(explore)
            scored.insert(min(2, len(scored)), explore)

    has_unacquired_related = any(row[2] >= 0.35 for row in scored)
    # 默认请求保持稳定排序；点击刷新时从排序后的候选池切换起点，保留推荐分数
    # 的总体优先级，同时让有足够候选的页面真正展示下一批资料。
    if refresh_index and len(scored) > 1:
        offset = refresh_index % len(scored)
        scored = scored[offset:] + scored[:offset]
    selected = []
    course_counts = {}
    for row in scored:
        root_id = _root_id(row[1].course)
        if course_counts.get(root_id, 0) >= 2:
            continue
        selected.append(row)
        course_counts[root_id] = course_counts.get(root_id, 0) + 1
        if len(selected) >= limit:
            break

    mode = "personalized" if source_by_course else "popular"
    items = [_serialize_candidate(material, score, relevance, reason, is_exploration, material.id in favorite_ids)
             for score, material, relevance, reason, is_exploration in selected]
    return _ok({
        "items": items,
        "mode": mode,
        "signals": signal_names,
        "has_unacquired_related": has_unacquired_related,
        "related_exhausted": bool(source_by_course) and not has_unacquired_related,
        "type_preference_applied": bool(type_preferences),
        "config": RECOMMENDATION_CONFIG,
    })
