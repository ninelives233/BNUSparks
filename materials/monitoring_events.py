"""行为事件采集、聚合查询与隐私边界。

阶段四把「活跃」定义为当天至少发生一次已校验的业务事件。客户端页面
事件走小批量接口，登录、资料、课表和审核等关键业务事件由服务端直接记
录。事件表没有自由 metadata 字段，匿名主体只保存按日轮换标识的 HMAC。
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
from datetime import date, datetime, timedelta
from functools import wraps

from django.conf import settings
from django.db import DatabaseError, IntegrityError, transaction
from django.db.models import Count, Min
from django.db.models.functions import TruncDate, TruncHour
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .models import MonitoringAggregate, MonitoringEvent


# 不在模块导入期加载 materials.views.utils：views facade 会反向导入本模块，
# 这里改为运行时轻量代理，避免认证模块与事件模块循环依赖。
def _err(*args, **kwargs):
    from .views.utils_auth import _err as response_error
    return response_error(*args, **kwargs)


def _ok(*args, **kwargs):
    from .views.utils_auth import _ok as response_ok
    return response_ok(*args, **kwargs)


def _get_user(request):
    from .views.utils_auth import _get_user as request_user
    return request_user(request)


logger = logging.getLogger(__name__)

EVENT_LABELS = {
    value: label for value, label in MonitoringEvent.EventName.choices
}
ALLOWED_EVENT_NAMES = frozenset(EVENT_LABELS)
CLIENT_EVENT_NAMES = frozenset({
    MonitoringEvent.EventName.VIEW_OPEN,
    MonitoringEvent.EventName.SEARCH_EXECUTE,
    MonitoringEvent.EventName.SEARCH_NO_RESULT,
})
EVENT_BATCH_MAX = 50
EVENT_BATCH_BYTES = 32 * 1024
EVENT_ID_MAX = 80
ANONYMOUS_ID_MAX = 128
VIEW_NAME_MAX = 40
EVENT_CLOCK_SKEW_SECONDS = 15 * 60
RAW_RETENTION_DAYS = 30
AGGREGATE_ALL_EVENT = "__all__"
ALLOWED_OUTCOMES = frozenset({
    "approved", "rejected", "batch_approved",
    "course_approved", "course_rejected", "course_batch_approved",
})

# 仅允许 SPA 已存在的视图键；未知值统一落到 other，避免前端自由文本
# 把事件基数和存储体积做大。
KNOWN_VIEW_NAMES = frozenset({
    "home", "explorer", "profile", "notif", "admin", "about", "tutorial",
    "rankings", "leaderboard", "recentAll", "announcements", "broad", "timetable", "qa",
    "qaCompose", "recommendations", "myuploads", "mydownloads", "myfavorites", "newCourse",
    "fileDetail", "userPublic", "other",
})


def new_event_id(prefix="sv"):
    """生成不含业务内容的短事件 ID。"""
    safe_prefix = "".join(ch for ch in str(prefix or "sv") if ch.isalnum())[:8] or "sv"
    return f"{safe_prefix}-{secrets.token_urlsafe(20)}"[:EVENT_ID_MAX]


def normalize_view_name(value):
    value = str(value or "").strip()
    if value in KNOWN_VIEW_NAMES:
        return value
    return "other"


def anonymous_actor_hash(raw_id, day=None):
    """按自然日轮换的不可逆匿名主体摘要；不把 raw_id 写入数据库。"""
    raw_id = str(raw_id or "").strip()
    if not raw_id or len(raw_id) > ANONYMOUS_ID_MAX:
        return ""
    day = day or _local_now().date()
    message = f"bnusparks-anonymous-v1:{day.isoformat()}:{raw_id}".encode("utf-8")
    return hmac.new(settings.SECRET_KEY.encode("utf-8"), message, hashlib.sha256).hexdigest()


def _local_now():
    value = timezone.now()
    return timezone.localtime(value) if timezone.is_aware(value) else value


def _make_aware_if_needed(value):
    if value is None:
        return _local_now()
    if isinstance(value, date) and not isinstance(value, datetime):
        value = datetime.combine(value, datetime.min.time())
    if settings.USE_TZ and timezone.is_naive(value):
        return timezone.make_aware(value, timezone.get_current_timezone())
    if not settings.USE_TZ and timezone.is_aware(value):
        return timezone.make_naive(value, timezone.get_current_timezone())
    return value


def _normalize_occurred_at(value):
    """接受客户端 ISO 时间，但拒绝远离接收时刻的伪造日期。"""
    now = _local_now()
    if not value:
        return now
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        parsed = _make_aware_if_needed(parsed)
        if timezone.is_aware(parsed) != timezone.is_aware(now):
            parsed = _make_aware_if_needed(parsed)
        if abs((parsed - now).total_seconds()) > EVENT_CLOCK_SKEW_SECONDS:
            return now
        return parsed
    except (TypeError, ValueError, OverflowError):
        return now


def _event_day(value):
    value = _make_aware_if_needed(value)
    return (timezone.localtime(value) if timezone.is_aware(value) else value).date()


def _request_user(request):
    user = getattr(request, "user", None)
    if user is not None and getattr(user, "is_authenticated", True):
        return user
    return _get_user(request)


def _request_anonymous_id(request):
    return (
        request.headers.get("X-BNU-Visitor")
        or request.META.get("HTTP_X_BNU_VISITOR")
        or ""
    ).strip()


def _normalize_outcome(value):
    value = str(value or "").strip()
    return value if value in ALLOWED_OUTCOMES else ""


def record_monitoring_event(
    event_name,
    *,
    user=None,
    anonymous_id="",
    event_id=None,
    occurred_at=None,
    view_name="",
    outcome="",
):
    """写入一条服务端事件；失败只记录日志，不影响业务响应。"""
    if event_name not in ALLOWED_EVENT_NAMES:
        return False
    occurred_at = _normalize_occurred_at(occurred_at)
    day = _event_day(occurred_at)
    event_id = str(event_id or new_event_id())[:EVENT_ID_MAX]
    user = user if getattr(user, "is_authenticated", True) else None
    if user is not None:
        audience = MonitoringEvent.Audience.USER
        actor_hash = ""
        user_id = getattr(user, "id", None)
        if not user_id:
            return False
    else:
        audience = MonitoringEvent.Audience.ANONYMOUS
        actor_hash = anonymous_actor_hash(anonymous_id, day)
        user_id = None
        # 没有客户端匿名标识时不保存匿名事件，避免把每个失败请求误算成访客。
        if not actor_hash:
            return False
    view_name = normalize_view_name(view_name) if event_name == MonitoringEvent.EventName.VIEW_OPEN else ""
    outcome = _normalize_outcome(outcome)
    try:
        # savepoint 让重复事件在 Django TestCase/业务外层事务中也能安全
        # 回滚；单纯捕获 IntegrityError 会把调用方事务标成 broken。
        with transaction.atomic():
            MonitoringEvent.objects.create(
                event_id=event_id,
                event_name=event_name,
                audience=audience,
                user_id=user_id,
                actor_hash=actor_hash,
                day=day,
                occurred_at=occurred_at,
                view_name=view_name,
                outcome=outcome,
            )
        return True
    except IntegrityError:
        # 同一服务事件/下载令牌重试是成功的幂等路径。
        return False
    except DatabaseError:
        logger.warning("monitoring event write failed: %s", event_name, exc_info=True)
        return False
    except Exception:
        logger.warning("monitoring event unexpected failure: %s", event_name, exc_info=True)
        return False


def record_request_event(request, event_name, **kwargs):
    """按请求主体记录事件；匿名主体只从每日轮换 header 读取。"""
    return record_monitoring_event(
        event_name,
        user=_request_user(request),
        anonymous_id=_request_anonymous_id(request),
        **kwargs,
    )


def record_outcome(event_success, event_failure):
    """为上传等多分支写接口提供 best-effort 成功/失败事件包装器。"""
    def decorator(view):
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            try:
                response = view(request, *args, **kwargs)
            except Exception:
                record_request_event(request, event_failure)
                raise
            status = getattr(response, "status_code", 500)
            # 401/403 是权限边界，不当作业务系统失败；调用方仍可以显式记录。
            if 200 <= status < 300:
                record_request_event(request, event_success)
            elif status not in (401, 403):
                record_request_event(request, event_failure)
            return response
        return wrapped
    return decorator


def record_login_outcome(view):
    """登录成功由视图显式带 user；其它响应统一记录无账户内容的失败。"""
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        request._monitor_login_recorded = False
        try:
            response = view(request, *args, **kwargs)
        except Exception:
            record_request_event(request, MonitoringEvent.EventName.LOGIN_FAILURE)
            raise
        if not getattr(request, "_monitor_login_recorded", False):
            status = getattr(response, "status_code", 500)
            if status not in (401, 403):
                record_request_event(request, MonitoringEvent.EventName.LOGIN_FAILURE)
        return response
    return wrapped


def record_timetable_outcome(view):
    """只为带 ``event.type=import`` 的课表写入成功/失败事件。"""
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        raw_event_id = ""
        is_import = False
        if request.method in ("PUT", "POST"):
            try:
                body = json.loads(request.body or b"{}")
                event = body.get("event") if isinstance(body, dict) else {}
                event = event if isinstance(event, dict) else {}
                raw_event_id = str(event.get("id") or "").strip()
                is_import = event.get("type") == "import" and 0 < len(raw_event_id) <= 64
            except (TypeError, ValueError):
                pass
        try:
            response = view(request, *args, **kwargs)
        except Exception:
            if is_import:
                scoped_id = hashlib.sha256(raw_event_id.encode("utf-8")).hexdigest()[:32]
                record_request_event(
                    request, MonitoringEvent.EventName.TIMETABLE_IMPORT_FAILURE,
                    event_id=f"tt-import-failure:{request.user.id}:{scoped_id}",
                )
            raise
        if is_import:
            try:
                payload = json.loads(response.content or b"{}")
                imported = bool((payload.get("data") or {}).get("import_recorded"))
            except (TypeError, ValueError):
                imported = False
            suffix = "success" if 200 <= getattr(response, "status_code", 500) < 300 and imported else "failure"
            scoped_id = hashlib.sha256(raw_event_id.encode("utf-8")).hexdigest()[:32]
            record_request_event(
                request,
                MonitoringEvent.EventName.TIMETABLE_IMPORT_SUCCESS if suffix == "success" else MonitoringEvent.EventName.TIMETABLE_IMPORT_FAILURE,
                event_id=f"tt-import-{suffix}:{request.user.id}:{scoped_id}",
            )
        return response
    return wrapped


def ingest_monitoring_events(request):
    """POST /api/monitoring/events/，最多 50 条、单次最多 32KB。"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    if len(request.body or b"") > EVENT_BATCH_BYTES:
        return _err("事件批次过大", 413)
    try:
        body = json.loads(request.body or b"{}")
    except (TypeError, ValueError):
        return _err("请求格式错误")
    events = body.get("events") if isinstance(body, dict) else None
    if not isinstance(events, list) or not events:
        return _ok({"accepted": 0, "ignored": 0})
    if len(events) > EVENT_BATCH_MAX:
        return _err("事件批次最多包含 50 条", 413)
    user = _request_user(request)
    fallback_anon = _request_anonymous_id(request)
    rows = []
    seen_ids = set()
    for item in events:
        if not isinstance(item, dict):
            continue
        event_name = str(item.get("event_name") or item.get("name") or "").strip()
        event_id = str(item.get("event_id") or item.get("id") or "").strip()
        # 浏览器批次只允许页面/搜索事件；登录、资料、课表、审核等关键事件
        # 必须由服务端在业务结果已确定后写入，防止客户端伪造成功指标。
        if event_name not in CLIENT_EVENT_NAMES or not event_id or len(event_id) > EVENT_ID_MAX:
            continue
        if event_id in seen_ids:
            continue
        seen_ids.add(event_id)
        occurred_at = _normalize_occurred_at(item.get("occurred_at"))
        day = _event_day(occurred_at)
        requested_audience = str(item.get("audience") or "").strip()
        is_anonymous_event = requested_audience == MonitoringEvent.Audience.ANONYMOUS
        if user is not None and not is_anonymous_event:
            audience = MonitoringEvent.Audience.USER
            user_id = user.id
            actor_hash = ""
        else:
            raw_anon = str(item.get("anonymous_id") or fallback_anon or "").strip()
            actor_hash = anonymous_actor_hash(raw_anon, day)
            if not actor_hash:
                continue
            audience = MonitoringEvent.Audience.ANONYMOUS
            user_id = None
        view_name = normalize_view_name(item.get("view_name")) if event_name == MonitoringEvent.EventName.VIEW_OPEN else ""
        outcome = _normalize_outcome(item.get("outcome"))
        rows.append(MonitoringEvent(
            event_id=event_id,
            event_name=event_name,
            audience=audience,
            user_id=user_id,
            actor_hash=actor_hash,
            day=day,
            occurred_at=occurred_at,
            view_name=view_name,
            outcome=outcome,
        ))
    if not rows:
        return _ok({"accepted": 0, "ignored": len(events)})
    event_ids = [row.event_id for row in rows]
    try:
        existing_ids = set(MonitoringEvent.objects.filter(event_id__in=event_ids).values_list("event_id", flat=True))
        with transaction.atomic():
            MonitoringEvent.objects.bulk_create(rows, ignore_conflicts=True)
    except DatabaseError:
        logger.warning("monitoring event batch write failed", exc_info=True)
        return _ok({"accepted": 0, "ignored": len(events), "deferred": True})
    inserted = len(rows) - len(existing_ids)
    return _ok({"accepted": inserted, "ignored": len(events) - inserted})


def _period_range(period, selected_date=None):
    now = _local_now()
    today = now.date()
    if period == "day":
        start_date = today
    elif period == "week":
        start_date = today - timedelta(days=6)
    elif period == "month":
        start_date = today - timedelta(days=29)
    else:
        first_raw = MonitoringEvent.objects.aggregate(value=Min("day"))["value"]
        first_aggregate = MonitoringAggregate.objects.aggregate(value=Min("bucket_start"))["value"]
        aggregate_date = _event_day(first_aggregate) if first_aggregate else None
        choices = [item for item in (first_raw, aggregate_date) if item]
        start_date = min(choices) if choices else today
    chosen = selected_date if isinstance(selected_date, date) else None
    if chosen is None:
        chosen = today if start_date <= today else start_date
    if chosen < start_date or chosen > today:
        chosen = max(start_date, min(today, chosen))
    return start_date, today, chosen


def _event_queryset(start_date, end_date):
    return MonitoringEvent.objects.filter(day__gte=start_date, day__lte=end_date)


def _empty_daily(start_date, end_date):
    result = {}
    cursor = start_date
    while cursor <= end_date:
        key = cursor.isoformat()
        result[key] = {
            "date": key,
            "label": cursor.strftime("%m-%d"),
            "logged_in": 0,
            "anonymous": 0,
            "all": 0,
            "event_count": 0,
        }
        cursor += timedelta(days=1)
    return result


def _add_daily_rows(result, queryset):
    rows = (
        queryset.values("day", "audience")
        .annotate(
            event_count=Count("id"),
            user_people=Count("user_id", distinct=True),
            anon_people=Count("actor_hash", distinct=True),
        )
        .order_by("day", "audience")
    )
    for row in rows:
        key = row["day"].isoformat()
        bucket = result.get(key)
        if not bucket:
            continue
        people = row["user_people"] if row["audience"] == MonitoringEvent.Audience.USER else row["anon_people"]
        bucket["event_count"] += row["event_count"]
        bucket["logged_in" if row["audience"] == MonitoringEvent.Audience.USER else "anonymous"] += people
    for bucket in result.values():
        bucket["all"] = bucket["logged_in"] + bucket["anonymous"]


def _add_aggregate_daily_rows(result, start_date, end_date):
    """补入已清理 raw 事件留下的日聚合；重叠桶由 raw 优先。"""
    start_dt = _day_start(start_date)
    end_dt = _day_start(end_date + timedelta(days=1))
    rows = MonitoringAggregate.objects.filter(
        granularity=MonitoringAggregate.Granularity.DAY,
        event_name=AGGREGATE_ALL_EVENT,
        bucket_start__gte=start_dt, bucket_start__lt=end_dt,
    )
    for row in rows:
        key = _event_day(row.bucket_start).isoformat()
        bucket = result.get(key)
        if not bucket:
            continue
        target = "logged_in" if row.audience == MonitoringEvent.Audience.USER else "anonymous"
        bucket[target] += row.people_count
        bucket["event_count"] += row.event_count
        bucket["all"] = bucket["logged_in"] + bucket["anonymous"]


def _day_start(value):
    raw = datetime.combine(value, datetime.min.time())
    return _make_aware_if_needed(raw)


def _hourly_payload(queryset, chosen):
    rows = (
        queryset.filter(day=chosen)
        .annotate(bucket=TruncHour("occurred_at", tzinfo=timezone.get_current_timezone() if settings.USE_TZ else None))
        .values("bucket", "audience")
        .annotate(
            event_count=Count("id"),
            user_people=Count("user_id", distinct=True),
            anon_people=Count("actor_hash", distinct=True),
        )
        .order_by("bucket", "audience")
    )
    buckets = {}
    for row in rows:
        bucket = row["bucket"]
        if not bucket:
            continue
        local = timezone.localtime(bucket) if timezone.is_aware(bucket) else bucket
        key = local.strftime("%H")
        item = buckets.setdefault(key, {"hour": f"{key}:00", "logged_in": 0, "anonymous": 0, "all": 0, "event_count": 0})
        people = row["user_people"] if row["audience"] == MonitoringEvent.Audience.USER else row["anon_people"]
        target = "logged_in" if row["audience"] == MonitoringEvent.Audience.USER else "anonymous"
        item[target] += people
        item["event_count"] += row["event_count"]
        item["all"] = item["logged_in"] + item["anonymous"]
    if not any(item["event_count"] for item in buckets.values()):
        start_dt = _day_start(chosen)
        end_dt = _day_start(chosen + timedelta(days=1))
        aggregate_rows = MonitoringAggregate.objects.filter(
            granularity=MonitoringAggregate.Granularity.HOUR,
            event_name=AGGREGATE_ALL_EVENT,
            bucket_start__gte=start_dt, bucket_start__lt=end_dt,
        )
        for row in aggregate_rows:
            local = timezone.localtime(row.bucket_start) if timezone.is_aware(row.bucket_start) else row.bucket_start
            key = local.strftime("%H")
            item = buckets.setdefault(key, {"hour": f"{key}:00", "logged_in": 0, "anonymous": 0, "all": 0, "event_count": 0})
            target = "logged_in" if row.audience == MonitoringEvent.Audience.USER else "anonymous"
            item[target] += row.people_count
            item["event_count"] += row.event_count
            item["all"] = item["logged_in"] + item["anonymous"]
    return [buckets.get(f"{hour:02d}", {"hour": f"{hour:02d}:00", "logged_in": 0, "anonymous": 0, "all": 0, "event_count": 0}) for hour in range(24)]


def _composition_payload(queryset, start_date, end_date):
    rows = (
        queryset.values("event_name", "audience")
        .annotate(
            event_count=Count("id"),
            user_people=Count("user_id", distinct=True),
            anon_people=Count("actor_hash", distinct=True),
        )
        .order_by("event_name", "audience")
    )
    grouped = {}
    for row in rows:
        name = row["event_name"]
        item = grouped.setdefault(name, {"event_name": name, "label": EVENT_LABELS.get(name, name), "people": 0, "count": 0})
        item["people"] += row["user_people"] if row["audience"] == MonitoringEvent.Audience.USER else row["anon_people"]
        item["count"] += row["event_count"]
    # 老于 raw 保留期的构成来自按事件维度保存的长期聚合；raw 与聚合不会
    # 重叠（清理按整日进行），因此可直接补入。
    raw_days = set(queryset.values_list("day", flat=True).distinct())
    aggregate_rows = MonitoringAggregate.objects.filter(
        granularity=MonitoringAggregate.Granularity.DAY,
        event_name__in=ALLOWED_EVENT_NAMES,
        bucket_start__gte=_day_start(start_date),
        bucket_start__lt=_day_start(end_date + timedelta(days=1)),
    )
    for row in aggregate_rows:
        if _event_day(row.bucket_start) in raw_days:
            continue
        name = row.event_name
        item = grouped.setdefault(name, {"event_name": name, "label": EVENT_LABELS.get(name, name), "people": 0, "count": 0})
        item["people"] += row.people_count
        item["count"] += row.event_count
    return sorted(grouped.values(), key=lambda item: (-item["count"], item["event_name"]))


def monitoring_events_payload(period="week", selected_date=None):
    """管理员行为看板 payload；所有人数都按对应主体在范围内去重。"""
    start_date, end_date, chosen = _period_range(period, selected_date)
    daily = _empty_daily(start_date, end_date)
    queryset = _event_queryset(start_date, end_date)
    _add_daily_rows(daily, queryset)
    # 只有 raw 表确实没有某天记录时才补日聚合，避免长期任务重复统计。
    raw_days = set(queryset.values_list("day", flat=True).distinct())
    aggregate_result = {key: value for key, value in daily.items() if date.fromisoformat(key) not in raw_days}
    _add_aggregate_daily_rows(aggregate_result, start_date, end_date)
    daily_rows = list(daily.values())
    launched = MonitoringEvent.objects.aggregate(value=Min("occurred_at"))["value"]
    if not launched:
        launched = MonitoringAggregate.objects.aggregate(value=Min("bucket_start"))["value"]
    selected = daily.get(chosen.isoformat(), {"date": chosen.isoformat(), "label": chosen.strftime("%m-%d"), "logged_in": 0, "anonymous": 0, "all": 0, "event_count": 0})
    return {
        "period": period,
        "period_label": {"day": "今天", "week": "近 7 天", "month": "近 30 天", "all": "全部已采集时间"}.get(period, "近 7 天"),
        "selected_date": selected["date"],
        "launched_at": _format_datetime(launched),
        "raw_retention_days": RAW_RETENTION_DAYS,
        "daily": daily_rows,
        "selected": selected,
        "hourly": _hourly_payload(queryset, chosen),
        "composition": _composition_payload(queryset, start_date, end_date),
        "event_count": sum(item["event_count"] for item in daily_rows),
        "has_events": bool(launched),
        "limited_by_retention": period == "all" and start_date > (launched.date() if launched else end_date),
        "message": "从部署后开始记录，不补算以前的数据。" if launched else "还没有记录到用户操作。",
    }


def _format_datetime(value):
    if not value:
        return ""
    local = timezone.localtime(value) if timezone.is_aware(value) else value
    return local.strftime("%Y-%m-%d %H:%M:%S")


@csrf_exempt
def api_monitoring_events(request):
    return ingest_monitoring_events(request)


def aggregate_monitoring_events(retention_days=RAW_RETENTION_DAYS, dry_run=False):
    """聚合并清理 raw 事件，供 management command 与定时任务调用。"""
    cutoff = _local_now() - timedelta(days=max(1, int(retention_days)))
    cutoff_date = _event_day(cutoff)
    base = MonitoringEvent.objects.filter(day__lt=cutoff_date)
    if not base.exists():
        return {"hourly": 0, "daily": 0, "deleted": 0, "dry_run": dry_run}
    hourly_rows = (
        base.annotate(bucket=TruncHour("occurred_at", tzinfo=timezone.get_current_timezone() if settings.USE_TZ else None))
        .values("bucket", "event_name", "audience")
        .annotate(event_count=Count("id"), user_people=Count("user_id", distinct=True), anon_people=Count("actor_hash", distinct=True))
    )
    daily_rows = (
        base.annotate(bucket=TruncDate("occurred_at", tzinfo=timezone.get_current_timezone() if settings.USE_TZ else None))
        .values("bucket", "event_name", "audience")
        .annotate(event_count=Count("id"), user_people=Count("user_id", distinct=True), anon_people=Count("actor_hash", distinct=True))
    )
    hourly_all_rows = (
        base.annotate(bucket=TruncHour("occurred_at", tzinfo=timezone.get_current_timezone() if settings.USE_TZ else None))
        .values("bucket", "audience")
        .annotate(event_count=Count("id"), user_people=Count("user_id", distinct=True), anon_people=Count("actor_hash", distinct=True))
    )
    daily_all_rows = (
        base.annotate(bucket=TruncDate("occurred_at", tzinfo=timezone.get_current_timezone() if settings.USE_TZ else None))
        .values("bucket", "audience")
        .annotate(event_count=Count("id"), user_people=Count("user_id", distinct=True), anon_people=Count("actor_hash", distinct=True))
    )
    if dry_run:
        return {"hourly": len(hourly_rows) + len(hourly_all_rows), "daily": len(daily_rows) + len(daily_all_rows), "deleted": base.count(), "dry_run": True}
    with transaction.atomic():
        for granularity, rows in ((MonitoringAggregate.Granularity.HOUR, hourly_rows), (MonitoringAggregate.Granularity.DAY, daily_rows)):
            for row in rows:
                bucket = row["bucket"]
                if bucket is None:
                    continue
                bucket = _make_aware_if_needed(bucket)
                people = row["user_people"] if row["audience"] == MonitoringEvent.Audience.USER else row["anon_people"]
                MonitoringAggregate.objects.update_or_create(
                    granularity=granularity,
                    bucket_start=bucket,
                    event_name=row["event_name"],
                    audience=row["audience"],
                    defaults={"event_count": row["event_count"], "people_count": people},
                )
        for granularity, rows in ((MonitoringAggregate.Granularity.HOUR, hourly_all_rows), (MonitoringAggregate.Granularity.DAY, daily_all_rows)):
            for row in rows:
                bucket = row["bucket"]
                if bucket is None:
                    continue
                bucket = _make_aware_if_needed(bucket)
                people = row["user_people"] if row["audience"] == MonitoringEvent.Audience.USER else row["anon_people"]
                MonitoringAggregate.objects.update_or_create(
                    granularity=granularity,
                    bucket_start=bucket,
                    event_name=AGGREGATE_ALL_EVENT,
                    audience=row["audience"],
                    defaults={"event_count": row["event_count"], "people_count": people},
                )
        deleted, _ = base.delete()
    return {"hourly": len(hourly_rows) + len(hourly_all_rows), "daily": len(daily_rows) + len(daily_all_rows), "deleted": deleted, "dry_run": False}
