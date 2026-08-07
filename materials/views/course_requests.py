"""
BNU Sparks · 木铎星火 — 新建课程申请 API

- 用户端：创建申请、随附文件上传
- 管理端：待审列表（卡片消失规则）、批准（建课程文件夹→操作记录）、驳回、分段一键过审
"""
import json
import shutil
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .utils import (
    _err, _ok, _get_or_create_profile, _strip_exif, _create_notification,
    _get_category_preload, require_login, require_role,
    _sanitize_filename_part, _safe_dir_name, _blocked_upload_ext,
)
from ..models import (
    Course, CourseCategory, CourseCreationRequest, UserProfile, Material,
    Notification, FolderOperation,
)


# ═══════════════════════════════════════════════════════════════
# 路由辅助
# ═══════════════════════════════════════════════════════════════

def _category_path(cat):
    """分类节点面包屑字符串：'通识课 / 大学外语类 / …'"""
    parts = []
    p = cat
    while p:
        parts.append(p.name or f"#{p.id}")
        p = p.parent
    return " / ".join(reversed(parts))


def _category_covered(profile, cat):
    """cat 属于版主/小版主主责板块（自身或其祖先在 moderated_sections 中）"""
    if cat is None:
        return False
    sec_ids = set(profile.moderated_sections.values_list("id", flat=True))
    if cat.id in sec_ids:
        return True
    p = cat.parent
    while p:
        if p.id in sec_ids:
            return True
        p = p.parent
    return False


def _calculate_course_request_assignment(req):
    """按审核路由原则为新建课程申请指派管理员（返回 User 或 None）"""
    if req.course_type == CourseCreationRequest.Type.MAJOR:
        if req.target_category_id:
            for sm in UserProfile.objects.filter(
                role=UserProfile.Role.SUB_MODERATOR
            ).prefetch_related("moderated_sections"):
                if _category_covered(sm, req.target_category):
                    return sm.user
            if req.college_id:
                for m in UserProfile.objects.filter(
                    role=UserProfile.Role.MODERATOR
                ).prefetch_related("managed_majors"):
                    if m.managed_majors.filter(id=req.college_id).exists():
                        return m.user
        return None
    # GENERAL
    m = UserProfile.objects.filter(
        role=UserProfile.Role.MODERATOR, can_moderate_general=True
    ).first()
    if m:
        return m.user
    if req.general_category_id:
        for m2 in UserProfile.objects.filter(
            role=UserProfile.Role.MODERATOR
        ).prefetch_related("moderated_sections"):
            if _category_covered(m2, req.general_category):
                return m2.user
    return None


def _can_review_request(user, req):
    """管理员是否有权审核该申请"""
    profile = _get_or_create_profile(user)
    if profile.role == UserProfile.Role.SUPER_ADMIN:
        return True
    if req.assigned_moderator_id == user.id:
        return True
    if profile.role not in (UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR):
        return False
    if req.course_type == CourseCreationRequest.Type.GENERAL:
        if profile.can_moderate_general:
            return True
        return _category_covered(profile, req.general_category)
    if profile.role == UserProfile.Role.SUB_MODERATOR:
        return _category_covered(profile, req.target_category)
    if req.college_id and profile.managed_majors.filter(id=req.college_id).exists():
        return True
    return _category_covered(profile, req.target_category)


def _resolve_course_or_err(course_code, course_name, course_type, college):
    """新建课程申请的课程解析（v=147 修复前缀误配）。

    只做「精确代码」匹配：唯一 → 复用；多条同码 → 取有资料者/最早者；
    不存在 → 新建 Course。**禁用 startswith 前缀匹配**——否则 ECO11451/ECO1145
    会命中已有的 ECO11451222，导致多个不同代码的申请共享同一 Course 文件夹。
    """
    from django.core.exceptions import ObjectDoesNotExist, MultipleObjectsReturned
    try:
        return Course.objects.get(code=course_code), None
    except MultipleObjectsReturned:
        courses = Course.objects.filter(code=course_code).order_by("id")
        with_files = courses.filter(materials__is_approved=True).distinct()
        if with_files.count() == 1:
            return with_files.first(), None
        if with_files.count() > 1:
            return None, "课程代码不明确，请联系管理员"
        return courses.first(), None
    except ObjectDoesNotExist:
        return Course.objects.create(
            code=course_code, name=course_name,
            course_type=course_type, college=college,
        ), None


# ═══════════════════════════════════════════════════════════════
# 用户端
# ═══════════════════════════════════════════════════════════════

@csrf_exempt
@require_login
def api_course_request_create(request):
    """POST /api/courses/request/ — 创建新建课程申请"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body)
    except Exception:
        return _err("请求格式错误")

    course_type = (body.get("course_type") or "").strip()
    course_name = (body.get("course_name") or "").strip()
    course_code = (body.get("course_code") or "").strip().replace("*", "").replace("-", "")
    college_id = body.get("college_id")
    target_category_id = body.get("target_category_id")
    general_category_id = body.get("general_category_id")

    if course_type not in (CourseCreationRequest.Type.GENERAL, CourseCreationRequest.Type.MAJOR):
        return _err("请选择通识课或专业课")
    if not course_name:
        return _err("请填写课程名称")
    if not course_code:
        return _err("请填写课程代码（可在教务管理网站查询）")
    if course_type == CourseCreationRequest.Type.GENERAL and not general_category_id:
        return _err("请选择通识课类型")
    if course_type == CourseCreationRequest.Type.MAJOR and not target_category_id:
        return _err("请选择具体层级（目标课程文件夹）")

    req = CourseCreationRequest.objects.create(
        user=request.user,
        course_type=course_type,
        course_name=course_name,
        course_code=course_code,
        college_id=college_id or None,
        target_category_id=target_category_id or None,
        general_category_id=general_category_id or None,
    )
    assigned = _calculate_course_request_assignment(req)
    if assigned:
        req.assigned_moderator = assigned
        req.save(update_fields=["assigned_moderator"])

    _create_notification(
        recipient=request.user,
        type=Notification.Type.REPORT,
        title="新建课程申请已提交",
        message=f"你的新建课程申请「{course_name}」已提交，审核通过后将创建课程文件夹。",
        course_code=course_code, course_name=course_name,
    )
    return _ok({
        "id": req.id,
        "assigned_moderator": req.assigned_moderator_id,
        "assigned_moderator_name": (
            req.assigned_moderator.first_name or req.assigned_moderator.username
        ) if req.assigned_moderator else None,
    })


@csrf_exempt
@require_login
def api_course_request_upload_file(request, request_id):
    """POST /api/courses/request/<id>/files/ — 随附文件上传（每文件一次）"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    req = CourseCreationRequest.objects.filter(id=request_id).first()
    if req is None:
        return _err("申请不存在", 404)
    if req.user_id != request.user.id and not request.user.is_superuser:
        return _err("无权操作该申请", 403)
    if req.status != CourseCreationRequest.Status.PENDING:
        return _err("该申请已处理，无法再添加文件")

    title = request.POST.get("title", "").strip()
    teacher = request.POST.get("teacher", "").strip()
    material_type_id = request.POST.get("material_type_id", "").strip()
    description = request.POST.get("description", "").strip()
    uploaded_file = request.FILES.get("file")

    if not uploaded_file:
        return _err("文件不能为空")
    if not title:
        title = Path(uploaded_file.name).stem

    ext = Path(uploaded_file.name).suffix
    if _blocked_upload_ext(ext):
        return _err("该文件类型不允许上传（可能包含可执行/活动内容）", 400)
    clean_title = _sanitize_filename_part(title) or _sanitize_filename_part(Path(uploaded_file.name).stem) or "file"
    safe_name = f"{uuid4().hex[:12]}_{clean_title}{ext}"
    save_dir = Path(settings.MEDIA_ROOT) / "requests" / f"req_{req.id}"
    save_dir.mkdir(parents=True, exist_ok=True)
    with open(save_dir / safe_name, "wb") as f:
        for chunk in uploaded_file.chunks():
            f.write(chunk)
    _strip_exif(save_dir / safe_name)
    file_size = (save_dir / safe_name).stat().st_size

    material = Material.objects.create(
        course=None,
        creation_request=req,
        title=title,
        description=description,
        teacher=teacher,
        material_type_id=(
            int(material_type_id) if material_type_id and material_type_id.isdigit() else None
        ),
        file_name=uploaded_file.name,
        file_path=f"requests/req_{req.id}/{safe_name}",
        file_size=file_size,
        file_type=Path(uploaded_file.name).suffix.lstrip(".").lower() or "other",
        uploader=req.user,
        uploader_name=req.user.first_name or req.user.username,
        review_status="pending",
        is_approved=False,
        assigned_moderator=req.assigned_moderator,
    )

    try:
        from git_storage import commit_file
        commit_file(f"requests/req_{req.id}/{safe_name}")
    except Exception:
        pass

    _create_notification(
        recipient=req.user,
        type=Notification.Type.REPORT,
        title="资料已提交，等待审核",
        message=f"随新建课程申请上传的资料「{title}」已提交，审核通过后即可被下载。",
        course_code=req.course_code, course_name=req.course_name,
    )
    return _ok({"id": material.id, "title": material.title, "file_size": file_size})


@csrf_exempt
@require_login
def api_course_request_delete(request, request_id):
    """DELETE /api/courses/request/<id>/ — 取消未审核的申请（仅本人、pending）。

    v=147：随附文件上传中途失败时，前端用它清理半成品申请，
    避免重试时同一批文件被重复挂到多个新申请上。
    """
    if request.method != "DELETE":
        return _err("仅支持 DELETE", 405)
    req = CourseCreationRequest.objects.filter(
        id=request_id, user=request.user
    ).first()
    if req is None:
        return _err("申请不存在", 404)
    if req.status != CourseCreationRequest.Status.PENDING:
        return _err("申请已处理，无法取消")

    for m in req.materials.all():
        try:
            p = Path(settings.MEDIA_ROOT) / m.file_path
            if p.exists():
                p.unlink()
        except Exception:
            pass
        m.delete()
    req.delete()
    return _ok({"message": "已取消"})


# ═══════════════════════════════════════════════════════════════
# 管理端
# ═══════════════════════════════════════════════════════════════

@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_course_requests(request):
    """GET /api/moderation/course-requests/ — 待审核申请列表

    卡片消失规则（服务端强制）：status==pending，
    或 status==approved 但仍有随附文件处于 pending（等文件审完才消失）。
    """
    qs = CourseCreationRequest.objects.select_related(
        "user", "college", "assigned_moderator"
    ).prefetch_related("materials")

    def _visible(req):
        if not _can_review_request(request.user, req):
            return False
        if req.status == CourseCreationRequest.Status.PENDING:
            return True
        if req.status == CourseCreationRequest.Status.APPROVED:
            return any(
                m.review_status == "pending" for m in req.materials.all()
            )
        return False

    items = [r for r in qs if _visible(r)]

    def _serialize(req):
        mats = [
            {
                "id": m.id,
                "title": m.title,
                "file_name": m.file_name,
                "file_size": m.file_size,
                "review_status": m.review_status,
                "review_notes": m.review_notes if m.review_status == "rejected" else "",
                "created_at": m.created_at.strftime("%Y-%m-%d %H:%M") if m.created_at else "",
            }
            for m in req.materials.all()
        ]
        is_waiting_files = req.status == CourseCreationRequest.Status.APPROVED and any(
            m.review_status == "pending" for m in req.materials.all()
        )
        target = req.target_category or req.general_category
        return {
            "id": req.id,
            "course_type": req.course_type,
            "course_name": req.course_name,
            "course_code": req.course_code,
            "college_name": req.college.name if req.college_id else "",
            "target_path": _category_path(target) if target else "",
            "uploader_name": req.user.first_name or req.user.username,
            "uploader_id": req.user_id,
            "uploader_avatar": (
                req.user.profile.avatar.url
                if getattr(req.user, "profile", None) and req.user.profile.avatar else ""
            ),
            "created_at": req.created_at.strftime("%Y-%m-%d %H:%M") if req.created_at else "",
            "status": req.status,
            "is_waiting_files": is_waiting_files,
            "review_notes": req.review_notes,
            "assigned_moderator_name": (
                req.assigned_moderator.first_name or req.assigned_moderator.username
            ) if req.assigned_moderator_id else None,
            "is_own": req.user_id == request.user.id,
            "materials": mats,
        }

    return _ok([_serialize(r) for r in items])


def _approve_request(req, reviewer):
    """批准申请（事务内）：解析课程 → 建叶子 → 操作记录 → 随附文件归位"""
    course, err = _resolve_course_or_err(
        req.course_code, req.course_name, req.course_type,
        req.college if req.course_type == CourseCreationRequest.Type.MAJOR else None,
    )
    if err:
        return _err(err)

    parent = req.general_category if req.course_type == CourseCreationRequest.Type.GENERAL else req.target_category
    if parent is None:
        return _err("目标位置缺失，无法创建课程文件夹")

    max_order = CourseCategory.objects.filter(parent=parent).aggregate(m=Max("order"))["m"] or 0
    new_cat = CourseCategory.objects.create(
        name=req.course_name, parent=parent,
        order=max_order + 1, course=course,
    )
    FolderOperation.objects.create(
        user=reviewer, action=FolderOperation.Action.CREATE,
        category_id=new_cat.id, category_name=req.course_name,
        parent_path=_category_path(parent), folder_type="course",
        reason="新建课程申请",
    )

    # 随附材料全部归位到 {course.code}/，赋 course → 进入正常文件审核队列。
    # 归位 ALL 而非仅 pending：若版主在批准申请前先单独批准了随附文件，
    # 该文件若留在 NULL-course 会变成「已通过却无处可下载」的孤魂文件。
    for m in req.materials.all():
        try:
            old = Path(settings.MEDIA_ROOT) / m.file_path
            if old.exists():
                ext = Path(m.file_name).suffix
                clean_title = _sanitize_filename_part(m.title) or "file"
                new_name = f"{uuid4().hex[:12]}_{clean_title}{ext}"
                new_dir = Path(settings.MEDIA_ROOT) / _safe_dir_name(course.code)
                new_dir.mkdir(parents=True, exist_ok=True)
                shutil.move(str(old), str(new_dir / new_name))
                m.file_path = f"{course.code}/{new_name}"
                try:
                    from git_storage import commit_file
                    commit_file(f"{course.code}/{new_name}")
                except Exception:
                    pass
            m.course = course
            m.save(update_fields=["course", "file_path"])
        except Exception:
            m.course = course
            m.save(update_fields=["course"])

    req.status = CourseCreationRequest.Status.APPROVED
    req.reviewed_by = reviewer
    req.reviewed_at = timezone.now()
    req.save(update_fields=["status", "reviewed_by", "reviewed_at"])

    _create_notification(
        recipient=req.user,
        type=Notification.Type.OPERATION,
        title="新建课程申请已通过",
        message=f"你的申请「{req.course_name}」已通过，课程文件夹已创建。",
        course_code=req.course_code, course_name=req.course_name,
    )
    return None


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_course_request_approve(request, request_id):
    """POST /api/moderation/course-requests/<id>/approve/"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    req = CourseCreationRequest.objects.filter(id=request_id).first()
    if req is None:
        return _err("申请不存在", 404)
    if not _can_review_request(request.user, req):
        return _err("无权操作该申请", 403)
    if req.status == CourseCreationRequest.Status.APPROVED:
        return _err("该申请已通过")

    with transaction.atomic():
        err = _approve_request(req, request.user)
    if err is not None:
        return err
    return _ok({"id": req.id, "status": req.status})


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_course_request_reject(request, request_id):
    """POST /api/moderation/course-requests/<id>/reject/"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    req = CourseCreationRequest.objects.filter(id=request_id).first()
    if req is None:
        return _err("申请不存在", 404)
    if not _can_review_request(request.user, req):
        return _err("无权操作该申请", 403)
    try:
        body = json.loads(request.body)
    except Exception:
        return _err("请求格式错误")
    notes = (body.get("notes") or "").strip()
    if not notes:
        return _err("请填写驳回理由")

    with transaction.atomic():
        req.status = CourseCreationRequest.Status.REJECTED
        req.review_notes = notes
        req.reviewed_by = request.user
        req.reviewed_at = timezone.now()
        req.save(update_fields=["status", "review_notes", "reviewed_by", "reviewed_at"])

        # 随附 pending 材料一并驳回
        for m in req.materials.filter(review_status="pending"):
            m.review_status = "rejected"
            m.is_approved = False
            m.review_notes = notes
            m.reviewed_by = request.user
            m.reviewed_at = timezone.now()
            m.save(update_fields=["review_status", "is_approved", "review_notes", "reviewed_by", "reviewed_at"])
            _create_notification(
                recipient=req.user,
                type=Notification.Type.REJECTED,
                title="资料已被驳回",
                message=f"随新建课程申请上传的资料「{m.title}」已被驳回：{notes}",
                material=m,
            )

        _create_notification(
            recipient=req.user,
            type=Notification.Type.REJECTED,
            title="新建课程申请已被驳回",
            message=f"你的申请「{req.course_name}」已被驳回：{notes}",
            course_code=req.course_code, course_name=req.course_name,
        )
    return _ok({"id": req.id, "status": req.status})


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_moderation_course_requests_batch_approve(request):
    """POST /api/moderation/course-requests/batch-approve/ — 分段一键过审"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    qs = CourseCreationRequest.objects.select_related("college").prefetch_related("materials")
    pending = [r for r in qs if _can_review_request(request.user, r)
               and r.status == CourseCreationRequest.Status.PENDING]
    approved = 0
    for req in pending:
        try:
            with transaction.atomic():
                err = _approve_request(req, request.user)
            if err is None:
                approved += 1
        except Exception:
            continue
    return _ok({"approved_count": approved})
