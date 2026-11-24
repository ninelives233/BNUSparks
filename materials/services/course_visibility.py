"""Apply education-level navigation boundaries to the shared course tree."""

import hashlib

from django.core.cache import cache


SPARSE_MAJOR_COURSE_THRESHOLD = 10


def normalized_course_code(value):
    return str(value or "").strip().upper().replace("*", "").replace("-", "")


def follow_merge(course_id, courses):
    seen = set()
    while course_id and course_id in courses and course_id not in seen:
        seen.add(course_id)
        merged_into = courses[course_id]["merged_into_id"]
        if not merged_into:
            break
        course_id = merged_into
    return course_id


def scoped_course_ids(cat_id, catalog):
    """分类子树内的课程 ID，展开同码共享与合并链；空范围保持为空。"""
    cats = catalog["cats"]
    children = catalog["children"]
    courses = catalog["courses"]
    selected = set()
    prefixes = []
    exact_patterns = []
    stack = [cat_id]
    while stack:
        node_id = stack.pop()
        cat = cats.get(node_id)
        if cat is None:
            continue
        if cat["course_id"]:
            selected.add(cat["course_id"])
        raw_pattern = (cat["course_text"] or "").strip()
        pattern = raw_pattern.replace("*", "").replace("-", "")
        if pattern:
            prefixes.append(pattern)
        if raw_pattern:
            exact_patterns.append(raw_pattern)
        stack.extend(children.get(node_id, []))

    if prefixes or exact_patterns:
        for course_id, course in courses.items():
            code = course["code"] or ""
            if any(code.startswith(pattern) for pattern in prefixes) or code in exact_patterns:
                selected.add(course_id)

    normalized = {
        normalized_course_code(courses[cid]["code"]): cid
        for cid in selected
        if cid in courses
    }
    if normalized:
        for norm, course_ids in catalog["normalized_courses"].items():
            if norm in normalized:
                selected.update(course_ids)

    changed = True
    while changed:
        changed = False
        for course_id in list(selected):
            merged_into = courses.get(course_id, {}).get("merged_into_id")
            if merged_into and merged_into not in selected:
                selected.add(merged_into)
                changed = True
        for course_id, course in courses.items():
            if course["merged_into_id"] in selected and course_id not in selected:
                selected.add(course_id)
                changed = True
    return {cid for cid in selected if cid in courses}


def _has_graduate_directory(profile):
    """当前学院是否已有对应研究生层次的专业课入口。"""
    if not profile or not profile.identity_college or profile.identity_education not in ("硕士", "博士"):
        return False
    from ..models import CourseCategory, get_course_tree_version
    scope = f"{profile.identity_college}\0{profile.identity_education}"
    key = f"course_directory_{get_course_tree_version()}_{hashlib.sha256(scope.encode()).hexdigest()}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    available = CourseCategory.objects.filter(
        education_level__in=(profile.identity_education, "研究生"),
        parent__name=profile.identity_college,
        parent__parent__name="专业课", parent__parent__parent__isnull=True,
    ).exists()
    cache.set(key, available, 600)
    return available


def is_peeking_undergrad(user, request=None):
    """Return True when a graduate user explicitly requests the undergrad view."""
    if user is None or request is None:
        return False
    profile = getattr(user, "profile", None)
    level = getattr(profile, "identity_education", "")
    if level not in ("硕士", "博士"):
        return False
    params = getattr(request, "GET", None)
    if not params:
        return False
    return str(params.get("edu") or "").strip().lower() in ("undergrad", "本科")


def education_for_user(user, request=None):
    """未开通本院硕士目录或主动临时浏览本科时，按本科范围浏览；不改变用户身份。"""
    if user is None:
        return "本科"
    if is_peeking_undergrad(user, request):
        return "本科"
    profile = getattr(user, "profile", None)
    level = getattr(profile, "identity_education", "")
    if level == "硕士" and not _has_graduate_directory(profile):
        return "本科"
    return level if level in ("硕士", "博士") else "本科"


def general_root_label(education):
    return "公共课" if education in ("硕士", "博士") else "通识课"


def _undergrad_major_material_course_counts():
    """统计学院课程树各专业子树内含已审核资料的课程数，按课程树版本缓存。"""
    from ..models import Course, CourseCategory, Material, get_course_tree_version

    key = f"undergrad_major_material_courses_{get_course_tree_version()}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    raw_categories = list(CourseCategory.objects.values(
        "id", "parent_id", "name", "order", "course_id", "course_text", "is_divider", "education_level",
    ))
    if any(row["education_level"] for row in raw_categories):
        allowed = visible_category_ids(raw_categories, "本科")
    else:
        allowed = {row["id"] for row in raw_categories}

    cats = {}
    children = {}
    for row in raw_categories:
        if row["id"] not in allowed:
            continue
        cats[row["id"]] = row
        if not row["is_divider"]:
            children.setdefault(row["parent_id"], []).append(row["id"])

    major_roots = [
        cid for cid in children.get(None, [])
        if cats[cid]["name"] == "专业课"
    ]
    if len(major_roots) != 1:
        cache.set(key, {}, 600)
        return {}
    major_root_id = major_roots[0]

    colleges_by_name = {}
    for college_id in children.get(major_root_id, []):
        colleges_by_name.setdefault(cats[college_id]["name"], []).append(college_id)

    courses = {}
    normalized_courses = {}
    for row in Course.objects.values("id", "code", "merged_into_id"):
        courses[row["id"]] = row
        norm = normalized_course_code(row["code"])
        if norm:
            normalized_courses.setdefault(norm, []).append(row["id"])

    approved_course_ids = set(
        Material.objects.filter(is_approved=True)
        .exclude(review_status="rejected")
        .exclude(course_id__isnull=True)
        .values_list("course_id", flat=True)
        .distinct()
    )

    catalog = {
        "cats": cats,
        "children": children,
        "courses": courses,
        "normalized_courses": normalized_courses,
    }

    counts = {}
    for college_name, college_ids in colleges_by_name.items():
        if len(college_ids) != 1:
            continue
        college_id = college_ids[0]
        majors_by_name = {}
        for child_id in children.get(college_id, []):
            child = cats[child_id]
            if child["course_id"] or child["course_text"]:
                continue
            majors_by_name.setdefault(child["name"], []).append(child_id)
        for major_name, major_ids in majors_by_name.items():
            if len(major_ids) != 1:
                continue
            scoped_ids = scoped_course_ids(major_ids[0], catalog)
            canonical_courses = set()
            for course_id in scoped_ids & approved_course_ids:
                primary_id = follow_merge(course_id, courses)
                norm = normalized_course_code(courses.get(primary_id, {}).get("code"))
                canonical_courses.add(norm or primary_id)
            counts[f"{college_name}\0{major_name}"] = len(canonical_courses)

    cache.set(key, counts, 600)
    return counts


def _is_sparse_tree_major(profile):
    if not profile or not profile.identity_college or not profile.identity_major:
        return False
    counts = _undergrad_major_material_course_counts()
    count = counts.get(f"{profile.identity_college}\0{profile.identity_major}")
    if count is None:
        return False
    return count < SPARSE_MAJOR_COURSE_THRESHOLD


def browse_mode_for_profile(profile):
    """Default to plaza for all graduates and sparse college-tree majors."""
    if not profile:
        return "directory"
    if profile.material_browse_mode:
        return profile.material_browse_mode
    if profile.identity_education in ("硕士", "博士"):
        return "plaza"
    if _is_sparse_tree_major(profile):
        return "plaza"
    return "directory"


def visible_category_ids(categories, education):
    """Legacy unmarked directories at the college/general boundary are undergraduate.

    Marked entry nodes apply to their entire subtree. Other colleges remain visible
    to graduate users only when they have a matching entry.
    """
    categories = list(categories)
    cats = {row["id"]: row for row in categories}
    children = {}
    for row in categories:
        children.setdefault(row["parent_id"], []).append(row["id"])
    visible = set()

    def walk(cid, boundary=False):
        node = cats[cid]
        marked = node.get("education_level") or ""
        if marked:
            if marked != education and not (marked == "研究生" and education in ("硕士", "博士")):
                return False
        elif boundary and education != "本科":
            return False
        visible.add(cid)
        is_general_root = node["parent_id"] is None and node["name"] == "通识课"
        parent = cats.get(node["parent_id"])
        is_college = bool(parent and parent["parent_id"] is None and parent["name"] == "专业课")
        kept = False
        for child_id in children.get(cid, []):
            kept = walk(child_id, boundary=is_general_root or is_college) or kept
        if is_college and education != "本科" and not kept:
            visible.remove(cid)
            return False
        return True

    for root_id in children.get(None, []):
        walk(root_id)
    return visible
