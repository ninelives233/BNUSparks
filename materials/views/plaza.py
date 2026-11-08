"""资料广场 API：按目录范围分页浏览已审核资料，以及广场/面包屑共用的课程导航。

范围解析沿用课程目录既有的三种语义：叶子 course、course_text 前缀/通配、
同码共享与同名合并链。广场不重新定义“本专业”之类身份推断，也不读取
course.college 充当范围；分类 ID 只是筛选条件。
"""

import uuid
from pathlib import Path

from django.core.cache import cache
from django.db.models import Count, Q

from ..models import (
    PLAZA_INDEX_VERSION_KEY, Course, CourseCategory, Favorite, Material,
    MaterialType, UserProfile,
)
from .utils import _err, _get_or_create_profile, _get_user, _ok


PAGE_SIZE = 24
SORTS = {"latest", "downloads", "favorites"}

_catalog_cache = {"token": None, "data": None}


def _index_token():
    """目录索引版本。缓存被清空时生成新令牌，避免进程内旧快照跨测试复用。"""
    token = cache.get(PLAZA_INDEX_VERSION_KEY)
    if not token:
        token = uuid.uuid4().hex
        cache.add(PLAZA_INDEX_VERSION_KEY, token, timeout=None)
        token = cache.get(PLAZA_INDEX_VERSION_KEY) or token
    return token


def _normalized_course_code(value):
    return str(value or "").strip().upper().replace("*", "").replace("-", "")


def _build_catalog():
    categories = list(CourseCategory.objects.values(
        "id", "parent_id", "name", "order", "course_id", "course_text", "is_divider",
    ))
    cats = {row["id"]: row for row in categories}
    children = {}
    for row in categories:
        if row["is_divider"]:
            continue
        children.setdefault(row["parent_id"], []).append(row["id"])
    for ids in children.values():
        ids.sort(key=lambda cid: (cats[cid]["order"], cid))

    courses = {}
    normalized_courses = {}
    for row in Course.objects.values(
        "id", "code", "name", "merged_into_id", "course_type",
    ):
        courses[row["id"]] = row
        normalized = _normalized_course_code(row["code"])
        if normalized:
            normalized_courses.setdefault(normalized, []).append(row["id"])

    roots = children.get(None, [])

    # 课程展示名与目录一致：同一课程挂在多个叶子时取树序第一个 FK 叶子。
    leaf_map = {}

    def walk(cat_id):
        cat = cats[cat_id]
        if not children.get(cat_id) and cat["course_id"]:
            leaf_map.setdefault(cat["course_id"], {
                "name": cat["name"],
                "category_id": cat_id,
            })
        for child_id in children.get(cat_id, []):
            walk(child_id)

    for root_id in roots:
        walk(root_id)

    return {
        "cats": cats,
        "children": children,
        "roots": roots,
        "courses": courses,
        "normalized_courses": normalized_courses,
        "leaf_map": leaf_map,
    }


def _catalog():
    token = _index_token()
    if _catalog_cache["token"] != token:
        _catalog_cache["data"] = _build_catalog()
        _catalog_cache["token"] = token
    return _catalog_cache["data"]


def _follow_merge(course_id, courses):
    seen = set()
    while course_id and course_id in courses and course_id not in seen:
        seen.add(course_id)
        merged_into = courses[course_id]["merged_into_id"]
        if not merged_into:
            break
        course_id = merged_into
    return course_id


def _root_type(cat, cats):
    node = cat
    while node["parent_id"]:
        node = cats.get(node["parent_id"])
        if node is None:
            break
    return node["name"] if node else ""


def _is_course_node(cat, catalog):
    """目录里按既有解析口径判断具体课程叶子。

    FK 叶子与 course_text 叶子都按课程处理；空分类即使没有 children 仍是目录。
    """
    if catalog["children"].get(cat["id"]):
        return False
    return bool(cat["course_id"] or cat["course_text"])


def _auto_skip(cat_id, catalog):
    """只有一个下级且该下级仍是文件夹时继续深入；课程、分叉、空目录停止。"""
    cats = catalog["cats"]
    children = catalog["children"]
    while True:
        kids = children.get(cat_id, [])
        if len(kids) != 1:
            return cat_id
        child = cats[kids[0]]
        if not children.get(child["id"]):
            return cat_id
        cat_id = child["id"]


def _default_category_id(course_type, user, catalog):
    cats = catalog["cats"]
    children = catalog["children"]
    wanted_root = "专业课" if course_type == "major" else "通识课"
    root_id = next(
        (rid for rid in catalog["roots"] if cats[rid]["name"] == wanted_root),
        None,
    )
    if root_id is None:
        return None
    if course_type != "major" or user is None:
        return root_id

    profile = _get_or_create_profile(user)
    if not profile.identity_college:
        return root_id
    college_matches = [
        cid for cid in children.get(root_id, [])
        if cats[cid]["name"] == profile.identity_college
    ]
    if len(college_matches) != 1:
        return root_id
    college_id = college_matches[0]
    if profile.identity_education != UserProfile.EducationLevel.UNDERGRADUATE:
        return college_id
    if not profile.identity_major:
        return college_id
    major_matches = [
        cid for cid in children.get(college_id, [])
        if cats[cid]["name"] == profile.identity_major
    ]
    return major_matches[0] if len(major_matches) == 1 else college_id


def _scoped_course_ids(cat_id, catalog):
    """分类子树内的课程 ID，展开同码共享与合并链；空范围保持为空。"""
    cats = catalog["cats"]
    children = catalog["children"]
    courses = catalog["courses"]
    selected = set()
    prefixes = []
    stack = [cat_id]
    while stack:
        node_id = stack.pop()
        cat = cats.get(node_id)
        if cat is None:
            continue
        if cat["course_id"]:
            selected.add(cat["course_id"])
        pattern = (cat["course_text"] or "").replace("*", "").replace("-", "")
        if pattern:
            prefixes.append(pattern)
        stack.extend(children.get(node_id, []))

    if prefixes:
        for course_id, course in courses.items():
            code = course["code"] or ""
            if any(code.startswith(pattern) for pattern in prefixes):
                selected.add(course_id)

    normalized = {
        _normalized_course_code(courses[cid]["code"]): cid
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


def _parse_page(value):
    try:
        page = int(value)
    except (TypeError, ValueError):
        return 1
    return max(1, page)


def _display_course(material, catalog):
    courses = catalog["courses"]
    leaf_map = catalog["leaf_map"]
    primary_id = _follow_merge(material.course_id, courses)
    leaf = leaf_map.get(primary_id) or leaf_map.get(material.course_id)
    fallback = courses.get(primary_id) or courses.get(material.course_id) or {}
    return {
        "course_name": (leaf or {}).get("name") or fallback.get("name") or "",
        "course_category_id": (leaf or {}).get("category_id"),
    }


def _serialize_item(material, catalog, favorite_ids):
    course = _display_course(material, catalog)
    file_format = (material.file_type or Path(material.file_name or "").suffix.lstrip(".")).lower()
    uploader_profile = getattr(material.uploader, "profile", None) if material.uploader else None
    return {
        "id": material.id,
        "title": material.title,
        "description": material.description or "",
        "teacher": material.teacher or "",
        "material_type_id": material.material_type_id,
        "material_type": material.material_type.name if material.material_type else (material.file_type or "其他"),
        "format": file_format,
        "course_name": course["course_name"],
        "course_code": material.course.code if material.course_id else "",
        "course_category_id": course["course_category_id"],
        "uploader": (material.uploader.first_name if material.uploader else material.uploader_name) or "匿名",
        "uploader_id": material.uploader_id or 0,
        "uploader_avatar": uploader_profile.avatar.url if uploader_profile and uploader_profile.avatar else "",
        "created_at": material.created_at.strftime("%Y-%m-%d") if material.created_at else "",
        "download_count": material.download_count or 0,
        "favorite_count": material.favorite_count or 0,
        "is_favorited": material.id in favorite_ids,
        "is_pinned": bool(material.is_pinned),
    }


def api_plaza_materials(request):
    """GET /api/materials/ — 当前目录范围的已审核资料列表。"""
    category_id = request.GET.get("category_id")
    if not category_id:
        return _err("缺少目录范围", 400)
    try:
        category_id = int(category_id)
    except (TypeError, ValueError):
        return _err("目录范围无效", 400)

    catalog = _catalog()
    category = catalog["cats"].get(category_id)
    if category is None or category["is_divider"]:
        return _err("目录不存在", 404)

    course_ids = _scoped_course_ids(category_id, catalog)
    user = _get_user(request)

    favorites_only = request.GET.get("favorites") in ("1", "true", "yes")
    if favorites_only and user is None:
        return _err("请先登录", 401)
    if favorites_only and not course_ids:
        return _ok({
            "total": 0, "page": 1, "total_pages": 1, "page_size": PAGE_SIZE,
            "items": [], "facets": {"material_types": [], "formats": []},
        })

    materials = Material.objects.filter(
        course_id__in=course_ids,
        review_status="approved",
    ).select_related("course", "material_type", "uploader", "uploader__profile")

    query = request.GET.get("q", "").strip()[:200]
    if query:
        match = (
            Q(title__icontains=query) |
            Q(description__icontains=query) |
            Q(teacher__icontains=query) |
            Q(course__name__icontains=query) |
            Q(course__code__icontains=query)
        )
        lowered = query.casefold()
        display_matches = [
            course_id for course_id, leaf in catalog["leaf_map"].items()
            if course_id in course_ids and lowered in (leaf["name"] or "").casefold()
        ]
        if display_matches:
            match |= Q(course_id__in=display_matches)
        materials = materials.filter(match)

    if favorites_only:
        materials = materials.filter(favorited_by__user=user)

    type_counts = dict(
        materials.values_list("material_type_id").annotate(count=Count("id"))
    )
    format_counts = dict(
        materials.exclude(file_type="").values_list("file_type").annotate(count=Count("id"))
    )
    type_names = {row["id"]: row["name"] for row in MaterialType.objects.values("id", "name")}
    shapes = []
    for type_id, count in type_counts.items():
        if type_id:
            shapes.append({"id": type_id, "name": type_names.get(type_id, "其他"), "count": count})
    shapes.sort(key=lambda row: row["id"])
    formats = [
        {"value": value.lower(), "name": value.upper(), "count": count}
        for value, count in sorted(format_counts.items())
        if value
    ]

    material_type = request.GET.get("material_type")
    if material_type:
        try:
            material_type = int(material_type)
        except (TypeError, ValueError):
            return _err("资料类型无效", 400)
        materials = materials.filter(material_type_id=material_type)

    file_format = request.GET.get("format", "").strip().lower().lstrip(".")
    if file_format:
        materials = materials.filter(file_type__iexact=file_format)

    sort = request.GET.get("sort") or "latest"
    if sort not in SORTS:
        return _err("排序方式无效", 400)

    single_course_scope = _is_course_node(category, catalog)
    materials = materials.annotate(favorite_count=Count("favorited_by", distinct=True))
    if sort == "downloads":
        materials = materials.order_by("-download_count", "-created_at", "-id")
    elif sort == "favorites":
        materials = materials.order_by("-favorite_count", "-download_count", "-created_at", "-id")
    elif single_course_scope:
        materials = materials.order_by("-is_pinned", "-created_at", "-id")
    else:
        materials = materials.order_by("-created_at", "-id")

    total = materials.count()
    total_pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    page = min(_parse_page(request.GET.get("page")), total_pages)
    offset = (page - 1) * PAGE_SIZE
    items = list(materials[offset:offset + PAGE_SIZE])

    favorite_ids = set()
    if user is not None and items:
        favorite_ids = set(Favorite.objects.filter(
            user=user, material_id__in=[item.id for item in items],
        ).values_list("material_id", flat=True))

    return _ok({
        "total": total,
        "page": page,
        "total_pages": total_pages,
        "page_size": PAGE_SIZE,
        "items": [_serialize_item(item, catalog, favorite_ids) for item in items],
        "facets": {"material_types": shapes, "formats": formats},
    })


def _node_summary(cat_id, catalog, current_id=None):
    cat = catalog["cats"][cat_id]
    return {
        "id": cat_id,
        "name": cat["name"],
        "parent_id": cat["parent_id"],
        "has_children": bool(catalog["children"].get(cat_id)),
        "is_course": _is_course_node(cat, catalog),
        "is_current": cat_id == current_id,
    }


def _path_levels(cat_id, catalog):
    cats = catalog["cats"]
    children = catalog["children"]
    chain = []
    node = cats[cat_id]
    while node is not None:
        chain.append(node["id"])
        node = cats.get(node["parent_id"]) if node["parent_id"] else None
    chain.reverse()

    levels = []
    for index, node_id in enumerate(chain):
        parent_id = cats[node_id]["parent_id"]
        sibling_ids = catalog["roots"] if parent_id is None else children.get(parent_id, [])
        levels.append({
            "id": node_id,
            "name": cats[node_id]["name"],
            "course_type": "major" if _root_type(cats[node_id], cats) == "专业课" else "general",
            "siblings": [
                _node_summary(sibling_id, catalog, current_id=node_id)
                for sibling_id in sibling_ids
            ],
            "sibling_index": sibling_ids.index(node_id) if node_id in sibling_ids else -1,
        })
    return levels


def api_course_navigation(request):
    """GET /api/courses/navigation/ — 广场面包屑与浮窗共用的节点信息。

    参数 category_id 指定明确节点；没有时按 course_type + 当前身份解析默认
    位置。导航是公开数据，身份只影响本次默认定位，不进入公共缓存。
    """
    catalog = _catalog()
    category_id = request.GET.get("category_id")
    course_type = request.GET.get("course_type")
    if course_type not in (None, "", "major", "general"):
        return _err("课程类型无效", 400)

    if category_id:
        try:
            category_id = int(category_id)
        except (TypeError, ValueError):
            return _err("目录范围无效", 400)
        category = catalog["cats"].get(category_id)
        if category is None or category["is_divider"]:
            return _err("目录不存在", 404)
    else:
        category_id = _default_category_id(
            course_type or "general", _get_user(request), catalog,
        )
        if category_id is None:
            return _err("课程目录尚未建立", 404)

    category_id = _auto_skip(category_id, catalog)
    cat = catalog["cats"][category_id]
    children = [
        _node_summary(child_id, catalog)
        for child_id in catalog["children"].get(category_id, [])
    ]

    data = {
        "category_id": category_id,
        "name": cat["name"],
        "course_type": "major" if _root_type(cat, catalog) == "专业课" else "general",
        "path": _path_levels(category_id, catalog),
        "children": children,
        "can_expand_tree": not _is_course_node(cat, catalog),
    }
    if cat["course_id"]:
        course = catalog["courses"].get(cat["course_id"]) or {}
        leaf = catalog["leaf_map"].get(cat["course_id"]) or {}
        data["course_code"] = course.get("code") or ""
        data["course_name"] = leaf.get("name") or course.get("name") or cat["name"]

    if request.GET.get("courses") in ("1", "true", "yes"):
        course_ids = _scoped_course_ids(category_id, catalog)
        leaf_map = catalog["leaf_map"]
        seen = set()
        course_rows = []
        for course_id in course_ids:
            course = catalog["courses"][course_id]
            normalized = _normalized_course_code(course["code"])
            if not normalized or normalized in seen:
                continue
            if course["merged_into_id"]:
                continue
            seen.add(normalized)
            leaf = leaf_map.get(course_id)
            course_rows.append({
                "id": course_id,
                "code": course["code"],
                "name": (leaf or {}).get("name") or course["name"],
                "category_id": (leaf or {}).get("category_id"),
            })
        course_rows.sort(key=lambda row: (row["name"], row["code"]))
        data["courses"] = course_rows

    return _ok(data)
