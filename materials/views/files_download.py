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
from django.db.models import F

# 良性循环引用：files 为薄 facade，本模块经它读取可被测试 mock 的
# _pdf_preview_cache_path（test_xaccel_download 以 materials.views.files 打补丁）。
# 仅运行时访问，无导入期属性依赖。
from . import files as _facade
from .utils import (
    _err, _ok, _get_user,
    _generate_download_token, _verify_download_token,
    _check_download_quota, _check_moderator_access,
    require_login,
    Material, DownloadRecord,
)


@require_login
def api_download_token(request, file_id):
    """GET /api/files/<id>/download-token/ — 生成短时下载令牌

    v=167 安全加固：
      1. 签发前做下载授权校验——未批准资料仅上传者/辖区管理员可取令牌，
         普通第三方拿不到未批准文件的下载令牌；
      2. 令牌绑定签发时的会话键（session_key）——转发到其他浏览器即失效。
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
    # 确保存在会话：写入 session 让浏览器拿到 sessionid cookie，下载端才能比对会话键
    request.session.set_expiry(120)
    request.session["dt"] = 1
    request.session.save()
    token = _generate_download_token(file_id, request.user.id, request.session.session_key)
    return _ok({"token": token})


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
    abs_path = Path(abs_path)
    disk_name = abs_path.name
    ctype = mimetypes.guess_type(disk_name)[0] or "application/octet-stream"
    # 内联预览只允许 PDF/图片；可执行/活动内容一律降级为下载式 MIME
    if inline and ctype not in _INLINE_SAFE_MIME:
        ctype = "application/octet-stream"

    if getattr(settings, "USE_X_ACCEL", False):
        root = Path(settings.MEDIA_ROOT).parent if preview_cache else Path(settings.MEDIA_ROOT)
        prefix = "/protected-preview/" if preview_cache else "/protected/"
        try:
            rel = abs_path.resolve().relative_to(root.resolve()).as_posix()
        except ValueError:
            return _err("非法文件路径", 400)  # 越界（含 .. 逃逸）即拒绝
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


def _increment_download(user, material, file_id):
    """下载计数（F() 原子递增）+ 下载留痕，同步执行（X-Accel 前完成）。"""
    Material.objects.filter(id=file_id).update(download_count=F('download_count') + 1)
    try:
        DownloadRecord.objects.create(
            user=user, material=material,
            course_code=material.course.code if material.course_id else "",
            course_name=material.course.name if material.course_id else "",
            material_title=material.title,
            file_name=material.file_name,
        )
    except Exception:
        pass


def api_file_download(request, file_id):
    """GET /api/files/<id>/download — 支持 ?preview=1 内联预览（X-Accel）"""
    material = get_object_or_404(Material, id=file_id)
    file_path = Path(settings.MEDIA_ROOT) / material.file_path

    if not file_path.exists():
        return _err("文件不存在", 404)

    user = _get_user(request)
    if user is None:
        dtoken = request.GET.get("dtoken")
        if dtoken:
            # v=167：令牌绑定签发会话，会话键不匹配（转发/无 cookie）即验证失败
            uid = _verify_download_token(dtoken, file_id, request.session.session_key)
            if uid:
                user = User.objects.filter(id=uid).first()
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
                        return _serve_file_response(request, cache_path,
                                                    display_filename=display, inline=True, preview_cache=True)
                    except OSError:
                        pass  # 缓存写入失败 → 降级为完整文件预览（计入配额）
            except Exception:
                pass  # 解析失败 → 降级为完整文件预览（计入配额）
        # 完整文件预览（图片/PPT/文本/切页失败降级）→ 与下载同权：扣配额、计数，
        # 堵住原先 preview=1 绕过每日下载限额的洞
        allowed, remaining, msg = _check_download_quota(user, material)
        if not allowed:
            return _err(msg, 429)
        _increment_download(user, material, file_id)
        return _serve_file_response(request, file_path,
                                    display_filename=display, inline=True, preview_cache=False)

    # 正式下载：配额 + 计数后交给 nginx 直接送文件
    allowed, remaining, msg = _check_download_quota(user, material)
    if not allowed:
        return _err(msg, 429)
    _increment_download(user, material, file_id)
    return _serve_file_response(request, file_path,
                                display_filename=display, inline=False, preview_cache=False)
