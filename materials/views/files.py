"""
BNU Sparks · 木铎星火 — 文件 API

file-upload, upload-text, download-token, download, delete
"""

import json
import os
import re
import mimetypes
import hashlib
from io import BytesIO
from pathlib import Path
from urllib.parse import quote

try:
    from pypdf import PdfReader, PdfWriter
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False

from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User
from django.http import FileResponse, HttpResponse
from django.conf import settings
from django.utils import timezone
from django.db.models import F

from .utils import (
    _err, _ok, _get_user, _get_or_create_profile,
    _generate_download_token, _verify_download_token,
    _strip_exif, _check_auto_approve, _check_download_quota,
    _check_moderator_access, _calculate_review_assignment,
    _create_notification, _user_can_edit_material,
    _sanitize_filename_part, _safe_dir_name, _blocked_upload_ext,
    require_login,
    UserProfile, Course, Material, Notification,
    DownloadRecord, DeletionRecord, CourseCategory,
)
from django.db.models import Count


@csrf_exempt
@require_login
def api_file_upload(request):
    """POST /api/files/upload"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)

    course_code = request.POST.get("course_code", "").strip()
    title = request.POST.get("title", "").strip()
    description = request.POST.get("description", "").strip()
    teacher = request.POST.get("teacher", "").strip()
    material_type_id = request.POST.get("material_type_id", "").strip()
    uploaded_file = request.FILES.get("file")

    if not course_code or not uploaded_file:
        return _err("课程代码和文件不能为空")
    if not teacher:
        return _err("请填写任课教师姓名")

    if not title:
        title = Path(uploaded_file.name).stem

    try:
        course = Course.objects.get(code=course_code)
    except Course.DoesNotExist:
        cleaned = course_code.replace("*", "").replace("-", "")
        matched = Course.objects.filter(code__startswith=cleaned)
        if matched.count() == 1:
            course = matched.first()
        elif matched.count() > 1:
            return _err("课程代码不明确，请联系管理员")
        else:
            return _err("课程不存在")
    except Course.MultipleObjectsReturned:
        courses = Course.objects.filter(code=course_code).order_by("id")
        with_files = courses.filter(materials__is_approved=True).distinct()
        if with_files.count() == 1:
            course = with_files.first()
        elif with_files.count() > 1:
            return _err("课程代码不明确，请联系管理员")
        else:
            course = courses.first()

    from uuid import uuid4
    course_dir = _safe_dir_name(course_code)
    ext = Path(uploaded_file.name).suffix
    if _blocked_upload_ext(ext):
        return _err("该文件类型不允许上传（可能包含可执行/活动内容）", 400)
    clean_title = _sanitize_filename_part(title) or _sanitize_filename_part(Path(uploaded_file.name).stem) or "file"
    safe_name = f"{uuid4().hex[:12]}_{clean_title}{ext}"
    save_dir = Path(settings.MEDIA_ROOT) / course_dir
    save_dir.mkdir(parents=True, exist_ok=True)

    with open(save_dir / safe_name, "wb") as f:
        for chunk in uploaded_file.chunks():
            f.write(chunk)

    _strip_exif(save_dir / safe_name)
    file_size = (save_dir / safe_name).stat().st_size

    profile = _get_or_create_profile(request.user)
    is_auto_approved = profile.role in (
        UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN, UserProfile.Role.SUB_MODERATOR,
    )
    auto_approved_by = None
    if is_auto_approved:
        auto_approved_by = request.user
    else:
        auto_approved_by = _check_auto_approve(course)
        if auto_approved_by:
            is_auto_approved = True

    review_status = "approved" if is_auto_approved else "pending"

    material = Material.objects.create(
        course=course, title=title, description=description,
        teacher=teacher,
        material_type_id=int(material_type_id) if material_type_id and material_type_id.isdigit() else None,
        file_name=uploaded_file.name,
        file_path=f"{course_dir}/{safe_name}",
        file_size=file_size,
        uploader=request.user,
        uploader_name=request.user.first_name or request.user.username,
        review_status=review_status,
        is_approved=is_auto_approved,
        reviewed_by=auto_approved_by,
        reviewed_at=timezone.now() if auto_approved_by else None,
    )

    try:
        from git_storage import commit_file
        commit_file(f"{course_code}/{safe_name}")
    except Exception:
        pass

    if review_status == "pending":
        assigned = _calculate_review_assignment(material)
        if assigned:
            material.assigned_moderator = assigned
            material.save(update_fields=["assigned_moderator"])

        _create_notification(
            recipient=request.user,
            type=Notification.Type.REPORT,
            title="资料已提交，等待审核",
            message=f"你的资料「{title}」已提交，审核通过后即可被其他同学下载。",
            material=material,
        )

    return _ok({
        "id": material.id, "title": material.title,
        "file_name": uploaded_file.name, "file_size": file_size,
        "created_at": material.created_at.strftime("%Y-%m-%d"),
        "review_status": material.review_status,
        "is_approved": material.is_approved,
        "assigned_moderator": material.assigned_moderator_id,
        "assigned_moderator_name": material.assigned_moderator.first_name or material.assigned_moderator.username
            if material.assigned_moderator else None,
    })


@csrf_exempt
@require_login
def api_file_upload_text(request):
    """POST /api/files/upload-text/ — 文字录入转 TXT"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("请求格式错误")

    course_code = (data.get("course_code") or "").strip()
    title = (data.get("title") or "").strip()
    teacher = (data.get("teacher") or "").strip()
    description = (data.get("description") or "").strip()
    material_type_id = (data.get("material_type_id") or "").strip()
    content = (data.get("content") or "").strip()

    if not course_code or not content:
        return _err("课程代码和内容不能为空")
    if not teacher:
        return _err("请填写任课教师姓名")
    if not title:
        title = content[:20].strip().rstrip("，。！？,.!?")
    if not title:
        title = "无标题"

    try:
        course = Course.objects.get(code=course_code)
    except Course.DoesNotExist:
        cleaned = course_code.replace("*", "").replace("-", "")
        matched = Course.objects.filter(code__startswith=cleaned)
        if matched.count() == 1:
            course = matched.first()
        elif matched.count() > 1:
            return _err("课程代码不明确，请联系管理员")
        else:
            return _err("课程不存在")
    except Course.MultipleObjectsReturned:
        courses = Course.objects.filter(code=course_code).order_by("id")
        with_files = courses.filter(materials__is_approved=True).distinct()
        if with_files.count() == 1:
            course = with_files.first()
        elif with_files.count() > 1:
            return _err("课程代码不明确，请联系管理员")
        else:
            course = courses.first()

    from uuid import uuid4
    course_dir = _safe_dir_name(course_code)
    clean_title = _sanitize_filename_part(title) or "text"
    safe_name = f"text_{uuid4().hex[:12]}_{clean_title}.txt"
    save_dir = Path(settings.MEDIA_ROOT) / course_dir
    save_dir.mkdir(parents=True, exist_ok=True)

    (save_dir / safe_name).write_text(content, encoding="utf-8")
    file_size = (save_dir / safe_name).stat().st_size

    profile = _get_or_create_profile(request.user)
    is_auto_approved = profile.role in (
        UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN, UserProfile.Role.SUB_MODERATOR,
    )
    auto_approved_by = None
    if is_auto_approved:
        auto_approved_by = request.user
    else:
        auto_approved_by = _check_auto_approve(course)
        if auto_approved_by:
            is_auto_approved = True

    review_status = "approved" if is_auto_approved else "pending"

    material = Material.objects.create(
        course=course, title=title, description=description,
        teacher=teacher,
        material_type_id=int(material_type_id) if material_type_id and material_type_id.isdigit() else None,
        file_name=safe_name,
        file_path=f"{course_dir}/{safe_name}",
        file_size=file_size,
        uploader=request.user,
        uploader_name=request.user.first_name or request.user.username,
        review_status=review_status,
        is_approved=is_auto_approved,
        reviewed_by=auto_approved_by,
        reviewed_at=timezone.now() if auto_approved_by else None,
    )

    try:
        from git_storage import commit_file
        commit_file(f"{course_code}/{safe_name}")
    except Exception:
        pass

    if review_status == "pending":
        assigned = _calculate_review_assignment(material)
        if assigned:
            material.assigned_moderator = assigned
            material.save(update_fields=["assigned_moderator"])

        _create_notification(
            recipient=request.user,
            type=Notification.Type.REPORT,
            title="资料已提交，等待审核",
            message=f"你的资料「{title}」已提交，审核通过后即可被其他同学下载。",
            material=material,
        )

    return _ok({
        "id": material.id, "title": material.title,
        "file_name": material.file_name, "file_size": file_size,
        "created_at": material.created_at.strftime("%Y-%m-%d"),
        "review_status": material.review_status,
        "is_approved": material.is_approved,
        "assigned_moderator": material.assigned_moderator_id,
        "assigned_moderator_name": material.assigned_moderator.first_name or material.assigned_moderator.username
            if material.assigned_moderator else None,
    })


@require_login
def api_download_token(request, file_id):
    """GET /api/files/<id>/download-token/ — 生成短时下载令牌"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    token = _generate_download_token(file_id, request.user.id)
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
            uid = _verify_download_token(dtoken, file_id)
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
                cache_path = _pdf_preview_cache_path(material.id, file_path, n)
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


def _scope_matched_moderators(material, actor, include_super_admin=False):
    """删除资料时应通知的版主/小版主（按资料所属学院匹配管辖范围，与
    管理后台「删除记录」的可见范围一致）。include_super_admin 时总管理员始终包含。
    不含 actor，去重返回 User 列表。"""
    college_id = material.course.college_id if material.course else None
    roles = [UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR]
    if include_super_admin:
        roles.append(UserProfile.Role.SUPER_ADMIN)
    qs = User.objects.filter(
        profile__role__in=roles
    ).exclude(id=actor.id).distinct()
    recipients = []
    seen = set()
    for u in qs:
        p = _get_or_create_profile(u)
        in_scope = False
        if p.role == UserProfile.Role.SUPER_ADMIN:
            in_scope = True  # 总管理员全局可见，始终通知
        elif p.role == UserProfile.Role.MODERATOR:
            if college_id and p.managed_majors.filter(id=college_id).exists():
                in_scope = True
            if p.can_moderate_general and material.course and material.course.course_type == 'general':
                in_scope = True
        else:  # SUB_MODERATOR
            if material.course and p.moderated_sections.filter(course=material.course).exists():
                in_scope = True
        if in_scope and u.id not in seen:
            seen.add(u.id)
            recipients.append(u)
    return recipients


@csrf_exempt
@require_login
def api_file_delete(request, file_id):
    """DELETE /api/files/<id>/delete/ — 删除文件"""
    if request.method != "DELETE":
        return _err("仅支持 DELETE", 405)

    material = get_object_or_404(Material, id=file_id)
    profile = _get_or_create_profile(request.user)

    # 自己上传的文件始终可删
    is_self_delete = material.uploader_id == request.user.id

    if profile.role == UserProfile.Role.SUPER_ADMIN:
        pass
    elif material.uploader_id == request.user.id:
        pass  # 自己上传的始终允许
    elif profile.role in (UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR):
        try:
            _check_moderator_access(request.user, material)
        except Exception:
            return _err("无权删除该资料", 403)
    else:
        return _err("无权删除该资料", 403)

    try:
        body = json.loads(request.body) if request.body else {}
    except Exception:
        body = {}
    delete_reason = body.get("reason", "")

    DeletionRecord.objects.create(
        material_id=material.id,
        title=material.title,
        file_name=material.file_name,
        file_size=material.file_size,
        course_code=material.course.code if material.course else "",
        course_name=material.course.name if material.course else "",
        college_id=material.course.college_id if material.course and material.course.college else None,
        uploader_name=material.uploader_name or (material.uploader.first_name if material.uploader else "匿名"),
        deleted_by=request.user,
        delete_reason=delete_reason,
    )

    # 非自删时通知辖区的版主/小版主（按资料所属学院匹配管辖范围）
    if not is_self_delete and material.course:
        for u in _scope_matched_moderators(material, request.user):
            _create_notification(
                recipient=u,
                type=Notification.Type.FILE_DELETED,
                title="辖区内的资料被删除",
                message=f"管理员{request.user.first_name or request.user.username}删除了你辖区内的资料「{material.title}」（{material.course.name if material.course else '未知课程'}）。",
                material=material,
                course_code=material.course.code if material.course else "",
                course_name=material.course.name if material.course else "",
                triggered_by=request.user,
            )

    if not is_self_delete and delete_reason and material.uploader and material.uploader_id != request.user.id:
        _create_notification(
            recipient=material.uploader,
            type=Notification.Type.FILE_DELETED,
            title="你的资料被管理员删除",
            message=f"管理员{request.user.first_name or request.user.username}删除了你的资料「{material.title}」（{material.course.name if material.course else '未知课程'}）。\n删除理由：{delete_reason}\n你可以在此课程目录下重新上传。",
            material=material,
            course_code=material.course.code if material.course else "",
            course_name=material.course.name if material.course else "",
            triggered_by=request.user,
        )

    if is_self_delete:
        _create_notification(
            recipient=request.user,
            type=Notification.Type.FILE_DELETED,
            title="你删除了资料",
            message=f"你已删除资料「{material.title}」（{material.course.name if material.course else '未知课程'}）。",
            course_code=material.course.code if material.course else "",
            course_name=material.course.name if material.course else "",
        )
        for admin in _scope_matched_moderators(material, request.user, include_super_admin=True):
            _create_notification(
                recipient=admin,
                type=Notification.Type.FILE_DELETED,
                title="用户自行删除资料",
                message=f"用户 {material.uploader_name or request.user.username} 删除了资料「{material.title}」（{material.course.name if material.course else '未知课程'}）。",
                course_code=material.course.code if material.course else "",
                course_name=material.course.name if material.course else "",
                triggered_by=request.user,
            )

    file_path = Path(settings.MEDIA_ROOT) / material.file_path
    if file_path.exists():
        file_path.unlink()

    material.delete()
    return _ok({"message": "文件已删除"})


@require_login
def api_file_detail(request, file_id):
    """GET /api/files/<id>/ — 返回单个文件的完整信息"""
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    material = get_object_or_404(
        Material.objects.select_related("material_type", "course", "uploader").annotate(
            favorite_count=Count("favorited_by")
        ),
        id=file_id,
    )
    user = request.user
    from .utils import Favorite
    is_favorited = Favorite.objects.filter(user=user, material=material).exists() if user.is_authenticated else False
    rs = material.review_status
    uploader_profile = getattr(material.uploader, 'profile', None) if material.uploader else None
    return _ok({
        "id": material.id,
        "title": material.title,
        "file_name": material.file_name,
        "file_size": material.file_size,
        "file_type": material.material_type.name if material.material_type else (material.file_type or "其他"),
        "user_material_type": material.material_type.name if material.material_type else "",
        "uploader": (material.uploader.first_name if material.uploader else material.uploader_name) or "匿名",
        "uploader_id": material.uploader_id or 0,
        "uploader_avatar": uploader_profile.avatar.url if uploader_profile and uploader_profile.avatar else "",
        "teacher": material.teacher,
        "description": material.description or "",
        "course_name": material.course.name if material.course else "",
        "course_code": material.course.code if material.course else "",
        "download_count": material.download_count,
        "favorite_count": getattr(material, "favorite_count", 0),
        "is_favorited": is_favorited,
        "created_at": material.created_at.strftime("%Y-%m-%d") if material.created_at else "",
        "review_status": rs,
        "is_uploader": user.is_authenticated and material.uploader_id == user.id,
        "can_download": material.is_approved or (user.is_authenticated and material.uploader_id == user.id),
        "can_delete": user.is_authenticated and _user_can_edit_material(user, material),
        "is_approved": material.is_approved,
    })

_ZIP_CACHE_MAX = 5000  # 单次响应上限（超过截断提示；正常课程资料远低于此）


def _pdf_preview_cache_path(file_id, file_path, max_pages):
    """计算 PDF 预览切割缓存文件路径。

    键含 文件id+大小+mtime+max_pages 指纹：文件被替换/更新时自动失效，未变则复用。
    存在 data/.pdf_cache/（MEDIA_ROOT 同级），跨进程共享，避免每次预览重复全量解析。
    """
    try:
        st = file_path.stat()
        key = f"{file_id}:{st.st_size}:{int(st.st_mtime)}:{max_pages}"
    except OSError:
        return None
    digest = hashlib.md5(key.encode('utf-8')).hexdigest()[:16]
    cache_dir = Path(settings.MEDIA_ROOT).parent / '.pdf_cache'
    return cache_dir / f"p{file_id}_{digest}.pdf"


def _zip_structure_cache_path(file_id, file_path):
    """计算 ZIP 结构缓存文件路径。

    键含 文件id+大小+mtime 指纹：文件被替换/更新时自动失效，未变则复用。
    存在 data/.zip_cache/（MEDIA_ROOT 同级），跨进程共享，避免每次预览重新解析。
    """
    try:
        st = file_path.stat()
        key = f"{file_id}:{st.st_size}:{int(st.st_mtime)}"
    except OSError:
        return None
    digest = hashlib.md5(key.encode('utf-8')).hexdigest()[:16]
    cache_dir = Path(settings.MEDIA_ROOT).parent / '.zip_cache'
    return cache_dir / f"z{file_id}_{digest}.json"


@csrf_exempt
def api_zip_structure(request, file_id):
    """GET /api/files/<id>/zip-structure/ — 返回ZIP文件内部文件列表。

    结构按文件指纹缓存到 data/.zip_cache/：同一文件第一个用户解析一次，
    后续预览直接读缓存 JSON，不再重复解压中央目录。
    """
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    material = get_object_or_404(Material, id=file_id)
    user = _get_user(request)
    if user is None:
        return _err("请先登录", 401)
    file_path = Path(settings.MEDIA_ROOT) / material.file_path
    if not file_path.exists():
        return _err("文件不存在", 404)
    if material.review_status != "approved":
        try:
            if material.review_status == "rejected":
                _check_moderator_access(user, material, allow_uploader=False)
            else:
                _check_moderator_access(user, material)
        except Exception:
            return _err("该资料未通过审核", 403)

    # 命中缓存 → 直接返回，跳过 ZIP 解析
    cache_path = _zip_structure_cache_path(file_id, file_path)
    if cache_path and cache_path.exists():
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                return _ok(json.load(f))
        except (OSError, ValueError):
            pass  # 缓存损坏则回退重新解析

    import zipfile
    try:
        with zipfile.ZipFile(str(file_path), 'r') as zf:
            items = []
            for info in zf.infolist():
                if info.is_dir():
                    continue  # 目录由前端从路径推导，无需下发
                items.append({
                    'name': info.filename,
                    'size': info.file_size,
                    'compressed_size': info.compress_size,
                })
        items.sort(key=lambda x: x['name'].lower())
        total = len(items)
        payload = {
            'file_name': material.file_name,
            'total': total,
            'items': items[: _ZIP_CACHE_MAX],
            'truncated': total > _ZIP_CACHE_MAX,
        }
        # 原子写缓存，供后续预览复用
        if cache_path:
            try:
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                tmp = cache_path.with_suffix('.tmp')
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(payload, f, ensure_ascii=False)
                os.replace(tmp, cache_path)
            except OSError:
                pass  # 缓存写入失败不影响主流程
        return _ok(payload)
    except zipfile.BadZipFile:
        return _err("文件已损坏或不是有效的ZIP文件", 400)
    except Exception:
        return _err("读取ZIP文件失败", 500)
