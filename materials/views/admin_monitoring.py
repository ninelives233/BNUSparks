"""总管理员用户监测：趋势、身份分布、下载流水、运行状态与用户下载追溯。"""

import os
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from time import perf_counter

from django.conf import settings
from django.contrib.auth.models import User
from django.db import connection
from django.db.models import Count, Min, Q
from django.db.models.functions import TruncDate, TruncHour, TruncMonth
from django.shortcuts import get_object_or_404
from django.utils import timezone

from .utils import (
    _err, _ok, _safe_int, require_role,
    DownloadRecord, Material, UserProfile,
)
from ..models import TimetableImportRecord, UserTimetable


def _month_start(value):
    return value.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _local(value=None):
    value = value or timezone.now()
    return timezone.localtime(value) if timezone.is_aware(value) else value


def _day_start(value):
    result = datetime.combine(value, datetime.min.time())
    return timezone.make_aware(result) if settings.USE_TZ else result


def _next_month(value):
    if value.month == 12:
        return value.replace(year=value.year + 1, month=1)
    return value.replace(month=value.month + 1)


def _period_buckets(period):
    """返回 (起点, 桶类型, 桶列表, 显示名)。全部时间按自然月聚合。"""
    now = _local()
    if period == "day":
        end = now.replace(minute=0, second=0, microsecond=0)
        buckets = [end - timedelta(hours=i) for i in range(23, -1, -1)]
        return buckets[0], "hour", buckets, "近 24 小时"
    if period == "week":
        end = now.date()
        buckets = [end - timedelta(days=i) for i in range(6, -1, -1)]
        start = _day_start(buckets[0])
        return start, "day", buckets, "近 7 天"
    if period == "month":
        end = now.date()
        buckets = [end - timedelta(days=i) for i in range(29, -1, -1)]
        start = _day_start(buckets[0])
        return start, "day", buckets, "近 30 天"

    first_upload = Material.objects.aggregate(value=Min("created_at"))["value"]
    first_download = DownloadRecord.objects.aggregate(value=Min("created_at"))["value"]
    first_values = [v for v in (first_upload, first_download) if v]
    start = _month_start(_local(min(first_values))) if first_values else _month_start(now)
    end = _month_start(now)
    buckets = []
    cursor = start
    while cursor <= end:
        buckets.append(cursor)
        cursor = _next_month(cursor)
    return start, "month", buckets, "全部时间"


def _bucket_key(value, bucket_type):
    if bucket_type == "day":
        if isinstance(value, datetime):
            value = _local(value).date()
        return value.isoformat()
    local = _local(value)
    return local.strftime("%Y-%m-%d %H") if bucket_type == "hour" else local.strftime("%Y-%m")


def _bucket_label(value, bucket_type):
    if bucket_type == "hour":
        return value.strftime("%H:00")
    if bucket_type == "day":
        return f"{value.month:02d}-{value.day:02d}"
    return value.strftime("%Y-%m")


def _group_counts(model, start, bucket_type, query_filter=None):
    tz = timezone.get_current_timezone() if settings.USE_TZ else None
    trunc = {
        "hour": TruncHour("created_at", tzinfo=tz),
        "day": TruncDate("created_at", tzinfo=tz),
        "month": TruncMonth("created_at", tzinfo=tz),
    }[bucket_type]
    queryset = model.objects.filter(created_at__gte=start)
    if query_filter is not None:
        queryset = queryset.filter(query_filter)
    rows = (
        queryset
        .annotate(bucket=trunc)
        .values("bucket")
        .annotate(total=Count("id"))
        .order_by("bucket")
    )
    return {_bucket_key(row["bucket"], bucket_type): row["total"] for row in rows}


def _trend_payload(period):
    start, bucket_type, buckets, period_label = _period_buckets(period)
    upload_counts = _group_counts(Material, start, bucket_type)
    formal_filter = Q(activity_type__in=(
        DownloadRecord.ActivityType.LEGACY,
        DownloadRecord.ActivityType.DOWNLOAD,
    ))
    download_counts = _group_counts(DownloadRecord, start, bucket_type, formal_filter)
    upload_values = [upload_counts.get(_bucket_key(b, bucket_type), 0) for b in buckets]
    download_values = [download_counts.get(_bucket_key(b, bucket_type), 0) for b in buckets]
    uploads = Material.objects.filter(created_at__gte=start)
    downloads = DownloadRecord.objects.filter(created_at__gte=start).filter(formal_filter)
    previews = DownloadRecord.objects.filter(
        created_at__gte=start, activity_type=DownloadRecord.ActivityType.PREVIEW,
    )
    return {
        "period": period,
        "period_label": period_label,
        "labels": [_bucket_label(b, bucket_type) for b in buckets],
        "uploads": upload_values,
        "downloads": download_values,
        "summary": {
            "upload_count": sum(upload_values),
            "download_count": sum(download_values),
            "preview_count": previews.count(),
            "unique_uploaders": uploads.exclude(uploader_id=None).values("uploader_id").distinct().count(),
            "unique_downloaders": downloads.values("user_id").distinct().count(),
        },
    }


def _user_period_buckets(period):
    """按注册时间返回用户趋势的时间桶；全部时间按自然月聚合。"""
    now = _local()
    if period == "day":
        end = now.replace(minute=0, second=0, microsecond=0)
        buckets = [end - timedelta(hours=i) for i in range(23, -1, -1)]
        return buckets[0], "hour", buckets, "近 24 小时"
    if period == "week":
        end = now.date()
        buckets = [end - timedelta(days=i) for i in range(6, -1, -1)]
        return _day_start(buckets[0]), "day", buckets, "近 7 天"
    if period == "month":
        end = now.date()
        buckets = [end - timedelta(days=i) for i in range(29, -1, -1)]
        return _day_start(buckets[0]), "day", buckets, "近 30 天"

    first_user = User.objects.filter(is_active=True).aggregate(value=Min("date_joined"))["value"]
    start = _month_start(_local(first_user)) if first_user else _month_start(now)
    end = _month_start(now)
    buckets = []
    cursor = start
    while cursor <= end:
        buckets.append(cursor)
        cursor = _next_month(cursor)
    return start, "month", buckets, "全部时间"


def _group_user_counts(start, bucket_type):
    tz = timezone.get_current_timezone() if settings.USE_TZ else None
    trunc = {
        "hour": TruncHour("date_joined", tzinfo=tz),
        "day": TruncDate("date_joined", tzinfo=tz),
        "month": TruncMonth("date_joined", tzinfo=tz),
    }[bucket_type]
    rows = (
        User.objects.filter(is_active=True, date_joined__gte=start)
        .annotate(bucket=trunc)
        .values("bucket")
        .annotate(total=Count("id"))
        .order_by("bucket")
    )
    return {_bucket_key(row["bucket"], bucket_type): row["total"] for row in rows}


def _user_trend_payload(period):
    start, bucket_type, buckets, period_label = _user_period_buckets(period)
    new_counts = _group_user_counts(start, bucket_type)
    new_values = [new_counts.get(_bucket_key(bucket, bucket_type), 0) for bucket in buckets]
    running = User.objects.filter(is_active=True, date_joined__lt=start).count()
    total_values = []
    for value in new_values:
        running += value
        total_values.append(running)
    return {
        "period": period,
        "period_label": period_label,
        "labels": [_bucket_label(bucket, bucket_type) for bucket in buckets],
        "new_users": new_values,
        "total_users": total_values,
    }


def _identity_payload(period="month"):
    profiles = UserProfile.objects.filter(user__is_active=True)
    total = profiles.count()
    complete = profiles.exclude(identity_education="").exclude(identity_college="").exclude(identity_major="")
    tagged = complete.count()
    education_rows = list(
        profiles.exclude(identity_education="")
        .exclude(identity_education__in=("其他", "其它"))
        .values("identity_education")
        .annotate(count=Count("id"))
        .order_by("-count", "identity_education")
    )
    college_rows = list(
        profiles.exclude(identity_college="")
        .exclude(identity_college__in=("其他", "其它"))
        .values("identity_college")
        .annotate(count=Count("id"))
        .order_by("-count", "identity_college")
    )
    major_rows = (
        profiles.exclude(identity_college="")
        .exclude(identity_college__in=("其他", "其它"))
        .exclude(identity_major="")
        .exclude(identity_major__in=("其他", "其它"))
        .values("identity_college", "identity_major")
        .annotate(count=Count("id"))
        .order_by("identity_college", "-count", "identity_major")
    )
    majors = {}
    for row in major_rows:
        college = row["identity_college"]
        majors.setdefault(college, []).append({
            "name": row["identity_major"] or "专业未填写",
            "count": row["count"],
        })
    return {
        "total_users": total,
        "tagged_users": tagged,
        "untagged_users": max(0, total - tagged),
        "user_trend": _user_trend_payload(period),
        "education_levels": [
            {"name": row["identity_education"], "count": row["count"]}
            for row in education_rows
        ],
        "colleges": [
            {"name": row["identity_college"], "count": row["count"], "majors": majors.get(row["identity_college"], [])}
            for row in college_rows
        ],
    }


def _import_period_buckets(period):
    """按课表导入时间返回时间桶；全部时间按自然月聚合。"""
    now = _local()
    if period == "day":
        end = now.replace(minute=0, second=0, microsecond=0)
        buckets = [end - timedelta(hours=i) for i in range(23, -1, -1)]
        return buckets[0], "hour", buckets, "近 24 小时"
    if period == "week":
        end = now.date()
        buckets = [end - timedelta(days=i) for i in range(6, -1, -1)]
        return _day_start(buckets[0]), "day", buckets, "近 7 天"
    if period == "month":
        end = now.date()
        buckets = [end - timedelta(days=i) for i in range(29, -1, -1)]
        return _day_start(buckets[0]), "day", buckets, "近 30 天"

    first_import = TimetableImportRecord.objects.filter(
        user__is_active=True,
    ).aggregate(value=Min("created_at"))["value"]
    start = _month_start(_local(first_import)) if first_import else _month_start(now)
    end = _month_start(now)
    buckets = []
    cursor = start
    while cursor <= end:
        buckets.append(cursor)
        cursor = _next_month(cursor)
    return start, "month", buckets, "全部时间"


def _timetable_import_payload(period):
    start, bucket_type, buckets, period_label = _import_period_buckets(period)
    active_filter = Q(user__is_active=True)
    import_counts = _group_counts(TimetableImportRecord, start, bucket_type, active_filter)
    import_values = [import_counts.get(_bucket_key(bucket, bucket_type), 0) for bucket in buckets]
    period_qs = TimetableImportRecord.objects.filter(
        created_at__gte=start,
        user__is_active=True,
    )
    active_records = TimetableImportRecord.objects.filter(user__is_active=True)
    last_import = active_records.order_by("-created_at").first()
    # 导入记录不截断：管理者需要能够追溯所选时间范围内的完整行为。
    # 先按用户聚合，再把同一用户的所有导入事件放进 records，避免同一用户
    # 在列表里连续占据多行，同时保留每一次导入的时间与课程数。
    grouped = {}
    period_records = period_qs.select_related("user", "user__profile").order_by("-created_at", "-id")
    for record in period_records:
        profile = _profile_of(record.user)
        local_created = _local(record.created_at)
        group = grouped.get(record.user_id)
        if group is None:
            group = {
                "user_id": record.user_id,
                "nickname": record.user.first_name or record.user.username,
                "email": record.user.email,
                "education": profile.identity_education if profile else "",
                "college": profile.identity_college if profile else "",
                "major": profile.identity_major if profile else "",
                "import_count": 0,
                "latest_import_at": local_created.strftime("%Y-%m-%d %H:%M"),
                "latest_course_count": record.course_count,
                # 兼容旧版监测列表字段；新前端使用 records 展开明细。
                "course_count": record.course_count,
                "created_at": local_created.strftime("%Y-%m-%d %H:%M"),
                "records": [],
            }
            grouped[record.user_id] = group
        group["import_count"] += 1
        group["records"].append({
            "id": record.id,
            "course_count": record.course_count,
            "created_at": local_created.strftime("%Y-%m-%d %H:%M"),
        })
    import_users = sorted(
        grouped.values(),
        key=lambda item: (item["latest_import_at"], item["user_id"]),
        reverse=True,
    )
    return {
        "period": period,
        "period_label": period_label,
        "labels": [_bucket_label(bucket, bucket_type) for bucket in buckets],
        "imports": import_values,
        "summary": {
            "import_count": sum(import_values),
            "unique_users": period_qs.values("user_id").distinct().count(),
            "timetable_users": UserTimetable.objects.filter(user__is_active=True).count(),
            "last_import_at": _format_activity(last_import.created_at if last_import else None),
        },
        "import_users": import_users,
        # 保留旧键，便于旧版前端平滑升级；新前端使用 import_users。
        "recent_imports": import_users,
    }


def _profile_of(user):
    try:
        return user.profile
    except UserProfile.DoesNotExist:
        return None


def _download_page(qs, page, per_page):
    total = qs.count()
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, total_pages))
    items = []
    for record in qs[(page - 1) * per_page:page * per_page]:
        profile = _profile_of(record.user)
        local_created = _local(record.created_at)
        items.append({
            "id": record.id,
            "user_id": record.user_id,
            "nickname": record.user.first_name or record.user.username,
            "avatar_url": profile.avatar.url if profile and profile.avatar else "",
            "education": profile.identity_education if profile else "",
            "college": profile.identity_college if profile else "",
            "major": profile.identity_major if profile else "",
            "material_id": record.material_id,
            "material_title": record.material_title or record.file_name or "已删除资料",
            "file_name": record.file_name,
            "course_code": record.course_code,
            "course_name": record.course_name,
            "created_at": local_created.strftime("%Y-%m-%d %H:%M"),
            "date": local_created.strftime("%Y-%m-%d"),
            "can_open": record.material_id is not None,
            "activity_type": record.activity_type,
            "activity_label": {
                DownloadRecord.ActivityType.DOWNLOAD: "下载了",
                DownloadRecord.ActivityType.PREVIEW: "预览了",
                DownloadRecord.ActivityType.LEGACY: "访问了",
            }.get(record.activity_type, "访问了"),
        })
    return {"items": items, "total": total, "page": page, "total_pages": total_pages}


def _downloads_payload(request):
    page = _safe_int(request.GET.get("page"), 1, lo=1)
    qs = DownloadRecord.objects.select_related("user", "user__profile").order_by("-created_at", "-id")
    activity = (request.GET.get("activity") or "all").strip()
    if activity not in {"all", "download", "preview", "legacy"}:
        activity = "all"
    if activity != "all":
        qs = qs.filter(activity_type=activity)
    payload = _download_page(qs, page, 30)
    payload["activity"] = activity
    return payload


def _format_activity(value):
    return _local(value).strftime("%Y-%m-%d %H:%M") if value else "暂无"


def _health_payload():
    db_ok = False
    db_latency_ms = None
    started = perf_counter()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            db_ok = cursor.fetchone()[0] == 1
        db_latency_ms = round((perf_counter() - started) * 1000, 1)
    except Exception:
        db_ok = False

    media_root = Path(settings.MEDIA_ROOT)
    storage_exists = media_root.exists()
    storage_writable = storage_exists and os.access(media_root, os.W_OK)
    usage_path = media_root if storage_exists else media_root.parent
    try:
        usage = shutil.disk_usage(usage_path)
        total_bytes, free_bytes = usage.total, usage.free
        used_percent = round((usage.used / usage.total) * 100, 1) if usage.total else 0
    except OSError:
        total_bytes, free_bytes, used_percent = 0, 0, 100

    if not db_ok or not storage_exists or not storage_writable:
        overall = "critical"
    elif used_percent >= 90:
        overall = "warning"
    else:
        overall = "healthy"

    db_name = settings.DATABASES["default"].get("NAME")
    db_path = Path(str(db_name)) if db_name and str(db_name) != ":memory:" else None
    db_size = db_path.stat().st_size if db_path and db_path.exists() else 0
    last_upload = Material.objects.order_by("-created_at").values_list("created_at", flat=True).first()
    last_download = DownloadRecord.objects.filter(activity_type__in=(
        DownloadRecord.ActivityType.LEGACY,
        DownloadRecord.ActivityType.DOWNLOAD,
    )).order_by("-created_at").values_list("created_at", flat=True).first()
    return {
        "overall": overall,
        "checked_at": _local().strftime("%Y-%m-%d %H:%M:%S"),
        "application": {"ok": True},
        "database": {"ok": db_ok, "vendor": connection.vendor, "latency_ms": db_latency_ms, "size_bytes": db_size},
        "storage": {
            "ok": storage_exists and storage_writable,
            "exists": storage_exists,
            "writable": storage_writable,
            "total_bytes": total_bytes,
            "free_bytes": free_bytes,
            "used_percent": used_percent,
        },
        "activity": {"last_upload_at": _format_activity(last_upload), "last_download_at": _format_activity(last_download)},
    }


@require_role(UserProfile.Role.SUPER_ADMIN)
def api_admin_monitoring(request):
    """GET /api/admin/monitoring/?section=trend|identity|timetable|downloads|health。"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    section = (request.GET.get("section") or "trend").strip()
    if section == "trend":
        period = (request.GET.get("period") or "week").strip()
        if period not in {"day", "week", "month", "all"}:
            return _err("无效的时间范围")
        return _ok(_trend_payload(period))
    if section == "identity":
        period = (request.GET.get("period") or "month").strip()
        if period not in {"day", "week", "month", "all"}:
            return _err("无效的时间范围")
        return _ok(_identity_payload(period))
    if section == "timetable":
        period = (request.GET.get("period") or "month").strip()
        if period not in {"day", "week", "month", "all"}:
            return _err("无效的时间范围")
        return _ok(_timetable_import_payload(period))
    if section == "downloads":
        return _ok(_downloads_payload(request))
    if section == "health":
        return _ok(_health_payload())
    return _err("无效的监测分区")


@require_role(UserProfile.Role.SUPER_ADMIN)
def api_admin_user_downloads(request, uid):
    """GET /api/admin/users/<uid>/downloads/ — 总管理员追溯单个用户下载记录。"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    user = get_object_or_404(User, id=uid, is_active=True)
    page = _safe_int(request.GET.get("page"), 1, lo=1)
    qs = DownloadRecord.objects.filter(user=user).select_related("user", "user__profile").order_by("-created_at", "-id")
    payload = _download_page(qs, page, 20)
    payload["user"] = {"id": user.id, "nickname": user.first_name or user.username}
    return _ok(payload)


@require_role(UserProfile.Role.SUPER_ADMIN)
def api_admin_user_timetable(request, uid):
    """GET /api/admin/users/<uid>/timetable/ — 总管理员查看用户课表。"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    user = get_object_or_404(User, id=uid, is_active=True)
    profile = _profile_of(user)
    row = UserTimetable.objects.filter(user=user).first()
    return _ok({
        "user": {
            "id": user.id,
            "nickname": user.first_name or user.username,
            "education": profile.identity_education if profile else "",
            "college": profile.identity_college if profile else "",
            "major": profile.identity_major if profile else "",
        },
        "data": row.data if row else None,
        "updated_at": _format_activity(row.updated_at if row else None),
    })
