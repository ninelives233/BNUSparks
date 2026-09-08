"""
BNU Sparks · 木铎星火 — 文件上传 API

file-upload, upload-text
"""

import json
from pathlib import Path

from django.conf import settings
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .utils_upload import (
    UploadTooLarge, _atomic_write_chunks, _atomic_write_text,
    _remove_uploaded_file,
)
from .utils import (
    _err, _ok, _get_or_create_profile,
    _strip_exif, _check_auto_approve,
    _review_candidates, _node_contains_course, _follow_merge,
    _create_notification,
    _sanitize_filename_part, _safe_dir_name, _blocked_upload_ext,
    require_login, _user_covers_course, ENFORCE_UPLOAD_SCOPE,
    UserProfile, Course, Material, Notification, MaterialType,
    CourseCategory,
)


def _notify_pending_upload(material, uploader, title, context_category):
    """上传已落库后的通知均为 best-effort，失败不能让客户端误以为上传失败而重试。"""
    try:
        for user in _review_candidates(material, context_category):
            if user.id == uploader.id:
                continue
            _create_notification(
                recipient=user,
                type=Notification.Type.NEW_PENDING,
                title="有新的待审核资料",
                message=f"「{title}」正在等待审核——多人同时可见，先审先得。",
                material=material,
            )
        _create_notification(
            recipient=uploader,
            type=Notification.Type.REPORT,
            title="资料已提交，等待审核",
            message=f"你的资料「{title}」已提交，审核通过后即可被其他同学下载。",
            material=material,
        )
    except Exception:
        pass


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
        # v=167 移除前缀匹配：曾用于「填前缀自动命中唯一课程」，但会静默挂错课程且
        # 磁盘目录用提交值（≠course.code）导致 rename/merge 漏迁。现一律精确匹配。
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

    # 同名合并别名课程：文件归入主课程目录（磁盘路径与展示一致）
    course = _follow_merge(course)

    # v170：上传上下文——用户从哪个专业节点进的上传，决定审核路由 L1/L2。
    # 节点不包含该课程（含伪造/跨学院）一律视为无上下文，路由回落到版主。
    context_category = None
    category_id = request.POST.get("category_id", "").strip()
    if category_id.isdigit():
        node = CourseCategory.objects.filter(id=int(category_id)).first()
        if node is not None and _node_contains_course(node, course):
            context_category = node

    # 所有会失败的元数据校验必须先于磁盘写入，避免 400 响应留下孤儿文件。
    mtid = None
    if material_type_id and material_type_id.isdigit():
        mtid = int(material_type_id)
        if not MaterialType.objects.filter(id=mtid).exists():
            return _err("资料类型不存在", 400)
    elif material_type_id:
        return _err("资料类型不存在", 400)

    from uuid import uuid4
    course_dir = _safe_dir_name(course.code)
    ext = Path(uploaded_file.name).suffix
    if _blocked_upload_ext(ext):
        return _err("该文件类型不允许上传（可能包含可执行/活动内容）", 400)
    clean_title = _sanitize_filename_part(title) or _sanitize_filename_part(Path(uploaded_file.name).stem) or "file"
    safe_name = f"{uuid4().hex[:12]}_{clean_title}{ext}"
    save_dir = Path(settings.MEDIA_ROOT) / course_dir
    final_path = save_dir / safe_name
    try:
        file_size = _atomic_write_chunks(uploaded_file, final_path)
        _strip_exif(final_path)
        file_size = final_path.stat().st_size
    except UploadTooLarge as exc:
        _remove_uploaded_file(final_path)
        return _err(str(exc), 413)
    except OSError:
        _remove_uploaded_file(final_path)
        return _err("文件保存失败，请稍后重试", 500)

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

    # 后备开关（默认关闭，ENFORCE_UPLOAD_SCOPE=False）：越辖区上传 → 走 pending 正常审核。
    # 仅对管理员角色生效；超管不受限；普通用户的自动托管通道不受影响。
    if is_auto_approved and ENFORCE_UPLOAD_SCOPE and profile.role != UserProfile.Role.SUPER_ADMIN \
            and not _user_covers_course(request.user, course):
        is_auto_approved = False
        auto_approved_by = None

    review_status = "approved" if is_auto_approved else "pending"

    try:
        material = Material.objects.create(
            course=course, title=title, description=description,
            teacher=teacher,
            material_type_id=mtid,
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
    except Exception:
        _remove_uploaded_file(final_path)
        return _err("资料保存失败，请稍后重试", 500)

    try:
        from git_storage import commit_file
        commit_file(f"{course_dir}/{safe_name}")
    except Exception:
        pass

    if review_status == "pending":
        # v171 广播式：不指派单一审核人（assigned_moderator 保持 None），
        # 把待审需求同时通知全部匹配候选——先审先得，审核动作原子归主。
        _notify_pending_upload(material, request.user, title, context_category)

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

    # 前端 category_id/material_type_id 以 JSON 整数发出（course.id），其余为字符串；
    # 统一 str() 兜底，避免 int 无 .strip() 直接 500（v176 修复）。
    course_code = str(data.get("course_code") or "").strip()
    title = str(data.get("title") or "").strip()
    teacher = str(data.get("teacher") or "").strip()
    description = str(data.get("description") or "").strip()
    material_type_id = str(data.get("material_type_id") or "").strip()
    content = str(data.get("content") or "").strip()

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
        # v=167 移除前缀匹配：曾用于「填前缀自动命中唯一课程」，但会静默挂错课程且
        # 磁盘目录用提交值（≠course.code）导致 rename/merge 漏迁。现一律精确匹配。
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

    # 同名合并别名课程：文件归入主课程目录（磁盘路径与展示一致）
    course = _follow_merge(course)

    # v170：上传上下文——用户从哪个专业节点进的上传，决定审核路由 L1/L2。
    # 节点不包含该课程（含伪造/跨学院）一律视为无上下文，路由回落到版主。
    context_category = None
    category_id = str(data.get("category_id") or "").strip()
    if category_id.isdigit():
        node = CourseCategory.objects.filter(id=int(category_id)).first()
        if node is not None and _node_contains_course(node, course):
            context_category = node

    # 先校验资料类型，再创建任何目录或文件。
    mtid = None
    if material_type_id and material_type_id.isdigit():
        mtid = int(material_type_id)
        if not MaterialType.objects.filter(id=mtid).exists():
            return _err("资料类型不存在", 400)
    elif material_type_id:
        return _err("资料类型不存在", 400)

    from uuid import uuid4
    course_dir = _safe_dir_name(course.code)
    clean_title = _sanitize_filename_part(title) or "text"
    safe_name = f"text_{uuid4().hex[:12]}_{clean_title}.txt"
    save_dir = Path(settings.MEDIA_ROOT) / course_dir
    final_path = save_dir / safe_name
    try:
        file_size = _atomic_write_text(content, final_path)
    except UploadTooLarge as exc:
        _remove_uploaded_file(final_path)
        return _err(str(exc), 413)
    except OSError:
        _remove_uploaded_file(final_path)
        return _err("文件保存失败，请稍后重试", 500)

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

    # 后备开关（默认关闭，ENFORCE_UPLOAD_SCOPE=False）：越辖区上传 → 走 pending 正常审核。
    # 仅对管理员角色生效；超管不受限；普通用户的自动托管通道不受影响。
    if is_auto_approved and ENFORCE_UPLOAD_SCOPE and profile.role != UserProfile.Role.SUPER_ADMIN \
            and not _user_covers_course(request.user, course):
        is_auto_approved = False
        auto_approved_by = None

    review_status = "approved" if is_auto_approved else "pending"

    try:
        material = Material.objects.create(
            course=course, title=title, description=description,
            teacher=teacher,
            material_type_id=mtid,
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
    except Exception:
        _remove_uploaded_file(final_path)
        return _err("资料保存失败，请稍后重试", 500)

    try:
        from git_storage import commit_file
        commit_file(f"{course_dir}/{safe_name}")
    except Exception:
        pass

    if review_status == "pending":
        # v171 广播式：不指派单一审核人（assigned_moderator 保持 None），
        # 把待审需求同时通知全部匹配候选——先审先得，审核动作原子归主。
        _notify_pending_upload(material, request.user, title, context_category)

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
