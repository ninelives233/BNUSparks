"""校内文件加速站的公网侧状态与票据辅助。

公网始终是唯一数据库、审核入口和权威文件源；校内节点只保存已过审文件的
镜像（``public_to_campus``），校内上传与在线预览都留在主站。

本模块只做四件事：
- 签发/读取短时下载票据；
- 维护 Material 的镜像状态和持久同步任务；
- 任务状态机（领取、进度、完成、失败退避）；
- 生成供校内节点比对的 manifest。
"""

from __future__ import annotations

import math
import secrets
from datetime import datetime, timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from ..models import Material, MaterialSyncTask

ACTIVE_TASK_STATUSES = (
    MaterialSyncTask.Status.PENDING,
    MaterialSyncTask.Status.TRANSFERRING,
    MaterialSyncTask.Status.VERIFYING,
)

DOWNLOAD_TICKET_PREFIX = "accelerator:download:"

# 失败退避：1 分钟、5 分钟、15 分钟、1 小时、4 小时；达到上限后停在 error
# 等人工处理，避免校内节点不可达时无限重试。
RETRY_BACKOFF_SECONDS = (60, 300, 900, 3600, 4 * 3600)


def accelerator_enabled():
    return bool(
        getattr(settings, "ACCELERATOR_BASE_URL", "")
        and getattr(settings, "ACCELERATOR_INTERNAL_SECRET", "")
    )


def accelerator_base_url():
    return str(getattr(settings, "ACCELERATOR_BASE_URL", "") or "").rstrip("/")


def internal_secret():
    return str(getattr(settings, "ACCELERATOR_INTERNAL_SECRET", "") or "")


def ticket_ttl():
    return int(getattr(settings, "ACCELERATOR_TICKET_TTL", 30 * 60))


def _download_key(token):
    return f"{DOWNLOAD_TICKET_PREFIX}{token}"


def issue_download_ticket(user, material):
    """签发短时下载票据。

    票据在 TTL 内可以重复使用：浏览器 Range 请求、校内 Nginx 302 回退都会
    再次校验同一票据。配额与下载量依靠 ``DownloadRecord.request_id`` 的
    唯一约束保证幂等，只计一次。
    """
    token = secrets.token_urlsafe(24)
    now = timezone.now()
    payload = {
        "user_id": user.id,
        "material_id": material.id,
        "token_version": getattr(getattr(user, "profile", None), "token_version", 0) or 0,
        "issued_at": now.isoformat(),
        "expires_at": (now + timedelta(seconds=ticket_ttl())).isoformat(),
    }
    cache.set(_download_key(token), payload, ticket_ttl())
    return token, payload


def get_download_ticket(token):
    if not token or len(str(token)) > 128:
        return None
    try:
        payload = cache.get(_download_key(str(token)))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    try:
        expires_at = datetime.fromisoformat(payload.get("expires_at", ""))
    except (TypeError, ValueError):
        return None
    now = timezone.now()
    if timezone.is_naive(expires_at) != timezone.is_naive(now):
        if timezone.is_naive(expires_at):
            expires_at = timezone.make_aware(expires_at, timezone.get_current_timezone())
        else:
            expires_at = timezone.make_naive(expires_at, timezone.get_current_timezone())
    if expires_at <= now:
        return None
    return payload


def ticket_matches_material(payload, material):
    return bool(payload and int(payload.get("material_id") or 0) == material.id)


def resolve_ticket_user(payload):
    """票据只证明签发时的用户；仍须核对账号有效性与 token_version。"""
    if not payload:
        return None
    from django.contrib.auth.models import User

    user = User.objects.filter(
        id=payload.get("user_id"), is_active=True,
    ).first()
    if user is None:
        return None
    current_version = user.profile.token_version if hasattr(user, "profile") else 0
    if int(payload.get("token_version") or 0) != int(current_version or 0):
        return None
    return user


def ticket_url(token):
    return f"{accelerator_base_url()}/f/{token}"


def _set_material_sync(material, *, status, direction, synced_at=None):
    Material.objects.filter(pk=material.pk).update(
        file_sync_direction=direction,
        file_sync_status=status,
        file_synced_at=synced_at,
    )
    material.file_sync_direction = direction
    material.file_sync_status = status
    material.file_synced_at = synced_at


def queue_public_to_campus(material, *, priority=100):
    """为已过审资料创建/复用公网→校内镜像任务。

    未过审资料普通用户无权下载，不提前镜像；等审核通过时再次调用。
    加速站未启用时保持 ``none/synced``，不改变单机行为。
    """
    if material.review_status != "approved":
        return None

    if not accelerator_enabled():
        _set_material_sync(
            material,
            status=Material.FileSyncStatus.SYNCED,
            direction=Material.FileSyncDirection.NONE,
            synced_at=timezone.now(),
        )
        return None

    direction = MaterialSyncTask.Direction.PUBLIC_TO_CAMPUS
    task = MaterialSyncTask.objects.filter(
        material=material, direction=direction, status__in=ACTIVE_TASK_STATUSES,
    ).order_by("-id").first()
    if task is None:
        task = MaterialSyncTask.objects.create(
            material=material,
            direction=direction,
            status=MaterialSyncTask.Status.PENDING,
            priority=priority,
            total_bytes=max(0, material.file_size or 0),
            sha256=material.file_sha256 or "",
        )
    else:
        update_fields = []
        if task.priority != priority:
            task.priority = priority
            update_fields.append("priority")
        if task.total_bytes != max(0, material.file_size or 0):
            task.total_bytes = max(0, material.file_size or 0)
            update_fields.append("total_bytes")
        if material.file_sha256 and task.sha256 != material.file_sha256:
            task.sha256 = material.file_sha256
            update_fields.append("sha256")
        if update_fields:
            task.save(update_fields=update_fields)

    status_map = {
        MaterialSyncTask.Status.PENDING: Material.FileSyncStatus.PENDING,
        MaterialSyncTask.Status.TRANSFERRING: Material.FileSyncStatus.TRANSFERRING,
        MaterialSyncTask.Status.VERIFYING: Material.FileSyncStatus.VERIFYING,
    }
    _set_material_sync(
        material,
        status=status_map.get(task.status, Material.FileSyncStatus.PENDING),
        direction=Material.FileSyncDirection.PUBLIC_TO_CAMPUS,
        synced_at=None,
    )
    return task


def cancel_active_tasks(material, *, reason="任务已取消"):
    """取消资料所有未结束任务（例如资料被驳回或删除）。"""
    now = timezone.now()
    with transaction.atomic():
        MaterialSyncTask.objects.filter(
            material=material, status__in=ACTIVE_TASK_STATUSES,
        ).update(
            status=MaterialSyncTask.Status.CANCELLED,
            last_error=reason,
            finished_at=now,
            updated_at=now,
            lease_owner="",
            lease_expires_at=None,
            next_retry_at=None,
        )


def latest_task(material):
    return MaterialSyncTask.objects.filter(material=material).order_by("-id").first()


def task_eta_seconds(task):
    if task is None or task.status not in (
        MaterialSyncTask.Status.TRANSFERRING,
        MaterialSyncTask.Status.VERIFYING,
    ):
        return None
    if not task.started_at or task.bytes_done <= 0 or task.total_bytes <= 0:
        return None
    elapsed = (timezone.now() - task.started_at).total_seconds()
    if elapsed <= 0:
        return None
    rate = task.bytes_done / elapsed
    if rate <= 0:
        return None
    remaining = max(0, task.total_bytes - task.bytes_done)
    return int(math.ceil(remaining / rate))


def revive_retryable_tasks():
    """把到期的 error 任务重新置为 pending，返回复活数量。"""
    now = timezone.now()
    qs = MaterialSyncTask.objects.filter(
        status=MaterialSyncTask.Status.ERROR,
        attempts__lt=MaterialSyncTask.MAX_ATTEMPTS,
    ).filter(Q(next_retry_at__isnull=True) | Q(next_retry_at__lte=now))
    ids = list(qs.values_list("id", flat=True))
    if not ids:
        return 0
    with transaction.atomic():
        updated = MaterialSyncTask.objects.filter(
            id__in=ids, status=MaterialSyncTask.Status.ERROR,
        ).update(
            status=MaterialSyncTask.Status.PENDING,
            next_retry_at=None,
            lease_owner="",
            lease_expires_at=None,
        )
        if updated:
            Material.objects.filter(
                sync_tasks__id__in=ids,
                file_sync_status=Material.FileSyncStatus.ERROR,
            ).update(file_sync_status=Material.FileSyncStatus.PENDING)
    return updated


def mark_task_started(task, owner="campus-agent"):
    now = timezone.now()
    with transaction.atomic():
        updated = MaterialSyncTask.objects.filter(
            pk=task.pk, status=MaterialSyncTask.Status.PENDING,
        ).update(
            status=MaterialSyncTask.Status.TRANSFERRING,
            lease_owner=owner,
            lease_expires_at=now + timedelta(minutes=30),
            started_at=now,
            updated_at=now,
            attempts=task.attempts + 1,
            last_error="",
            next_retry_at=None,
        )
        if updated:
            Material.objects.filter(pk=task.material_id).update(
                file_sync_status=Material.FileSyncStatus.TRANSFERRING,
            )
    return bool(updated)


def update_task_progress(task, bytes_done):
    total = max(0, int(task.total_bytes or 0))
    done = max(0, int(bytes_done or 0))
    if total and done > total:
        done = total
    now = timezone.now()
    MaterialSyncTask.objects.filter(pk=task.pk).update(
        bytes_done=done,
        updated_at=now,
        lease_expires_at=now + timedelta(minutes=30),
    )


def mark_task_synced(task, sha256=""):
    now = timezone.now()
    with transaction.atomic():
        updated = MaterialSyncTask.objects.filter(
            pk=task.pk,
            status__in=(
                MaterialSyncTask.Status.TRANSFERRING,
                MaterialSyncTask.Status.VERIFYING,
            ),
        ).update(
            status=MaterialSyncTask.Status.SYNCED,
            bytes_done=task.total_bytes,
            sha256=sha256 or task.sha256,
            finished_at=now,
            updated_at=now,
            last_error="",
            lease_owner="",
            lease_expires_at=None,
            next_retry_at=None,
        )
        if updated:
            Material.objects.filter(pk=task.material_id).update(
                file_sync_status=Material.FileSyncStatus.SYNCED,
                file_synced_at=now,
                file_sha256=sha256 or task.sha256 or "",
            )
    return bool(updated)


def _retry_delay(attempts):
    index = max(0, min(attempts - 1, len(RETRY_BACKOFF_SECONDS) - 1))
    return RETRY_BACKOFF_SECONDS[index]


def mark_task_error(task, message):
    now = timezone.now()
    retryable = task.attempts < MaterialSyncTask.MAX_ATTEMPTS
    next_retry = now + timedelta(seconds=_retry_delay(task.attempts)) if retryable else None
    with transaction.atomic():
        MaterialSyncTask.objects.filter(pk=task.pk).update(
            status=MaterialSyncTask.Status.ERROR,
            last_error=str(message or "")[:2000],
            finished_at=now,
            updated_at=now,
            lease_owner="",
            lease_expires_at=None,
            next_retry_at=next_retry,
        )
        Material.objects.filter(pk=task.material_id).update(
            file_sync_status=Material.FileSyncStatus.ERROR,
        )
    return retryable


def sync_payload(material, *, task=None):
    task = task if task is not None else latest_task(material)
    eta = task_eta_seconds(task) if task else None
    error = ""
    if material.file_sync_status == Material.FileSyncStatus.ERROR and task:
        error = task.last_error or "同步失败"
    return {
        "sync_state": material.file_sync_status,
        "sync_direction": material.file_sync_direction,
        "file_on_campus": material.file_on_campus,
        "sync_eta_seconds": eta,
        "sync_error": error,
        "sync_progress": {
            "bytes_done": int(task.bytes_done or 0) if task else 0,
            "total_bytes": int(task.total_bytes or material.file_size or 0) if task else int(material.file_size or 0),
        },
    }


def manifest_rows():
    """公网权威 manifest；校内节点用它比对镜像与缓存。"""
    rows = []
    qs = Material.objects.exclude(file_path="").select_related("course").order_by("id")
    for material in qs.iterator():
        rows.append({
            "id": material.id,
            "file_path": material.file_path,
            "file_name": material.file_name,
            "file_size": material.file_size,
            "sha256": material.file_sha256 or "",
            "review_status": material.review_status,
            "sync_state": material.file_sync_status,
            "sync_direction": material.file_sync_direction,
            "file_on_campus": material.file_on_campus,
            "is_pinned": bool(material.is_pinned),
            "download_count": material.download_count or 0,
            "created_at": material.created_at.isoformat() if material.created_at else "",
            "updated_at": material.created_at.isoformat() if material.created_at else "",
        })
    return rows
