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
    _find_existing_course, _find_leaf_under_parent,
)
from .operations import _can_create_under
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


# ── v=165 新建课程前查重：课程代码已存在时判定「本专业树已有入口」vs「仅在他处」 ──

def _matching_course_ids(code):
    """该课程代码对应的全部 Course id 集合（同码多行收敛）。"""
    return set(Course.objects.filter(code=code).values_list("id", flat=True))


def _code_matches_wildcard(leaf_course_text, code):
    """通配叶子 course_text（如 GEN02***）是否覆盖该 code。

    与 _get_courses_in_category 同口径：去 * 与 - 后前缀匹配。
    """
    cleaned = (leaf_course_text or "").replace("*", "").replace("-", "")
    return bool(cleaned) and bool(code) and code.startswith(cleaned)


def _leaf_under_parent(leaf, parent):
    """叶子是否落在 parent 子树下（沿 parent 链上溯）。"""
    p = leaf.parent
    while p:
        if p.id == parent.id:
            return True
        p = p.parent
    return False


def _course_locations(code, parent=None):
    """该 code 在课程树中的所有叶子面包屑路径 + 是否已有入口落在 parent 下。

    返回 (locations: [str], in_target: bool)。叶子来源：course FK 命中 + 通配前缀命中。
    """
    course_ids = _matching_course_ids(code)
    leaves = list(CourseCategory.objects.filter(course_id__in=course_ids))
    leaves += [c for c in CourseCategory.objects.filter(course_id__isnull=True)
               if _code_matches_wildcard(c.course_text, code)]
    locations, in_target = [], False
    for leaf in leaves:
        path = _category_path(leaf)
        if path and path not in locations:
            locations.append(path)
        if parent is not None and _leaf_under_parent(leaf, parent):
            in_target = True
    return locations, in_target


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


def _request_covered_by_subordinate(req, sub_cat_ids):
    """申请目标位置是否落在任一下级版主（小版主）管辖板块内。

    v=153：新建课程申请与文件上传同样受「显示下级板块」开关控制——
    默认隐藏下级版主负责区域的申请，勾选后才显示（上级可越级处理）。
    """
    if not sub_cat_ids:
        return False
    cat = req.target_category or req.general_category
    p = cat
    while p:
        if p.id in sub_cat_ids:
            return True
        p = p.parent
    return False


def _resolve_course_or_err(course_code, course_name, course_type, college):
    """新建课程申请的课程解析（v=147 修复前缀误配 + v=165 同码收敛）。

    只做「精确代码」匹配：已存在（唯一或多行）→ 由 _find_existing_course
    确定性收敛复用；不存在 → 新建 Course。返回 (course, err, created)，
    created=True 表示本次新建，False=复用既有课程（即「壳」语义）。
    **禁用 startswith 前缀匹配**——否则 ECO11451/ECO1145 会命中已有的
    ECO11451222，导致多个不同代码的申请共享同一 Course 文件夹。
    """
    existing = _find_existing_course(
        course_code, college.pk if college is not None else None
    )
    if existing:
        return existing, None, False
    return Course.objects.create(
        code=course_code, name=course_name,
        course_type=course_type, college=college,
    ), None, True


@csrf_exempt
@require_login
def api_course_request_check(request):
    """GET /api/courses/request/check/ — 新建课程前查重（前端实时提示，v=165）

    ?course_code=&target_category_id=|general_category_id=   （target 二选一）
    返回 {exists, in_target, locations}：
      exists     该代码已存在（Course 有记录或课程树有覆盖叶子）
      in_target  该代码已有入口落在所选目标层级下 → 应引导直接上传
      locations  该代码在课程树中的全部叶子路径（面包屑）
    """
    code = (request.GET.get("course_code") or "").strip().replace("*", "").replace("-", "")
    target_id = request.GET.get("target_category_id") or request.GET.get("general_category_id")
    if not code:
        return _ok({"exists": False, "in_target": False, "locations": []})
    parent = CourseCategory.objects.filter(id=target_id).first() if target_id else None
    locations, in_target = _course_locations(code, parent)
    exists = Course.objects.filter(code=code).exists() or bool(locations)
    return _ok({
        "exists": exists,
        "in_target": in_target,
        "locations": locations,
    })


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

    # v=153：目标位置在管理员辖区内 → 与管理模式「新建」按钮一致，直接创建课程文件夹免审核。
    # 普通用户 / 辖区外提交仍走审核流程。
    profile = _get_or_create_profile(request.user)
    target_cat = None
    if course_type == CourseCreationRequest.Type.MAJOR and target_category_id:
        target_cat = CourseCategory.objects.filter(id=target_category_id).first()
    elif course_type == CourseCreationRequest.Type.GENERAL and general_category_id:
        target_cat = CourseCategory.objects.filter(id=general_category_id).first()
    is_auto = (
        profile.role != UserProfile.Role.USER
        and target_cat is not None
        and _can_create_under(request.user, target_cat)
    )

    # v=165：课程代码已存在时的提交端处理——
    #   目标位置已有该课程入口 → 引导直接上传，不创建申请（含 auto-approve 路径）；
    #   仅存在于别处 → 允许提交，批准后链接为「壳」节点（复用既有课程目录）。
    will_link = False
    existing_locations = []
    if Course.objects.filter(code=course_code).exists():
        locations, in_target = _course_locations(course_code, target_cat)
        if in_target:
            return _err(
                f"该课程已在本专业课程树「{locations[0] if locations else '该位置'}」中，"
                "请直接到对应目录上传资料",
                400,
            )
        will_link = True
        existing_locations = locations

    req = CourseCreationRequest.objects.create(
        user=request.user,
        course_type=course_type,
        course_name=course_name,
        course_code=course_code,
        college_id=college_id or None,
        target_category_id=target_category_id or None,
        general_category_id=general_category_id or None,
        auto_approved=is_auto,
    )

    if is_auto:
        try:
            with transaction.atomic():
                new_cat, err = _approve_request(req, request.user)
            if err is not None:
                raise RuntimeError("auto-approve failed")
        except Exception:
            # 自动建课失败（目标位置异常/课程代码冲突）→ 回退为普通待审申请
            is_auto = False
            req.auto_approved = False
            req.status = CourseCreationRequest.Status.PENDING
            req.save(update_fields=["auto_approved", "status"])
            _send_submit_notification(request.user, course_name, course_code)
            assigned = _calculate_course_request_assignment(req)
            if assigned:
                req.assigned_moderator = assigned
                req.save(update_fields=["assigned_moderator"])
            return _ok({
                "id": req.id,
                "auto_approved": False,
                "assigned_moderator": req.assigned_moderator_id,
                "will_link": will_link,
                "existing_locations": existing_locations,
            })
        return _ok({
            "id": req.id,
            "auto_approved": True,
            "category_id": new_cat.id,
            "parent_path": _category_path(new_cat.parent) if new_cat.parent else "",
            "course_name": new_cat.name,
            "will_link": will_link,
            "existing_locations": existing_locations,
        })

    _send_submit_notification(request.user, course_name, course_code)
    assigned = _calculate_course_request_assignment(req)
    if assigned:
        req.assigned_moderator = assigned
        req.save(update_fields=["assigned_moderator"])
    return _ok({
        "id": req.id,
        "auto_approved": False,
        "assigned_moderator": req.assigned_moderator_id,
        "assigned_moderator_name": (
            req.assigned_moderator.first_name or req.assigned_moderator.username
        ) if req.assigned_moderator else None,
        "will_link": will_link,
        "existing_locations": existing_locations,
    })


def _send_submit_notification(user, course_name, course_code):
    _create_notification(
        recipient=user,
        type=Notification.Type.REPORT,
        title="新建课程申请已提交",
        message=f"你的新建课程申请「{course_name}」已提交，审核通过后将创建课程文件夹。",
        course_code=course_code, course_name=course_name,
    )


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
    # v=153：管理员辖区内自动建课的申请（已 APPROVED 且 auto_approved）仍允许继续
    # 上传随附文件——文件直接归位到已创建的课程文件夹，进入正常文件审核队列。
    is_auto_upload = req.auto_approved and req.status == CourseCreationRequest.Status.APPROVED
    if req.status != CourseCreationRequest.Status.PENDING and not is_auto_upload:
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

    if is_auto_upload:
        # 已自动建课：随附文件直接归位到新课程文件夹（course 已绑定，进入正常审核队列）
        course, _, _ = _resolve_course_or_err(
            req.course_code, req.course_name, req.course_type,
            req.college if req.course_type == CourseCreationRequest.Type.MAJOR else None,
        )
        save_dir = Path(settings.MEDIA_ROOT) / _safe_dir_name(course.code)
        save_dir.mkdir(parents=True, exist_ok=True)
        material_course = course
        rel_path = f"{course.code}/{safe_name}"
        commit_rel = rel_path
    else:
        save_dir = Path(settings.MEDIA_ROOT) / "requests" / f"req_{req.id}"
        save_dir.mkdir(parents=True, exist_ok=True)
        material_course = None
        rel_path = f"requests/req_{req.id}/{safe_name}"
        commit_rel = rel_path

    with open(save_dir / safe_name, "wb") as f:
        for chunk in uploaded_file.chunks():
            f.write(chunk)
    _strip_exif(save_dir / safe_name)
    file_size = (save_dir / safe_name).stat().st_size

    material = Material.objects.create(
        course=material_course,
        creation_request=req,
        title=title,
        description=description,
        teacher=teacher,
        material_type_id=(
            int(material_type_id) if material_type_id and material_type_id.isdigit() else None
        ),
        file_name=uploaded_file.name,
        file_path=rel_path,
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
        commit_file(commit_rel)
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
    include_subordinate = request.GET.get("include_subordinate") == "1"
    # 下级版主（小版主）管辖板块 id 集合，用于「显示下级板块」分流。
    # 仅版主/总管理员需要越级查看；小版主不参与（与 _get_subordinate_covered_course_ids 同口径）
    sub_cat_ids = set()
    profile = _get_or_create_profile(request.user)
    if profile.role in (UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN):
        sub_cat_ids = set(
            UserProfile.objects.filter(role=UserProfile.Role.SUB_MODERATOR)
            .exclude(user=request.user)
            .values_list("moderated_sections__id", flat=True)
        )
    qs = CourseCreationRequest.objects.select_related(
        "user", "college", "assigned_moderator",
        "target_category", "general_category",
    ).prefetch_related("materials")

    def _visible(req):
        if not _can_review_request(request.user, req):
            return False
        # 默认隐藏下级版主负责区域的申请，勾选「显示下级板块」后才显示
        if not include_subordinate and _request_covered_by_subordinate(req, sub_cat_ids):
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
        # v=165：pending 申请若代码已存在 → 徽标「将链接到既有课程」，批准后为壳节点
        linked_course = (
            _find_existing_course(req.course_code) if req.status == CourseCreationRequest.Status.PENDING else None
        )
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
            "will_link": linked_course is not None,
            "existing_course_name": linked_course.name if linked_course else "",
            "materials": mats,
        }

    return _ok([_serialize(r) for r in items])


def _approve_request(req, reviewer):
    """批准申请（事务内）：解析课程（壳语义）→ 建/复用叶子 → 操作记录 → 随附文件归位。

    返回 (new_cat, None) 成功 / (None, _err响应) 失败，便于调用方拿到新目录跳转。
    v=165：课程已存在时复用为「壳」；目标位置已有同课程叶子时不再重复创建节点。
    """
    course, err, created = _resolve_course_or_err(
        req.course_code, req.course_name, req.course_type,
        req.college if req.course_type == CourseCreationRequest.Type.MAJOR else None,
    )
    if err:
        return None, _err(err)

    parent = req.general_category if req.course_type == CourseCreationRequest.Type.GENERAL else req.target_category
    if parent is None:
        return None, _err("目标位置缺失，无法创建课程文件夹")

    linked = not created
    existing_leaf = _find_leaf_under_parent(parent, course)
    if existing_leaf:
        # 目标位置已有同课程入口 → 复用叶子，不重复创建节点（文件仍归位到既有课程目录）
        new_cat = existing_leaf
        FolderOperation.objects.create(
            user=reviewer, action=FolderOperation.Action.CREATE,
            category_id=new_cat.id, category_name=new_cat.name or f"#{new_cat.id}",
            parent_path=_category_path(parent), folder_type="course",
            reason="新建课程申请（目标位置已有同课程入口，未新建节点）",
        )
    else:
        max_order = CourseCategory.objects.filter(parent=parent).aggregate(m=Max("order"))["m"] or 0
        reason = "新建课程申请"
        if linked:
            reason += f"（已链接到既有课程 {course.code}）"
        new_cat = CourseCategory.objects.create(
            name=course.name or req.course_name, parent=parent,
            order=max_order + 1, course=course,
        )
        FolderOperation.objects.create(
            user=reviewer, action=FolderOperation.Action.CREATE,
            category_id=new_cat.id, category_name=new_cat.name or req.course_name,
            parent_path=_category_path(parent), folder_type="course",
            reason=reason,
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

    if linked:
        _create_notification(
            recipient=req.user,
            type=Notification.Type.OPERATION,
            title="新建课程申请已通过（已链接既有课程）",
            message=(
                f"你的申请「{req.course_name}」已通过。该课程已存在（{req.course_code}），"
                "已链接到既有课程目录，未新建独立文件夹；你随附的资料已归入该课程。"
            ),
            course_code=req.course_code, course_name=req.course_name,
        )
    else:
        _create_notification(
            recipient=req.user,
            type=Notification.Type.OPERATION,
            title="新建课程申请已通过",
            message=f"你的申请「{req.course_name}」已通过，课程文件夹已创建。",
            course_code=req.course_code, course_name=req.course_name,
        )
    return new_cat, None


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
        _cat, err = _approve_request(req, request.user)
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
                _cat, err = _approve_request(req, request.user)
            if err is None:
                approved += 1
        except Exception:
            continue
    return _ok({"approved_count": approved})
