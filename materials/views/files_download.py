"""
BNU Sparks · 木铎星火 — 文件下载 / 预览 API

download-token, X-Accel 文件服务, download
"""

import os
import re
import time
import uuid
import fcntl
import logging
import mimetypes
import hashlib
from io import BytesIO
from pathlib import Path
from urllib.parse import quote

logger = logging.getLogger(__name__)

try:
    from pypdf import PdfReader, PdfWriter
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False

from django.shortcuts import get_object_or_404
from django.contrib.auth.models import User
from django.http import FileResponse, HttpResponse
from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F

# 良性循环引用：files 为薄 facade，本模块经它读取可被测试 mock 的
# _pdf_preview_cache_path（test_xaccel_download 以 materials.views.files 打补丁）。
# 仅运行时访问，无导入期属性依赖。
from . import files as _facade
from .utils import (
    _err, _ok, _get_user,
    _generate_download_token, _generate_portable_download_token,
    _verify_download_token, _verify_portable_download_token,
    _check_download_quota, _check_moderator_access,
    require_login,
    Material, DownloadRecord,
)
from ..monitoring_events import record_request_event


@require_login
def api_download_token(request, file_id):
    """GET /api/files/<id>/download-token/ — 生成短时下载令牌

    已审核资料签发 90 秒、IP 绑定的可移交令牌，解决微信 WebView 把下载
    交给系统浏览器后 session cookie 丢失的问题；待审核资料仍使用会话绑定令牌。
    """
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    material = get_object_or_404(Material, id=file_id)
    if material.review_status != "approved":
        try:
            # 与下载端点同权：已驳回 → 上传者本人也无权；待审核 → 上传者可取（1 分钟窗口）
            if material.review_status == "rejected":
                _check_moderator_access(request.user, material, allow_uploader=False)
            else:
                _check_moderator_access(request.user, material)
        except Exception:
            return _err("该资料未通过审核，暂不可下载", 403)
    if material.review_status == "approved":
        token = _generate_portable_download_token(file_id, request.user.id, request)
        return _ok({"token": token, "handoff": True})

    # 非公开资料仍必须由同一浏览器会话消费令牌，不能跨浏览器移交。
    request.session.set_expiry(120)
    request.session["dt"] = 1
    request.session.save()
    token = _generate_download_token(file_id, request.user.id, request.session.session_key)
    return _ok({"token": token, "handoff": False})


# ═══════════════════════════════════════════════════════════════
# X-Accel-Redirect 文件服务（P3.1）
# 生产（USE_X_ACCEL=True）：Django 完成全部鉴权/配额/计数后返回 bodyless
#   HttpResponse + X-Accel-Redirect，由 nginx internal location 直接流式送文件，
#   释放 gunicorn 线程；本地/测试（USE_X_ACCEL=False）回退 Django FileResponse。
# ═══════════════════════════════════════════════════════════════

# 可内联预览的 MIME（其余一律 attachment，防止 .html/.svg 等源内执行）
_INLINE_SAFE_MIME = {
    "application/pdf", "image/jpeg", "image/png", "image/gif",
    "image/webp", "image/bmp",
}


def _content_disposition_header(filename, attachment=True):
    """RFC 5987 Content-Disposition：ASCII filename= 兜底 + filename*=UTF-8''（中文）。"""
    filename = (filename or "download").replace('"', '').replace(';', '')
    ascii_name = re.sub(r'[^\x20-\x7e]', '_', filename) or "download"
    kind = "attachment" if attachment else "inline"
    hdr = f'{kind}; filename="{ascii_name}"'
    try:
        hdr += f"; filename*=UTF-8''{quote(filename.encode('utf-8'), safe='')}"
    except Exception:
        pass
    return hdr


def _serve_file_response(request, abs_path, *, display_filename, inline=False, preview_cache=False):
    """统一文件出口：X-Accel 模式 → nginx internal 转发；否则 FileResponse。

    preview_cache=True：文件在 MEDIA_ROOT 上级（data/.pdf_cache/），走 /protected-preview/。
    防越界：abs_path 必须 resolve 后仍位于对应根目录内，否则 400。
    """
    root = Path(settings.MEDIA_ROOT).parent if preview_cache else Path(settings.MEDIA_ROOT)
    try:
        # 必须在选择 X-Accel / FileResponse 之前统一校验。resolve() 同时折叠 ``..``
        # 并解析符号链接，防止开发模式或 X-Accel 关闭时绕过生产分支的路径边界。
        abs_path = Path(abs_path).resolve()
        rel = abs_path.relative_to(root.resolve()).as_posix()
    except (OSError, RuntimeError, ValueError):
        return _err("非法文件路径", 400)

    disk_name = abs_path.name
    ctype = mimetypes.guess_type(disk_name)[0] or "application/octet-stream"
    # 内联预览只允许 PDF/图片；可执行/活动内容一律降级为下载式 MIME
    if inline and ctype not in _INLINE_SAFE_MIME:
        ctype = "application/octet-stream"

    if getattr(settings, "USE_X_ACCEL", False):
        prefix = "/protected-preview/" if preview_cache else "/protected/"
        resp = HttpResponse()
        # 百分号编码 rel：含中文/全角字符的文件名若原样写入响应头，gunicorn(WSGI)
        # 会按 RFC 2047 编码成 `=?utf-8?q?...?=`，nginx 无法解析该路径 → 内部 404
        # → 浏览器「无法从网站上提取文件」。percent-encode 后头部纯 ASCII，
        # nginx internal 转发时 URL-decode 回原路径，正确命中磁盘文件。
        resp["X-Accel-Redirect"] = prefix + quote(rel, safe='/')
        resp["Content-Type"] = ctype
        resp["Content-Disposition"] = _content_disposition_header(display_filename, attachment=not inline)
        resp["X-Content-Type-Options"] = "nosniff"
        if inline:
            resp["X-Frame-Options"] = "SAMEORIGIN"
        return resp

    # 本地/测试：Django 直接流式发送（行为与重构前一致）
    resp = FileResponse(open(abs_path, "rb"), as_attachment=not inline,
                        filename=display_filename, content_type=ctype)
    if inline:
        resp["X-Frame-Options"] = "SAMEORIGIN"
    return resp


def _record_file_activity(user, material, file_id, activity_type, request_id=None):
    """幂等写入访问流水；仅正式下载增加资料下载量。

    系统浏览器可能重放微信移交的同一 URL。``request_id`` 的唯一约束保证
    同一令牌只产生一条流水、一次正式下载计数。

    返回值区分三种结局（当前调用方均不依赖，但保留可观察语义）：
    True=新写入；"duplicate"=重复行为编号幂等跳过；False=真实写失败
    （已记录异常日志，业务交付不受阻，计数可能欠账属可容忍口径）。
    """
    try:
        with transaction.atomic():
            DownloadRecord.objects.create(
                user=user, material=material,
                course_code=material.course.code if material.course_id else "",
                course_name=material.course.name if material.course_id else "",
                material_title=material.title,
                file_name=material.file_name,
                activity_type=activity_type,
                request_id=request_id,
            )
            if activity_type == DownloadRecord.ActivityType.DOWNLOAD:
                Material.objects.filter(id=file_id).update(download_count=F("download_count") + 1)
    except IntegrityError:
        return "duplicate"
    except Exception:
        logger.exception(
            "下载流水写入失败 user=%s material=%s activity=%s",
            getattr(user, "id", None), file_id, activity_type,
        )
        return False
    return True


def _increment_download(user, material, file_id):
    """旧 facade 兼容出口：无行为编号的正式下载留痕。"""
    return _record_file_activity(
        user, material, file_id, DownloadRecord.ActivityType.DOWNLOAD,
    )


def _download_event_id(kind, request_id=None):
    """下载令牌带 request_id 时，事件 ID 与重试共享；普通请求各记一次。"""
    if not request_id:
        return None
    digest = hashlib.sha256(str(request_id).encode("utf-8")).hexdigest()[:40]
    return f"material-{kind}-{digest}"[:80]


def _record_download_result(request, *, preview, success, request_id=None, quota_denied=False):
    if quota_denied and not preview:
        event_name = "material.download.quota_denied"
        kind = "quota"
    elif quota_denied:
        event_name = "material.preview.failure"
        kind = "preview-quota"
    elif preview:
        event_name = "material.preview.success" if success else "material.preview.failure"
        kind = "preview-success" if success else "preview-failure"
    else:
        event_name = "material.download.success" if success else "material.download.failure"
        kind = "download-success" if success else "download-failure"
    record_request_event(request, event_name, event_id=_download_event_id(kind, request_id))


def _publish_pdf_preview(cache_path, buf, *, max_wait=8.0):
    """把已生成的裁剪 PDF 发布到预览缓存（同键跨进程合并生成）。

    同一缓存键的并发冷请求经每键文件锁（flock）串行化：拿到锁后先复查
    缓存是否已被其他 worker 发布，避免重复写。等待有界（max_wait 秒），
    超时不阻塞用户——调用方直接回送内存中的裁剪结果。

    锁文件发布后保留不复删：删除会让正在等待的进程持有一个孤儿 inode
    的锁，而新来的进程创建新文件再拿锁，互斥随之失效。临时文件本身
    （*.tmp）在发布后立即清理。

    返回 True 表示缓存已就绪（自己发布或他人已发布），False 表示发布
    失败/超时（调用方回送内存结果，不降级完整文件、不误扣配额）。
    """
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        lock_path = cache_path.with_name(cache_path.name + '.lock')
        deadline = time.monotonic() + max_wait
        fd = None
        while True:
            try:
                fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o644)
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if fd is not None:
                    os.close(fd)
                    fd = None
                if time.monotonic() >= deadline:
                    return False
                time.sleep(0.05)
        try:
            if not cache_path.exists():
                # 唯一临时文件 + 关闭后原子替换：两个 worker 不会写同一个
                # .tmp；读者只会看到完整发布的文件，不会读到半截内容。
                tmp = cache_path.with_name(
                    f'{cache_path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp')
                try:
                    with open(tmp, 'wb') as f:
                        f.write(buf.getvalue())
                    os.replace(tmp, cache_path)
                finally:
                    try:
                        os.unlink(tmp)
                    except OSError:
                        pass
            return True
        finally:
            try:
                fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)
    except OSError:
        logger.warning("PDF 预览缓存发布失败：%s", cache_path, exc_info=True)
        return False


def _serve_pdf_buffer_response(buf, display_filename):
    """内存裁剪 PDF 直送（缓存发布失败/超时的预览出口，免配额不降级）。"""
    resp = FileResponse(BytesIO(buf.getvalue()), content_type="application/pdf")
    resp["Content-Disposition"] = _content_disposition_header(display_filename, attachment=False)
    resp["X-Content-Type-Options"] = "nosniff"
    resp["X-Frame-Options"] = "SAMEORIGIN"
    return resp


def api_file_download(request, file_id):
    """GET /api/files/<id>/download — 支持 ?preview=1 内联预览（X-Accel）"""
    material = get_object_or_404(Material, id=file_id)
    file_path = Path(settings.MEDIA_ROOT) / material.file_path

    if not file_path.exists():
        _record_download_result(request, preview=request.GET.get("preview") == "1", success=False)
        return _err("文件不存在", 404)

    user = _get_user(request)
    activity_request_id = None
    dtoken = request.GET.get("dtoken")
    if dtoken:
        portable = _verify_portable_download_token(dtoken, file_id, request)
        if portable:
            uid, activity_request_id = portable
            if user is None:
                user = User.objects.filter(id=uid, is_active=True).first()
            elif user.id != uid:
                return _err("下载令牌与当前用户不匹配", 403)
        elif user is None:
            # 待审核资料的旧式令牌仍绑定签发会话。
            uid = _verify_download_token(dtoken, file_id, request.session.session_key)
            if uid:
                user = User.objects.filter(id=uid, is_active=True).first()
    if user is None:
        return _err("请先登录后再下载", 401)

    if material.review_status != "approved":
        try:
            # 已驳回：上传者本人也无权下载（防止普通用户绕过审核取回被驳回文件）
            # 待审核：上传者可预览/下载自己刚传的文件（自动托管 1 分钟延迟窗口内）
            if material.review_status == "rejected":
                _check_moderator_access(user, material, allow_uploader=False)
            else:
                _check_moderator_access(user, material)
        except Exception:
            return _err("该资料未通过审核，暂不可下载", 403)

    display = material.file_name or material.title

    is_preview = request.GET.get("preview") == "1"
    if is_preview:
        # PDF 预览：max_pages=N 裁剪前 N 页（节省带宽 + 客户端资源）
        # 切割结果按「文件指纹 + max_pages」缓存到 data/.pdf_cache/，命中免配额免计数
        max_pages = request.GET.get("max_pages")
        if max_pages and HAS_PYPDF and material.file_name and material.file_name.lower().endswith('.pdf'):
            try:
                n = max(1, min(int(max_pages), 50))
                cache_path = _facade._pdf_preview_cache_path(material.id, file_path, n)
                if cache_path and cache_path.exists():
                    _record_file_activity(
                        user, material, file_id, DownloadRecord.ActivityType.PREVIEW,
                        activity_request_id,
                    )
                    response = _serve_file_response(request, cache_path,
                                                    display_filename=display, inline=True, preview_cache=True)
                    _record_download_result(request, preview=True, success=getattr(response, "status_code", 500) < 400,
                                            request_id=activity_request_id)
                    return response
                reader = PdfReader(file_path)
                writer = PdfWriter()
                page_count = min(n, len(reader.pages))
                for i in range(page_count):
                    writer.add_page(reader.pages[i])
                buf = BytesIO()
                writer.write(buf)
                # 裁剪成功即视为预览成功：缓存发布竞争/失败/超时只影响
                # 缓存与否，直接回送内存中的裁剪结果——不再降级为完整
                # 文件预览，避免因缓存竞争误扣配额、浪费带宽。
                if cache_path and _publish_pdf_preview(cache_path, buf):
                    _record_file_activity(
                        user, material, file_id, DownloadRecord.ActivityType.PREVIEW,
                        activity_request_id,
                    )
                    response = _serve_file_response(request, cache_path,
                                                    display_filename=display, inline=True, preview_cache=True)
                else:
                    _record_file_activity(
                        user, material, file_id, DownloadRecord.ActivityType.PREVIEW,
                        activity_request_id,
                    )
                    response = _serve_pdf_buffer_response(buf, display)
                _record_download_result(request, preview=True, success=getattr(response, "status_code", 500) < 400,
                                        request_id=activity_request_id)
                return response
            except Exception:
                pass  # 解析失败 → 降级为完整文件预览（计入配额）
        # 完整文件预览（图片/PPT/文本/切页失败降级）仍占当天不同文件配额，
        # 但只记为“预览”，不再膨胀正式下载量。
        allowed, remaining, msg = _check_download_quota(user, material)
        if not allowed:
            _record_download_result(request, preview=True, success=False, request_id=activity_request_id, quota_denied=True)
            return _err(msg, 429)
        _record_file_activity(
            user, material, file_id, DownloadRecord.ActivityType.PREVIEW,
            activity_request_id,
        )
        response = _serve_file_response(request, file_path,
                                        display_filename=display, inline=True, preview_cache=False)
        _record_download_result(request, preview=True, success=getattr(response, "status_code", 500) < 400,
                                request_id=activity_request_id)
        return response

    # 正式下载：配额 + 计数后交给 nginx 直接送文件
    allowed, remaining, msg = _check_download_quota(user, material)
    if not allowed:
        _record_download_result(request, preview=False, success=False, request_id=activity_request_id, quota_denied=True)
        return _err(msg, 429)
    _record_file_activity(
        user, material, file_id, DownloadRecord.ActivityType.DOWNLOAD,
        activity_request_id,
    )
    response = _serve_file_response(request, file_path,
                                    display_filename=display, inline=False, preview_cache=False)
    _record_download_result(request, preview=False, success=getattr(response, "status_code", 500) < 400,
                            request_id=activity_request_id)
    return response
