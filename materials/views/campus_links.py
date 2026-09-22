"""BNU Sparks — 校园快捷入口 API。

CampusLink 是总管理员维护的全站精选；UserCampusLink 是账号私有的入口清单。
两者共用校验和排序接口，但写入范围始终由服务端根据 JWT + scope 决定。
"""

import json
from urllib.parse import urlparse

from django.db import transaction
from django.views.decorators.csrf import csrf_exempt

from .utils import (
    _err, _get_or_create_profile, _get_user, _ok, require_login, UserProfile,
)
from ..models import CampusLink, UserCampusLink


MAX_LINKS = 12
SCOPE_FEATURED = "featured"
SCOPE_PERSONAL = "personal"


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


def _write_scope(request, body):
    """Resolve the target list without trusting a client-supplied user id.

    Missing scope preserves the old super-admin API behavior. For ordinary
    users it means their personal list, so old-looking clients cannot mutate
    the global featured list by accident.
    """
    user = _get_user(request)
    if user is None:
        return None, None, None, _err("请先登录", 401)
    profile = _get_or_create_profile(user)
    requested = body.get("scope")
    if requested is None or requested == "":
        scope = SCOPE_FEATURED if profile.role == UserProfile.Role.SUPER_ADMIN else SCOPE_PERSONAL
    elif requested in {SCOPE_FEATURED, SCOPE_PERSONAL}:
        scope = requested
    else:
        return None, None, None, _err("入口范围无效", 400)
    if scope == SCOPE_FEATURED and profile.role != UserProfile.Role.SUPER_ADMIN:
        return None, None, None, _err("只有总管理员可以维护精选入口", 403)
    return scope, user, profile, None


def _query_for_scope(scope, user):
    if scope == SCOPE_PERSONAL:
        return UserCampusLink.objects.filter(user=user)
    return CampusLink.objects.all()


def api_campus_links(request):
    """公开读取精选；登录用户同时读取自己的入口和显示模式。"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)

    user = _get_user(request)
    profile = _get_or_create_profile(user) if user else None
    is_super_admin = bool(profile and profile.role == UserProfile.Role.SUPER_ADMIN)

    all_featured = CampusLink.objects.all()
    public_featured = all_featured.filter(is_enabled=True)
    featured_items = all_featured if is_super_admin else public_featured
    personal_items = UserCampusLink.objects.filter(user=user) if user else UserCampusLink.objects.none()
    mode = getattr(profile, "campus_links_mode", SCOPE_FEATURED) if profile else SCOPE_FEATURED
    if mode not in {SCOPE_FEATURED, SCOPE_PERSONAL}:
        mode = SCOPE_FEATURED

    if mode == SCOPE_PERSONAL and user:
        active_items = personal_items.filter(is_enabled=True)
    else:
        active_items = public_featured

    return _ok({
        # items 是首页当前应显示的启用项，兼容原首页读取契约。
        "items": [_serialize(link) for link in active_items],
        # 管理/个人面板分别使用这两组完整数据；普通用户看不到停用的精选项。
        "featured_items": [_serialize(link) for link in featured_items],
        "personal_items": [_serialize(link) for link in personal_items],
        "mode": mode,
        "can_manage": bool(user),
        "can_manage_featured": is_super_admin,
    })


@csrf_exempt
def api_campus_link_create(request):
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    body, error = _parse_object(request)
    if error:
        return _err(error, 400)
    scope, user, profile, response = _write_scope(request, body)
    if response:
        return response
    queryset = _query_for_scope(scope, user)
    if queryset.count() >= MAX_LINKS:
        return _err(f"最多配置 {MAX_LINKS} 个入口", 400)
    values, error = _clean_values(body)
    if error:
        return _err(error, 400)
    if "order" not in values:
        values["order"] = queryset.count()
    if scope == SCOPE_PERSONAL:
        link = UserCampusLink.objects.create(user=user, **values)
        # 第一次保存即进入个人模式；原有精选仍保存在 featured_items 中。
        if profile.campus_links_mode != UserProfile.CampusLinksMode.PERSONAL:
            profile.campus_links_mode = UserProfile.CampusLinksMode.PERSONAL
            profile.save(update_fields=["campus_links_mode"])
    else:
        link = CampusLink.objects.create(**values)
    return _ok(_serialize(link), 201)


@csrf_exempt
def api_campus_link_update(request, link_id):
    if request.method not in {"PATCH", "DELETE"}:
        return _err("仅支持 PATCH 或 DELETE", 405)

    if request.method == "DELETE":
        body = {}
    else:
        body, error = _parse_object(request)
        if error:
            return _err(error, 400)
    scope, user, _profile, response = _write_scope(request, body)
    if response:
        return response
    link = _query_for_scope(scope, user).filter(pk=link_id).first()
    if not link:
        return _err("入口不存在", 404)
    if request.method == "DELETE":
        if scope != SCOPE_PERSONAL:
            return _err("精选入口不支持删除，请停用入口", 405)
        link.delete()
        return _ok({"id": link_id, "deleted": True})

    values, error = _clean_values(body, existing=link)
    if error:
        return _err(error, 400)
    for field, value in values.items():
        setattr(link, field, value)
    link.save(update_fields=[*values.keys(), "updated_at"])
    return _ok(_serialize(link))


@csrf_exempt
def api_campus_links_reorder(request):
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    body, error = _parse_object(request)
    if error:
        return _err(error, 400)
    scope, user, _profile, response = _write_scope(request, body)
    if response:
        return response
    raw_ids = body.get("ids")
    if not isinstance(raw_ids, list):
        return _err("排序数据必须是 ID 数组", 400)
    try:
        ids = [int(value) for value in raw_ids]
    except (TypeError, ValueError):
        return _err("排序数据必须是整数 ID 数组", 400)

    with transaction.atomic():
        links = list(_query_for_scope(scope, user).select_for_update().order_by("order", "id"))
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
        ordered = list(_query_for_scope(scope, user).order_by("order", "id"))
    return _ok({"items": [_serialize(link) for link in ordered], "scope": scope})


@csrf_exempt
@require_login
def api_campus_links_preferences(request):
    """切换当前账号首页显示精选还是个人入口，不改动任何入口数据。"""
    if request.method not in {"PATCH", "POST"}:
        return _err("仅支持 PATCH", 405)
    body, error = _parse_object(request)
    if error:
        return _err(error, 400)
    mode = body.get("mode")
    if mode not in {SCOPE_FEATURED, SCOPE_PERSONAL}:
        return _err("显示模式无效", 400)
    profile = _get_or_create_profile(request.user)
    profile.campus_links_mode = mode
    profile.save(update_fields=["campus_links_mode"])
    return _ok({"mode": mode})
