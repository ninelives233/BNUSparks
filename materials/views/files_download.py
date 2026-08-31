"""
BNU Sparks · 木铎星火 — 文件下载 / 预览 API

download-token, X-Accel 文件服务, download
"""

import os
import re
import mimetypes
from io import BytesIO
from pathlib import Path
from urllib.parse import quote

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
        return False
    except Exception:
        return False
    return True


def _increment_download(user, material, file_id):
    """旧 facade 兼容出口：无行为编号的正式下载留痕。"""
    return _record_file_activity(
        user, material, file_id, DownloadRecord.ActivityType.DOWNLOAD,
    )


def api_file_download(request, file_id):
    """GET /api/files/<id>/download — 支持 ?preview=1 内联预览（X-Accel）"""
    material = get_object_or_404(Material, id=file_id)
    file_path = Path(settings.MEDIA_ROOT) / material.file_path

    if not file_path.exists():
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
                    return _serve_file_response(request, cache_path,
                                                display_filename=display, inline=True, preview_cache=True)
                reader = PdfReader(file_path)
                writer = PdfWriter()
                page_count = min(n, len(reader.pages))
                for i in range(page_count):
                    writer.add_page(reader.pages[i])
                buf = BytesIO()
                writer.write(buf)
                buf.seek(0)
                if cache_path:
                    try:
                        cache_path.parent.mkdir(parents=True, exist_ok=True)
                        tmp = cache_path.with_suffix('.tmp')
                        with open(tmp, 'wb') as f:
                            f.write(buf.getvalue())
                        os.replace(tmp, cache_path)
                        _record_file_activity(
                            user, material, file_id, DownloadRecord.ActivityType.PREVIEW,
                            activity_request_id,
                        )
                        return _serve_file_response(request, cache_path,
                                                    display_filename=display, inline=True, preview_cache=True)
                    except OSError:
                        pass  # 缓存写入失败 → 降级为完整文件预览（计入配额）
            except Exception:
                pass  # 解析失败 → 降级为完整文件预览（计入配额）
        # 完整文件预览（图片/PPT/文本/切页失败降级）仍占当天不同文件配额，
        # 但只记为“预览”，不再膨胀正式下载量。
        allowed, remaining, msg = _check_download_quota(user, material)
        if not allowed:
            return _err(msg, 429)
        _record_file_activity(
            user, material, file_id, DownloadRecord.ActivityType.PREVIEW,
            activity_request_id,
        )
        return _serve_file_response(request, file_path,
                                    display_filename=display, inline=True, preview_cache=False)

    # 正式下载：配额 + 计数后交给 nginx 直接送文件
    allowed, remaining, msg = _check_download_quota(user, material)
    if not allowed:
        return _err(msg, 429)
    _record_file_activity(
        user, material, file_id, DownloadRecord.ActivityType.DOWNLOAD,
        activity_request_id,
    )
    return _serve_file_response(request, file_path,
                                display_filename=display, inline=False, preview_cache=False)
