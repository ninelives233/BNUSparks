"""校内文件加速站：公网票据、内部授权与同步任务接口。

公网保持唯一数据库、审核入口和权威文件源；校内节点只保存已过审文件的
镜像（公网→校内）。所有内部接口都要求 ``X-Accelerator-Secret``，并应由
Nginx 再限制为校内/WireGuard 来源。
"""

from __future__ import annotations

import hashlib
import hmac
import json
import mimetypes
import re
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from ..models import DownloadRecord, Material, MaterialSyncTask
from ..services.accelerator import (
    ACTIVE_TASK_STATUSES,
    accelerator_base_url,
    accelerator_enabled,
    get_download_ticket,
    internal_secret,
    issue_download_ticket,
    mark_task_error,
    mark_task_started,
    mark_task_synced,
    manifest_rows,
    revive_retryable_tasks,
    resolve_ticket_user,
    sync_payload,
    ticket_matches_material,
    ticket_ttl,
    ticket_url,
    update_task_progress,
)
from .files_download import (
    _content_disposition_header,
    _record_download_result,
    _record_file_activity,
)
from .utils import (
    _check_download_quota,
    _check_moderator_access,
    _err,
    _ok,
    require_login,
)


def _internal_ok(request):
    secret = internal_secret()
    if not secret:
        return False
    supplied = request.headers.get("X-Accelerator-Secret", "")
    return bool(supplied) and hmac.compare_digest(str(supplied), secret)


def _internal_denied():
    # 内部接口对公网不可见；Nginx 也应只允许校内来源。
    return _err("接口不存在", 404)


def _task_payload(task):
    material = task.material
    return {
        "id": task.id,
        "material_id": material.id,
        "direction": task.direction,
        "status": task.status,
        "priority": task.priority,
        "attempts": task.attempts,
        "bytes_done": task.bytes_done,
        "total_bytes": task.total_bytes or material.file_size or 0,
        "sha256": task.sha256 or material.file_sha256 or "",
        "file_path": material.file_path,
        "file_name": material.file_name,
        "file_size": material.file_size,
        "last_error": task.last_error,
        "updated_at": task.updated_at.isoformat() if task.updated_at else "",
    }


def _file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _ticket_download_allowed(user, material):
    """票据不能绕过审核：pending 仅上传者/管理员，rejected 仅管理员。"""
    if material.review_status == "approved":
        return True
    try:
        if material.review_status == "rejected":
            _check_moderator_access(user, material, allow_uploader=False)
        else:
            _check_moderator_access(user, material)
        return True
    except Exception:
        return False


# ═══════════════════════════════════════════════════════════════
# 公网公开接口
# ═══════════════════════════════════════════════════════════════

def api_accelerator_config(request):
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    return _ok({
        "enabled": accelerator_enabled(),
        "base_url": accelerator_base_url(),
    })


@csrf_exempt
@require_login
def api_accelerate_ticket(request, file_id):
    """POST /api/files/<id>/accelerate-ticket/ — 签发校内加速下载票据。"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    if not accelerator_enabled():
        return _err("校内加速站未启用", 404)

    material = get_object_or_404(
        Material.objects.select_related("course"), id=file_id,
    )
    if not _ticket_download_allowed(request.user, material):
        return _err("该资料尚未通过审核，暂不可下载", 403)
    path = Path(settings.MEDIA_ROOT) / material.file_path
    if not material.file_path or not path.is_file():
        return _err("文件暂不可用，请稍后重试", 409)

    token, payload = issue_download_ticket(request.user, material)
    data = {
        "ticket": token,
        "url": ticket_url(token),
        "public_url": f"/api/files/{material.id}/download/?aticket={token}",
        "expires_in": ticket_ttl(),
        **sync_payload(material),
    }
    return _ok(data)


# ═══════════════════════════════════════════════════════════════
# 公网内部接口（校内节点专用）
# ═══════════════════════════════════════════════════════════════

def api_internal_authorize_download(request):
    """GET /api/internal/accelerator/authorize/?ticket=... — 校验并计数。

    只做鉴权/配额/计数，不返回文件；校内 Nginx 用响应头定位本地文件。
    """
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    if not _internal_ok(request):
        return _internal_denied()

    token = (request.GET.get("ticket") or "").strip()
    payload = get_download_ticket(token)
    if not payload:
        return _err("下载票据无效或已过期", 403)

    material = Material.objects.select_related("course").filter(
        id=payload.get("material_id"),
    ).first()
    if material is None:
        return _err("资料不存在", 403)
    if not ticket_matches_material(payload, material):
        return _err("下载票据与资料不匹配", 403)
    user = resolve_ticket_user(payload)
    if user is None:
        return _err("账号不可用或登录状态已变化", 403)
    if not _ticket_download_allowed(user, material):
        return _err("该资料尚未通过审核", 403)

    allowed, _remaining, message = _check_download_quota(user, material)
    if not allowed:
        response = _err(message, 403)
        response["X-Accel-Error"] = message
        return response

    _record_file_activity(
        user, material, material.id,
        # 与公开下载端点一致：授权通过即记一次正式下载。
        DownloadRecord.ActivityType.DOWNLOAD,
        request_id=token,
    )
    _record_download_result(request, preview=False, success=True, request_id=token)

    display = material.file_name or material.title
    content_type = mimetypes.guess_type(display)[0] or "application/octet-stream"
    ext = Path(display).suffix.lower().lstrip(".")
    if not re.fullmatch(r"[a-z0-9]{1,10}", ext or ""):
        ext = ""

    response = HttpResponse(status=204)
    response["Cache-Control"] = "no-store"
    response["X-Accel-File-Id"] = str(material.id)
    # 校内存储链接带扩展名（如 42.pdf），Nginx 由内部 URI 后缀推导
    # Content-Type；否则无扩展名一律 octet-stream。
    response["X-Accel-Storage-Name"] = f"{material.id}{('.' + ext) if ext else ''}"
    response["X-Accel-Content-Type"] = content_type
    response["X-Accel-Content-Disposition"] = _content_disposition_header(
        display, attachment=True,
    )
    return response


def api_internal_sync_tasks(request):
    """GET /api/internal/accelerator/tasks/?status=active — 同步任务列表。"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    if not _internal_ok(request):
        return _internal_denied()

    # agent 崩溃/断网后，过期领取的任务重新排队；否则会永久卡在 transferring。
    MaterialSyncTask.objects.filter(
        status__in=(
            MaterialSyncTask.Status.TRANSFERRING,
            MaterialSyncTask.Status.VERIFYING,
        ),
        lease_expires_at__lt=timezone.now(),
    ).update(
        status=MaterialSyncTask.Status.PENDING,
        lease_owner="",
        lease_expires_at=None,
        last_error="领取超时，重新排队",
    )
    # error 任务按退避时间复活；超过最大尝试次数后保持 error 等人工处理。
    revive_retryable_tasks()

    status = (request.GET.get("status") or "active").strip()
    qs = MaterialSyncTask.objects.select_related("material").order_by("priority", "created_at", "id")
    if status == "active":
        qs = qs.filter(status__in=ACTIVE_TASK_STATUSES)
    elif status:
        qs = qs.filter(status=status)
    try:
        limit = max(1, min(int(request.GET.get("limit") or 20), 100))
    except (TypeError, ValueError):
        limit = 20
    return _ok({"tasks": [_task_payload(task) for task in qs[:limit]]})


@csrf_exempt
def api_internal_sync_task_start(request, task_id):
    if request.method != "POST" or not _internal_ok(request):
        return _internal_denied() if request.method == "POST" else _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body or b"{}")
    except (TypeError, ValueError):
        body = {}
    task = MaterialSyncTask.objects.select_related("material").filter(id=task_id).first()
    if task is None:
        return _err("任务不存在", 404)
    if not mark_task_started(task, owner=str(body.get("owner") or "campus-agent")):
        return _err("任务已被领取或已结束", 409)
    task.refresh_from_db()
    return _ok(_task_payload(task))


@csrf_exempt
def api_internal_sync_task_progress(request, task_id):
    if request.method != "POST" or not _internal_ok(request):
        return _internal_denied() if request.method == "POST" else _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body or b"{}")
    except (TypeError, ValueError):
        return _err("请求格式错误")
    task = MaterialSyncTask.objects.select_related("material").filter(id=task_id).first()
    if task is None:
        return _err("任务不存在", 404)
    update_task_progress(task, body.get("bytes_done"))
    task.refresh_from_db()
    return _ok(_task_payload(task))


@csrf_exempt
def api_internal_sync_task_complete(request, task_id):
    if request.method != "POST" or not _internal_ok(request):
        return _internal_denied() if request.method == "POST" else _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body or b"{}")
    except (TypeError, ValueError):
        return _err("请求格式错误")
    task = MaterialSyncTask.objects.select_related("material").filter(id=task_id).first()
    if task is None:
        return _err("任务不存在", 404)
    if task.status == MaterialSyncTask.Status.SYNCED:
        return _ok({"status": "synced", "sha256": task.sha256})
    if task.status not in (
        MaterialSyncTask.Status.TRANSFERRING,
        MaterialSyncTask.Status.VERIFYING,
    ):
        return _err("任务已取消或尚未开始", 409)

    if body.get("success") is False:
        mark_task_error(task, body.get("error") or "同步失败")
        return _ok({"status": "error"})

    reported = str(body.get("sha256") or "").strip().lower()
    if reported and not re.fullmatch(r"[0-9a-f]{64}", reported):
        mark_task_error(task, "校验值无效")
        return _err("校验值无效", 400)

    # 公网是权威源：用公网文件重新计算哈希，并与 agent 的校内副本哈希比对。
    path = Path(settings.MEDIA_ROOT) / task.material.file_path
    if not path.is_file():
        mark_task_error(task, "公网源文件不存在")
        return _err("公网源文件不存在", 409)
    actual = _file_sha256(path)
    if reported and reported != actual:
        mark_task_error(task, "校内副本 SHA-256 与公网不一致")
        return _err("文件 SHA-256 校验失败", 409)

    mark_task_synced(task, sha256=actual)
    return _ok({"status": "synced", "sha256": actual})


@csrf_exempt
def api_internal_repair(request):
    """POST /api/internal/accelerator/repair/ — 校内清单发现缺文件时补任务。"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    if not _internal_ok(request):
        return _internal_denied()
    try:
        body = json.loads(request.body or b"{}")
    except (TypeError, ValueError):
        return _err("请求格式错误")
    material = Material.objects.filter(id=body.get("material_id")).first()
    if material is None:
        return _err("资料不存在", 404)
    from ..services.accelerator import queue_public_to_campus
    if material.review_status != "approved":
        return _err("资料未通过审核，无需镜像", 409)
    task = queue_public_to_campus(material, priority=10)
    return _ok({"task": _task_payload(task) if task else None})


def api_internal_sync_file_source(request, material_id):
    """GET /api/internal/accelerator/files/<id>/source/ — 校内 agent 拉取公网源文件。"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    if not _internal_ok(request):
        return _internal_denied()
    material = Material.objects.filter(id=material_id).first()
    if material is None:
        return _err("资料不存在", 404)
    path = Path(settings.MEDIA_ROOT) / material.file_path
    if not path.is_file():
        return _err("源文件不存在", 404)
    response = FileResponse(open(path, "rb"), as_attachment=True, filename=material.file_name or path.name)
    response["Cache-Control"] = "no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response


def api_internal_manifest(request):
    """GET /api/internal/accelerator/manifest/ — 公网权威文件清单。"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    if not _internal_ok(request):
        return _internal_denied()
    rows = manifest_rows()
    payload = json.dumps({"rows": rows}, ensure_ascii=False, sort_keys=True)
    etag = '"' + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32] + '"'
    if request.headers.get("If-None-Match") == etag:
        response = HttpResponse(status=304)
        response["ETag"] = etag
        return response
    response = HttpResponse(payload, content_type="application/json")
    response["ETag"] = etag
    response["Cache-Control"] = "no-store"
    return response
