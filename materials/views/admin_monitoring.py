"""总管理员用户监测：趋势、身份分布、下载流水、运行状态与用户下载追溯。"""

import os
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from time import perf_counter

from django.conf import settings
from django.contrib.auth.models import User
from django.db import DatabaseError, connection
from django.db.models import Count, Min, Q
from django.db.models.functions import TruncDate, TruncHour, TruncMonth
from django.shortcuts import get_object_or_404
from django.utils import timezone

from .utils import (
    _err, _ok, _safe_int, require_role,
    DownloadRecord, Material, UserProfile,
)
from ..models import (
    CourseCreationRequest,
    Report,
    TimetableImportRecord,
    UserTimetable,
)
from ..monitoring_events import monitoring_events_payload


# 监测接口只服务于管理员诊断，不允许请求参数把 SQLite 查询或 Python
# 序列化扩张成无界操作。页码上限保留足够的人工追溯空间，同时避免深 OFFSET。
MONITOR_MAX_PAGE = 100
MONITOR_TIMETABLE_RECORD_LIMIT = 1000


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
    preview_filter = Q(activity_type=DownloadRecord.ActivityType.PREVIEW)
    preview_counts = _group_counts(DownloadRecord, start, bucket_type, preview_filter)
    upload_values = [upload_counts.get(_bucket_key(b, bucket_type), 0) for b in buckets]
    download_values = [download_counts.get(_bucket_key(b, bucket_type), 0) for b in buckets]
    preview_values = [preview_counts.get(_bucket_key(b, bucket_type), 0) for b in buckets]
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
        "previews": preview_values,
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


def _identity_payload(period="month", education=None):
    profiles = UserProfile.objects.filter(user__is_active=True)
    total = profiles.count()
    if education:
        # 培养层次筛选：只影响学院/专业/覆盖统计；层次卡片与用户趋势保持全局口径。
        profiles = profiles.filter(identity_education=education)
    complete = profiles.exclude(identity_education="").exclude(identity_college="").exclude(identity_major="")
    tagged = complete.count()
    # 层次分布始终全局统计，保证筛选后仍可切换其他层次。
    education_rows = list(
        UserProfile.objects.filter(user__is_active=True)
        .exclude(identity_education="")
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
    # 校区分布始终全局统计（口径同培养层次），不受培养层次筛选影响。
    campus_labels = dict(UserProfile.Campus.choices)
    campus_rows = (
        UserProfile.objects.filter(user__is_active=True)
        .values("campus")
        .annotate(count=Count("id"))
        .order_by("-count")
    )
    campus_distribution = [
        {"key": row["campus"], "name": campus_labels.get(row["campus"], row["campus"]), "count": row["count"]}
        for row in campus_rows
    ]
    return {
        "total_users": total,
        "education_filter": education or "",
        "tagged_users": tagged,
        "untagged_users": max(0, total - tagged),
        "campus_distribution": campus_distribution,
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
    period_record_total = period_qs.count()
    active_records = TimetableImportRecord.objects.filter(user__is_active=True)
    last_import = active_records.order_by("-created_at").first()
    # 记录明细必须在 SQL 层限量；统计总数仍来自数据库聚合，避免「全部时间」
    # 把任意数量的行装入 Python 内存。后续 UI 可用 metadata 提示管理员继续
    # 缩小时间范围，而不是默默伪装成完整列表。
    period_records = list(
        period_qs.select_related("user", "user__profile")
        .order_by("-created_at", "-id")[:MONITOR_TIMETABLE_RECORD_LIMIT]
    )
    # 先按用户聚合，再把同一用户的导入事件放进 records，避免同一用户在列表
    # 里连续占据多行，同时保留每一次导入的时间与课程数。
    grouped = {}
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
        "records_meta": {
            "total": period_record_total,
            "returned": len(period_records),
            "limit": MONITOR_TIMETABLE_RECORD_LIMIT,
            "truncated": period_record_total > MONITOR_TIMETABLE_RECORD_LIMIT,
        },
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
    visible_total_pages = min(total_pages, MONITOR_MAX_PAGE)
    page = max(1, min(page, visible_total_pages))
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
    return {
        "items": items,
        "total": total,
        "page": page,
        "total_pages": visible_total_pages,
        "page_limit": MONITOR_MAX_PAGE,
        "truncated": total_pages > MONITOR_MAX_PAGE,
    }


def _downloads_payload(request):
    page = _safe_int(request.GET.get("page"), 1, lo=1, hi=MONITOR_MAX_PAGE)
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


def _health_payload(period="week"):
    db_ok = False
    db_latency_ms = None
    activity_ok = False
    started = perf_counter()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            db_ok = cursor.fetchone()[0] == 1
        db_latency_ms = round((perf_counter() - started) * 1000, 1)
    except Exception:
        db_ok = False

    activity_ok = db_ok

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
    try:
        db_size = db_path.stat().st_size if db_path and db_path.exists() else 0
    except OSError:
        db_size = 0

    # SELECT 1 失败时不能继续做 ORM 查询，否则健康接口会在报告故障前再次 500。
    # 即使探针成功，最近活动查询也单独兜底，避免锁等待/损坏数据影响诊断入口。
    last_upload = None
    last_preview = None
    last_download = None
    last_timetable_import = None
    trend = None
    timetable = None
    recorded_user_ids = set()
    backlog = {
        "pending_materials": 0,
        "pending_reports": 0,
        "pending_course_requests": 0,
        "oldest_pending_at": None,
        "oldest_pending_seconds": None,
    }
    if db_ok:
        try:
            last_upload = Material.objects.order_by("-created_at").values_list("created_at", flat=True).first()
            last_preview = DownloadRecord.objects.filter(
                activity_type=DownloadRecord.ActivityType.PREVIEW,
            ).order_by("-created_at").values_list("created_at", flat=True).first()
            last_timetable_import = TimetableImportRecord.objects.order_by(
                "-created_at",
            ).values_list("created_at", flat=True).first()
        except Exception:
            activity_ok = False
        try:
            last_download = DownloadRecord.objects.filter(activity_type__in=(
                DownloadRecord.ActivityType.LEGACY,
                DownloadRecord.ActivityType.DOWNLOAD,
            )).order_by("-created_at").values_list("created_at", flat=True).first()
        except Exception:
            activity_ok = False
        try:
            trend = _trend_payload(period)
            trend_start, _, _, _ = _period_buckets(period)
            timetable_start, timetable_bucket, timetable_buckets, timetable_label = _import_period_buckets(period)
            # 「全部时间」的起点分别按行为表计算；去重用户时取两者较早值，
            # 避免仅有课表导入、没有上传/下载的账号被错误排除。
            recorded_start = min(trend_start, timetable_start)
            timetable_counts = _group_counts(
                TimetableImportRecord,
                timetable_start,
                timetable_bucket,
                Q(user__is_active=True),
            )
            timetable_values = [
                timetable_counts.get(_bucket_key(bucket, timetable_bucket), 0)
                for bucket in timetable_buckets
            ]
            timetable = {
                "period": period,
                "period_label": timetable_label,
                "labels": [_bucket_label(bucket, timetable_bucket) for bucket in timetable_buckets],
                "imports": timetable_values,
                "summary": {
                    "import_count": sum(timetable_values),
                    "unique_users": TimetableImportRecord.objects.filter(
                        created_at__gte=timetable_start,
                        user__is_active=True,
                    ).values("user_id").distinct().count(),
                    "last_import_at": _format_activity(last_timetable_import),
                },
            }
            upload_users = Material.objects.filter(
                created_at__gte=recorded_start,
                uploader_id__isnull=False,
                uploader__is_active=True,
            ).values_list("uploader_id", flat=True).distinct()
            activity_users = DownloadRecord.objects.filter(
                created_at__gte=recorded_start,
                user__is_active=True,
            ).values_list("user_id", flat=True).distinct()
            timetable_users = TimetableImportRecord.objects.filter(
                created_at__gte=recorded_start,
                user__is_active=True,
            ).values_list("user_id", flat=True).distinct()
            recorded_user_ids.update(upload_users)
            recorded_user_ids.update(activity_users)
            recorded_user_ids.update(timetable_users)
        except Exception:
            activity_ok = False
        try:
            pending_materials = Material.objects.filter(review_status="pending")
            pending_reports = Report.objects.filter(status=Report.Status.PENDING)
            pending_course_requests = CourseCreationRequest.objects.filter(
                status=CourseCreationRequest.Status.PENDING,
            )
            pending_times = [
                value for value in (
                    pending_materials.aggregate(value=Min("created_at"))["value"],
                    pending_reports.aggregate(value=Min("created_at"))["value"],
                    pending_course_requests.aggregate(value=Min("created_at"))["value"],
                ) if value
            ]
            oldest_pending = min(pending_times) if pending_times else None
            backlog.update({
                "pending_materials": pending_materials.count(),
                "pending_reports": pending_reports.count(),
                "pending_course_requests": pending_course_requests.count(),
                "oldest_pending_at": _format_activity(oldest_pending) if oldest_pending else None,
                "oldest_pending_seconds": max(
                    0,
                    int((timezone.now() - oldest_pending).total_seconds()),
                ) if oldest_pending else None,
            })
        except Exception:
            activity_ok = False

    if db_ok and not activity_ok:
        overall = "warning"
    if trend is None:
        trend = {
            "period": period,
            "period_label": "",
            "labels": [],
            "uploads": [],
            "downloads": [],
            "previews": [],
            "summary": {},
        }
    if timetable is None:
        timetable = {
            "period": period,
            "period_label": "",
            "labels": [],
            "imports": [],
            "summary": {},
        }
    recorded_users = len(recorded_user_ids)
    recorded_status = "available" if recorded_users else "empty"
    return {
        "overall": overall,
        "checked_at": _local().strftime("%Y-%m-%d %H:%M:%S"),
        "period": period,
        "application": {"ok": True},
        "database": {
            "ok": db_ok,
            "query_ok": activity_ok,
            "vendor": connection.vendor,
            "latency_ms": db_latency_ms,
            "size_bytes": db_size,
        },
        "storage": {
            "ok": storage_exists and storage_writable,
            "exists": storage_exists,
            "writable": storage_writable,
            "total_bytes": total_bytes,
            "free_bytes": free_bytes,
            "used_percent": used_percent,
        },
        "activity": {
            "ok": activity_ok,
            "last_upload_at": _format_activity(last_upload),
            "last_preview_at": _format_activity(last_preview),
            "last_download_at": _format_activity(last_download),
            "last_timetable_import_at": _format_activity(last_timetable_import),
            "recorded_users": recorded_users,
            "recorded_users_status": recorded_status if db_ok else "unavailable",
        },
        "trend": trend,
        "timetable": timetable,
        "backlog": backlog,
    }


@require_role(UserProfile.Role.SUPER_ADMIN)
def api_admin_monitoring(request):
    """GET /api/admin/monitoring/?section=trend|identity|timetable|downloads|health|events。"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    section = (request.GET.get("section") or "trend").strip()
    try:
        if section == "trend":
            period = (request.GET.get("period") or "week").strip()
            if period not in {"day", "week", "month", "all"}:
                return _err("无效的时间范围")
            return _ok(_trend_payload(period))
        if section == "identity":
            period = (request.GET.get("period") or "month").strip()
            if period not in {"day", "week", "month", "all"}:
                return _err("无效的时间范围")
            education = (request.GET.get("education") or "").strip()
            return _ok(_identity_payload(period, education=education or None))
        if section == "timetable":
            period = (request.GET.get("period") or "month").strip()
            if period not in {"day", "week", "month", "all"}:
                return _err("无效的时间范围")
            return _ok(_timetable_import_payload(period))
        if section == "downloads":
            return _ok(_downloads_payload(request))
        if section == "health":
            period = (request.GET.get("period") or "week").strip()
            if period not in {"day", "week", "month", "all"}:
                return _err("无效的时间范围")
            return _ok(_health_payload(period))
        if section == "events":
            period = (request.GET.get("period") or "week").strip()
            if period not in {"day", "week", "month", "all"}:
                return _err("无效的时间范围")
            selected_raw = (request.GET.get("date") or "").strip()
            selected_date = None
            if selected_raw:
                try:
                    selected_date = datetime.strptime(selected_raw, "%Y-%m-%d").date()
                except ValueError:
                    return _err("无效的日期")
            return _ok(monitoring_events_payload(period, selected_date=selected_date))
    except DatabaseError:
        # SQLite 锁等待/连接故障只返回可识别的服务不可用，不把异常堆栈泄露给前端。
        return _err("监测数据暂时不可用，请稍后重试", 503)
    return _err("无效的监测分区")


@require_role(UserProfile.Role.SUPER_ADMIN)
def api_admin_user_downloads(request, uid):
    """GET /api/admin/users/<uid>/downloads/ — 总管理员追溯单个用户下载记录。"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    try:
        user = get_object_or_404(User, id=uid, is_active=True)
        page = _safe_int(request.GET.get("page"), 1, lo=1, hi=MONITOR_MAX_PAGE)
        qs = DownloadRecord.objects.filter(user=user).select_related("user", "user__profile").order_by("-created_at", "-id")
        payload = _download_page(qs, page, 20)
    except DatabaseError:
        return _err("访问流水暂时不可用，请稍后重试", 503)
    payload["user"] = {"id": user.id, "nickname": user.first_name or user.username}
    return _ok(payload)


@require_role(UserProfile.Role.SUPER_ADMIN)
def api_admin_user_timetable(request, uid):
    """GET /api/admin/users/<uid>/timetable/ — 总管理员查看用户课表。"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    try:
        user = get_object_or_404(User, id=uid, is_active=True)
        profile = _profile_of(user)
        row = UserTimetable.objects.filter(user=user).first()
    except DatabaseError:
        return _err("用户课表暂时不可用，请稍后重试", 503)
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
