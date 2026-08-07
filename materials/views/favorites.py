"""
BNU Sparks · 木铎星火 — 收藏 API

favorite toggle, list favorites (资料收藏 + 课程收藏)
"""

from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User

from .utils import (
    _err, _ok, _get_or_create_profile, require_login, _safe_int,
    Favorite, Material,
)
from ..models import Course, CourseFavorite


@csrf_exempt
@require_login
def api_favorite_toggle(request, file_id):
    """POST /api/files/<id>/favorite/ — 切换收藏状态"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)

    material = Material.objects.filter(id=file_id).first()
    if not material:
        return _err("资料不存在", 404)

    fav = Favorite.objects.filter(user=request.user, material=material)
    if fav.exists():
        fav.delete()
        return _ok({"favorited": False})
    else:
        Favorite.objects.create(user=request.user, material=material)
        return _ok({"favorited": True})


@require_login
def api_favorite_status(request, file_id):
    """GET /api/files/<id>/favorite/ — 查看收藏状态"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)

    material = Material.objects.filter(id=file_id).first()
    if not material:
        return _err("资料不存在", 404)

    is_favorited = Favorite.objects.filter(
        user=request.user, material=material
    ).exists()
    fav_count = Favorite.objects.filter(material=material).count()
    return _ok({
        "favorited": is_favorited,
        "favorite_count": fav_count,
    })


@require_login
def api_my_favorites(request):
    """GET /api/user/favorites/ — 我的收藏列表"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)

    page = _safe_int(request.GET.get("page"), 1, lo=1)
    page_size = int(request.GET.get("page_size", 20))
    offset = (page - 1) * page_size

    favorites = Favorite.objects.filter(
        user=request.user
    ).select_related(
        "material", "material__course"
    ).order_by("-created_at")

    total = favorites.count()
    items = favorites[offset:offset + page_size]

    total_pages = max(1, (total + page_size - 1) // page_size)

    return _ok({
        "total": total,
        "page": page,
        "total_pages": total_pages,
        "items": [{
            "id": fav.material.id,
            "title": fav.material.title,
            "file_name": fav.material.file_name,
            "course_code": fav.material.course.code if fav.material.course else "",
            "course_name": fav.material.course.name if fav.material.course else "",
            "created_at": fav.material.created_at.strftime("%Y-%m-%d"),
            "favorited_at": fav.created_at.strftime("%Y-%m-%d"),
        } for fav in items],
    })


# ═══════════════════════════════════════════════════════════════
# 课程收藏（收藏课程 = 叶子课程节点）
# ═══════════════════════════════════════════════════════════════

def _resolve_course_by_code(code):
    """课程代码解析：精确唯一→通配前缀唯一→歧义/无 → None"""
    try:
        return Course.objects.get(code=code)
    except Course.DoesNotExist:
        cleaned = code.replace("*", "").replace("-", "")
        matched = Course.objects.filter(code__startswith=cleaned)
        if matched.count() == 1:
            return matched.first()
        return None
    except Course.MultipleObjectsReturned:
        courses = list(Course.objects.filter(code=code).order_by("id"))
        if not courses:
            return None
        with_files = [c for c in courses if c.materials.filter(is_approved=True).exists()]
        return (with_files or courses)[0]


@csrf_exempt
@require_login
def api_course_favorite_toggle(request, course_code):
    """POST /api/courses/<code>/favorite/ — 切换课程收藏状态"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    if "*" in course_code:
        return _err("无效的课程代码", 400)
    course = _resolve_course_by_code(course_code)
    if course is None:
        return _err("课程不存在", 404)

    fav = CourseFavorite.objects.filter(user=request.user, course=course)
    if fav.exists():
        fav.delete()
        return _ok({"favorited": False})
    CourseFavorite.objects.create(user=request.user, course=course)
    return _ok({"favorited": True})


@require_login
def api_my_course_favorites(request):
    """GET /api/user/course-favorites/ — 我收藏的课程（按 code 去重，同名分拆课程合并）"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    favs = CourseFavorite.objects.filter(
        user=request.user
    ).select_related("course").order_by("-created_at")

    seen = {}
    for fav in favs:
        code = fav.course.code
        if not code or code in seen:
            continue
        seen[code] = {
            "course_code": code,
            "course_name": fav.course.name,
            "course_type": fav.course.course_type,
            "college_name": fav.course.college.name if fav.course.college_id else "",
            "favorited_at": fav.created_at.strftime("%Y-%m-%d"),
        }
    return _ok({"items": list(seen.values())})
