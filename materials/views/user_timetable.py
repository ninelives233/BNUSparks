"""
BNU Sparks · 木铎星火 — 我的课表同步 API

课表数据由前端在浏览器本地解析教务导出文件后生成（JSON），此处仅做
按用户的云端存储以支持跨设备同步；数据互相隔离，仅本人可读写。

GET    /api/user/timetable/   读取（未导入时 data=null）
PUT    /api/user/timetable/   保存/覆盖（body: {"data": {...}, "event": {"type": "import", "id": "..."}}）
DELETE /api/user/timetable/   清除云端课表
"""

import json
import random
import time

from django.db import IntegrityError, OperationalError
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .utils import _err, _ok, require_login
from ..monitoring_events import record_timetable_outcome
from .utils_campus import update_user_campus
from ..models import TimetableImportRecord, UserTimetable

# 课表 JSON 体积很小（12 门课约 4KB）；上限仅防滥用
_MAX_BYTES = 200 * 1024

# 同版本并发写入/SQLite busy 的有界重试次数；超出即向客户端报冲突
_MAX_WRITE_ATTEMPTS = 4


def _imported_at(data):
    try:
        return int(data.get("importedAt") or 0)
    except (AttributeError, TypeError, ValueError):
        return 0


def _updated_at_value(row):
    """保留微秒，避免 JSON 默认时间编码截断后条件拉取漏掉极短更新。"""
    return row.updated_at.isoformat(timespec="microseconds") if row.updated_at else None


def _micro_iso(dt):
    return dt.isoformat(timespec="microseconds") if dt else None


def _timetable_put_once(user, data, is_import):
    """一次「读取→版本仲裁→条件写入」尝试。

    返回响应 dict；返回 None 表示同版本并发写入（或并发首写）撞车，
    调用方需重读最新数据重新仲裁。写库走 ``revision=旧值`` 条件
    UPDATE——SQLite 上 select_for_update 不产生行锁，条件更新才是
    「读到的版本没被别人改过」的可验证保证。
    """
    row = UserTimetable.objects.filter(user=user).first()
    if row and _imported_at(row.data) > _imported_at(data):
        # 旧客户端兼容路径：较旧的导入版本不覆盖更新的课表
        return {
            "updated_at": _updated_at_value(row),
            "accepted": False,
            "data": row.data,
            "import_recorded": is_import,
        }
    now = timezone.now()
    if row:
        updated = UserTimetable.objects.filter(
            pk=row.pk, revision=row.revision,
        ).update(data=data, updated_at=now, revision=row.revision + 1)
        if not updated:
            return None  # 条件更新 0 行：并发同版本写入已发生，重读仲裁
        return {
            "updated_at": _micro_iso(now),
            "accepted": True,
            "import_recorded": is_import,
        }
    try:
        row = UserTimetable.objects.create(user=user, data=data)
    except IntegrityError:
        return None  # 并发首写撞唯一约束：重读仲裁
    return {
        "updated_at": _updated_at_value(row),
        "accepted": True,
        "import_recorded": is_import,
    }


# csrf_exempt 必须作用于最终视图对象（放最外层）：JWT Bearer 认证不依赖
# cookie，CSRF 防护不适用，与 auth/files 等写接口同一模式；漏掉会令浏览器
# PUT 被 CsrfViewMiddleware 以 403 拒绝
@csrf_exempt
@require_login
@record_timetable_outcome
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
        if is_import:
            # 导入留痕自身幂等（唯一约束 + get_or_create），独立于写入重试：
            # 即便随后仲裁为 accepted:false，事件也只记一次。
            TimetableImportRecord.objects.get_or_create(
                user=request.user,
                event_id=event_id,
                defaults={"course_count": len(data["courses"])},
            )
        # 上传请求可能因网络重试/跨端同时保存而乱序到达；较旧的导入版本
        # 不能覆盖更新的课表。每次尝试都是独立短事务，冲突（条件更新 0 行）
        # 重读最新数据重新仲裁；SQLite busy 有界退避重试，不外溢为 500。
        payload = None
        for attempt in range(_MAX_WRITE_ATTEMPTS):
            try:
                payload = _timetable_put_once(request.user, data, is_import)
            except OperationalError:
                payload = None
            if payload is not None:
                break
            time.sleep(random.uniform(0.05, 0.15) * (attempt + 1))
        if payload is None:
            return _err("课表保存冲突，请稍后重试", 503)
        if payload.get("accepted"):
            update_user_campus(request.user, data)
        return _ok(payload)

    if request.method == "DELETE":
        deleted, _ = UserTimetable.objects.filter(user=request.user).delete()
        return _ok({"deleted": bool(deleted)})

    return _err("不支持的方法", 405)
