"""BNU Sparks — 校园快捷入口 API。"""

import json
from urllib.parse import urlparse

from django.db import transaction
from django.views.decorators.csrf import csrf_exempt

from .utils import _err, _ok, require_role, UserProfile
from ..models import CampusLink


MAX_LINKS = 12


def _serialize(link):
    return {
        "id": link.id,
        "name": link.name,
        "url": link.url,
        "order": link.order,
        "is_enabled": link.is_enabled,
    }


def _valid_url(value):
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    return (
        parsed.scheme in {"http", "https"}
        and bool(parsed.netloc)
        and not parsed.username
        and not parsed.password
    )


def _clean_values(body, *, existing=None):
    name = body.get("name", existing.name if existing else "")
    url = body.get("url", existing.url if existing else "")
    name = name.strip() if isinstance(name, str) else ""
    url = url.strip() if isinstance(url, str) else ""
    if not name or len(name) > 40:
        return None, "入口名称需为 1–40 个字符"
    if len(url) > 500 or not _valid_url(url):
        return None, "网址必须是 http 或 https 地址"
    values = {"name": name, "url": url}
    if "order" in body:
        try:
            values["order"] = max(0, int(body["order"]))
        except (TypeError, ValueError):
            return None, "排序值无效"
    if "is_enabled" in body:
        raw = body["is_enabled"]
        values["is_enabled"] = raw.strip().lower() in {"1", "true", "yes", "on"} if isinstance(raw, str) else bool(raw)
    return values, None


def _parse_object(request):
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, TypeError):
        return None, "请求格式错误"
    if not isinstance(body, dict):
        return None, "请求体必须是 JSON 对象"
    return body, None


def api_campus_links(request):
    """GET 公开启用入口；POST 仅总管理员新增入口。"""
    if request.method == "GET":
        links = CampusLink.objects.all()
        # GET 未经过认证装饰器，只有显式 JWT 用户可看到管理预览数据。
        from .utils import _get_user, _get_or_create_profile
        user = _get_user(request)
        can_manage = bool(user and _get_or_create_profile(user).role == UserProfile.Role.SUPER_ADMIN)
        if not can_manage:
            links = links.filter(is_enabled=True)
        return _ok({
            "items": [_serialize(link) for link in links],
            "can_manage": can_manage,
        })

    return _err("仅支持 GET", 405)


@csrf_exempt
@require_role(UserProfile.Role.SUPER_ADMIN)
def api_campus_link_create(request):
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    body, error = _parse_object(request)
    if error:
        return _err(error, 400)
    if CampusLink.objects.count() >= MAX_LINKS:
        return _err(f"最多配置 {MAX_LINKS} 个入口", 400)
    values, error = _clean_values(body)
    if error:
        return _err(error, 400)
    if "order" not in values:
        values["order"] = CampusLink.objects.count()
    link = CampusLink.objects.create(**values)
    return _ok(_serialize(link), 201)


@csrf_exempt
@require_role(UserProfile.Role.SUPER_ADMIN)
def api_campus_link_update(request, link_id):
    if request.method != "PATCH":
        return _err("仅支持 PATCH", 405)
    link = CampusLink.objects.filter(pk=link_id).first()
    if not link:
        return _err("入口不存在", 404)
    body, error = _parse_object(request)
    if error:
        return _err(error, 400)
    values, error = _clean_values(body, existing=link)
    if error:
        return _err(error, 400)
    for field, value in values.items():
        setattr(link, field, value)
    link.save(update_fields=[*values.keys(), "updated_at"])
    return _ok(_serialize(link))


@csrf_exempt
@require_role(UserProfile.Role.SUPER_ADMIN)
def api_campus_links_reorder(request):
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    body, error = _parse_object(request)
    if error:
        return _err(error, 400)
    raw_ids = body.get("ids")
    if not isinstance(raw_ids, list):
        return _err("排序数据必须是 ID 数组", 400)
    try:
        ids = [int(value) for value in raw_ids]
    except (TypeError, ValueError):
        return _err("排序数据必须是整数 ID 数组", 400)

    with transaction.atomic():
        links = list(CampusLink.objects.select_for_update().order_by("order", "id"))
        existing_ids = {link.id for link in links}
        submitted_ids = set(ids)
        if len(ids) != len(submitted_ids) or submitted_ids != existing_ids:
            return _err("排序数据必须完整包含每个入口，且不能重复或包含未知 ID", 400)
        by_id = {link.id: link for link in links}
        for index, link_id in enumerate(ids):
            link = by_id[link_id]
            if link.order != index:
                link.order = index
                link.save(update_fields=["order", "updated_at"])
        ordered = list(CampusLink.objects.order_by("order", "id"))
    return _ok({"items": [_serialize(link) for link in ordered]})
