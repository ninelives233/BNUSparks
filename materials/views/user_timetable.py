"""
BNU Sparks · 木铎星火 — 我的课表同步 API

课表数据由前端在浏览器本地解析教务导出文件后生成（JSON），此处仅做
按用户的云端存储以支持跨设备同步；数据互相隔离，仅本人可读写。

GET    /api/user/timetable/   读取（未导入时 data=null）
PUT    /api/user/timetable/   保存/覆盖（body: {"data": {...}, "event": {"type": "import", "id": "..."}}）
DELETE /api/user/timetable/   清除云端课表
"""

import json

from django.db import transaction
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .utils import _err, _ok, require_login
from ..models import TimetableImportRecord, UserTimetable

# 课表 JSON 体积很小（12 门课约 4KB）；上限仅防滥用
_MAX_BYTES = 200 * 1024


def _imported_at(data):
    try:
        return int(data.get("importedAt") or 0)
    except (AttributeError, TypeError, ValueError):
        return 0


def _updated_at_value(row):
    """保留微秒，避免 JSON 默认时间编码截断后条件拉取漏掉极短更新。"""
    return row.updated_at.isoformat(timespec="microseconds") if row.updated_at else None


# csrf_exempt 必须作用于最终视图对象（放最外层）：JWT Bearer 认证不依赖
# cookie，CSRF 防护不适用，与 auth/files 等写接口同一模式；漏掉会令浏览器
# PUT 被 CsrfViewMiddleware 以 403 拒绝
@csrf_exempt
@require_login
def api_user_timetable(request):
    if request.method == "GET":
        row = UserTimetable.objects.filter(user=request.user).first()
        if not row:
            return _ok({"data": None, "updated_at": None})
        since = parse_datetime(request.GET.get("since", ""))
        if since:
            # 测试环境可能 USE_TZ=False；生产环境通常是 aware，统一两边再比较。
            if timezone.is_naive(row.updated_at) and not timezone.is_naive(since):
                since = timezone.make_naive(since)
            elif not timezone.is_naive(row.updated_at) and timezone.is_naive(since):
                since = timezone.make_aware(since)
        if since and row.updated_at <= since:
            return _ok({
                "data": None,
                "updated_at": _updated_at_value(row),
                "unchanged": True,
            })
        return _ok({"data": row.data, "updated_at": _updated_at_value(row)})

    if request.method in ("PUT", "POST"):
        try:
            body = json.loads(request.body or b"{}")
        except Exception:
            return _err("请求格式错误")
        data = body.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("courses"), list):
            return _err("课表数据格式不正确")
        if len(json.dumps(data, ensure_ascii=False)) > _MAX_BYTES:
            return _err("课表数据过大")
        event = body.get("event") if isinstance(body.get("event"), dict) else {}
        event_id = str(event.get("id") or "").strip()
        is_import = event.get("type") == "import" and 0 < len(event_id) <= 64
        # 上传请求可能因网络重试/跨端同时保存而乱序到达；较旧的导入版本
        # 不能覆盖更新的课表。锁住单用户行，保持“比较版本→写入”原子化。
        with transaction.atomic():
            if is_import:
                TimetableImportRecord.objects.get_or_create(
                    user=request.user,
                    event_id=event_id,
                    defaults={"course_count": len(data["courses"])},
                )
            row = UserTimetable.objects.select_for_update().filter(user=request.user).first()
            if row and _imported_at(row.data) > _imported_at(data):
                return _ok({
                    "updated_at": _updated_at_value(row),
                    "accepted": False,
                    "data": row.data,
                    "import_recorded": is_import,
                })
            if row:
                row.data = data
                row.save(update_fields=["data", "updated_at"])
            else:
                row = UserTimetable.objects.create(user=request.user, data=data)
        return _ok({"updated_at": _updated_at_value(row), "accepted": True, "import_recorded": is_import})

    if request.method == "DELETE":
        deleted, _ = UserTimetable.objects.filter(user=request.user).delete()
        return _ok({"deleted": bool(deleted)})

    return _err("不支持的方法", 405)
