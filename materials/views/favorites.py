"""
BNU Sparks · 木铎星火 — 收藏 API

favorite toggle, list favorites
"""

from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User

from .utils import (
    _err, _ok, _get_or_create_profile, require_login,
    Favorite, Material,
)


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

    page = int(request.GET.get("page", 1))
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
