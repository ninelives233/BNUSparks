"""
BNU Sparks · 木铎星火 — 每日配额辅助（下载/举报限额）
"""

from datetime import date

from django.db.models import F

from ..models import DownloadRecord, UserProfile

from .utils_auth import _get_or_create_profile

# 普通用户每日下载限额（版主/总管理员豁免）
DAILY_DOWNLOAD_LIMIT = 15

# 普通用户每日举报限额（管理员豁免，隐性计数不展示前端）
DAILY_REPORT_LIMIT = 15

# 后备开关（默认关闭）：版主/小版主在辖区外上传 → 走 pending 正常审核，而非无条件自审。
# 当前维持现状（辖区外也自动过审）；后续如启用只需改为 True，配合 _user_covers_course。
ENFORCE_UPLOAD_SCOPE = False


# ═══════════════════════════════════════════════════════════════
# 下载配额
# ═══════════════════════════════════════════════════════════════

def _check_download_quota(user, material=None):
    """检查并扣除下载配额，返回 (allowed, remaining, message)

    daily_download_count 语义 = 「当天已下载的不同文件数」。
    传入 material 时：同一天同一文件只计一次数——今天已下载过的文件再次
    下载直接放行不扣配额（下载失败后重试、重复下载都不重复计数）。
    文件不存在等失败场景在调用方已前置拦截（不进入本函数）。
    """
    profile = _get_or_create_profile(user)
    # 限额只对普通用户生效，其余角色（小版主/版主/总管理员）不限量
    if profile.role != UserProfile.Role.USER:
        return True, -1, ""

    today = date.today()
    if profile.last_download_date != today:
        UserProfile.objects.filter(user=user).update(
            daily_download_count=0,
            last_download_date=today,
        )
        profile.refresh_from_db()

    # 同一天同一文件只计一次数：今天已下载过 → 不重复扣配额，直接放行
    if material is not None and DownloadRecord.objects.filter(
        user=user, material_id=material.id, created_at__date=today
    ).exists():
        remaining = DAILY_DOWNLOAD_LIMIT - profile.daily_download_count
        return True, remaining, ""

    if profile.daily_download_count >= DAILY_DOWNLOAD_LIMIT:
        return False, 0, f"今日下载次数已达上限（{DAILY_DOWNLOAD_LIMIT} 次）"

    UserProfile.objects.filter(user=user).update(
        daily_download_count=F('daily_download_count') + 1,
        last_download_date=today,
    )
    profile.refresh_from_db()
    remaining = DAILY_DOWNLOAD_LIMIT - profile.daily_download_count
    return True, remaining, ""


def _check_report_quota(user):
    """检查并扣除每日举报配额，返回 (allowed, remaining, message)。

    daily_report_count = 「当日已提交的举报次数」（连带举报在同一 POST 内只计 1 次）。
    跨天用 .update() 重置、F() 原子递增（并发安全）。仅普通用户限量，管理员豁免。
    """
    profile = _get_or_create_profile(user)
    # 限额只对普通用户生效，其余角色（小版主/版主/总管理员）不限量
    if profile.role != UserProfile.Role.USER:
        return True, -1, ""

    today = date.today()
    if profile.last_report_date != today:
        UserProfile.objects.filter(user=user).update(
            daily_report_count=0,
            last_report_date=today,
        )
        profile.refresh_from_db()

    if profile.daily_report_count >= DAILY_REPORT_LIMIT:
        return False, 0, "今日举报次数过多"

    UserProfile.objects.filter(user=user).update(
        daily_report_count=F('daily_report_count') + 1,
        last_report_date=today,
    )
    profile.refresh_from_db()
    remaining = DAILY_REPORT_LIMIT - profile.daily_report_count
    return True, remaining, ""


