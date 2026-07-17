"""
BNU Sparks · 木铎星火 — 文件 API

file-upload, upload-text, download-token, download, delete
"""

import json
from pathlib import Path

from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User
from django.http import FileResponse
from django.conf import settings
from django.utils import timezone
from django.db.models import F

from .utils import (
    _err, _ok, _get_user, _get_or_create_profile,
    _generate_download_token, _verify_download_token,
    _strip_exif, _check_auto_approve, _check_download_quota,
    _check_moderator_access, _calculate_review_assignment,
    _create_notification, require_login,
    UserProfile, Course, Material, Notification,
    DownloadRecord, DeletionRecord, CourseCategory,
)


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
    ext = Path(uploaded_file.name).suffix
    safe_name = f"{uuid4().hex[:12]}_{title[:40]}{ext}"
    save_dir = Path(settings.MEDIA_ROOT) / course_code
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
        file_name=uploaded_file.name,
        file_path=f"{course_code}/{safe_name}",
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
    safe_name = f"text_{uuid4().hex[:12]}_{title[:40]}.txt"
    save_dir = Path(settings.MEDIA_ROOT) / course_code
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
        file_name=safe_name,
        file_path=f"{course_code}/{safe_name}",
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


def api_file_download(request, file_id):
    """GET /api/files/<id>/download — 支持 ?preview=1 内联预览"""
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

    if not material.is_approved:
        try:
            _check_moderator_access(user, material)
        except Exception:
            return _err("该资料未通过审核，暂不可下载", 403)

    is_preview = request.GET.get("preview") == "1"
    if is_preview:
        response = FileResponse(
            open(file_path, "rb"), as_attachment=False,
            filename=material.file_name or material.title,
        )
        response['X-Frame-Options'] = 'SAMEORIGIN'
        return response

    allowed, remaining, msg = _check_download_quota(user)
    if not allowed:
        return _err(msg, 429)

    Material.objects.filter(id=file_id).update(
        download_count=F('download_count') + 1
    )

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

    return FileResponse(
        open(file_path, "rb"), as_attachment=True,
        filename=material.file_name or material.title,
    )


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
        admins = User.objects.filter(
            profile__role__in=[UserProfile.Role.SUPER_ADMIN, UserProfile.Role.MODERATOR]
        ).exclude(id=request.user.id).distinct()
        for admin in admins:
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
