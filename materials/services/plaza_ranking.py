"""广场公共排序：累计使用、有效收藏、近期去重热度及少量新资料/实用目录加权。

与首页的个人召回分开；不读取课表，不生成或修改公开下载/收藏计数。
固定饱和基准使同一资料的分数不受当前筛选池大小影响。
"""

import math
from datetime import timedelta

from django.db.models import Count, F, Q

from ..models import DownloadRecord, Favorite


WEIGHTS = {"downloads": .30, "favorites": .30, "heat": .25, "freshness": .08, "practical": .07}


def interaction_signals(material_ids, now):
    """按资料批量聚合；近 7/30 天每用户每种行为只算一次，排除作者和脚本账号。"""
    week, month = now - timedelta(days=7), now - timedelta(days=30)
    excluded = Q(user_id=F("material__uploader_id")) | Q(user__email__iendswith="@test.com")
    records = DownloadRecord.objects.filter(
        material_id__in=material_ids, created_at__gte=month, created_at__lte=now,
    ).exclude(excluded).order_by()
    downloads = Q(activity_type__in=(DownloadRecord.ActivityType.DOWNLOAD, DownloadRecord.ActivityType.LEGACY))
    previews = Q(activity_type=DownloadRecord.ActivityType.PREVIEW)
    signals = {}
    for row in records.values("material_id").annotate(
        downloads_month=Count("user_id", distinct=True, filter=downloads),
        downloads_week=Count("user_id", distinct=True, filter=downloads & Q(created_at__gte=week)),
        previews_week=Count("user_id", distinct=True, filter=previews & Q(created_at__gte=week)),
    ):
        signals[row["material_id"]] = {
            "heat": row["downloads_month"] + 2 * row["downloads_week"] + .25 * row["previews_week"],
            "favorites": 0,
        }
    for row in Favorite.objects.filter(
        material_id__in=material_ids, created_at__lte=now,
    ).exclude(excluded).order_by().values("material_id").annotate(
        total=Count("user_id", distinct=True),
        month=Count("user_id", distinct=True, filter=Q(created_at__gte=month)),
        week=Count("user_id", distinct=True, filter=Q(created_at__gte=week)),
    ):
        signal = signals.setdefault(row["material_id"], {"heat": 0, "favorites": 0})
        signal["favorites"] = row["total"]
        signal["heat"] += row["month"] + 3 * row["week"]
    return signals


def _saturate(value, benchmark):
    return min(1.0, math.log1p(max(0, value)) / math.log1p(benchmark))


def material_score(row, signal, practical, now):
    age = max(0.0, (now - row["created_at"]).total_seconds() / 86400)
    return (
        WEIGHTS["downloads"] * _saturate(row["download_count"] or 0, 500)
        + WEIGHTS["favorites"] * _saturate(signal.get("favorites", 0), 30)
        + WEIGHTS["heat"] * _saturate(signal.get("heat", 0), 80)
        + WEIGHTS["freshness"] * 0.5 ** (age / 45)
        + WEIGHTS["practical"] * bool(practical)
    )
