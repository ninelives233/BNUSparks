"""
BNU Sparks · 木铎星火 — 文件管理 & 文件夹管理 API

file-update, folder-CRUD (3 types), rename, move, set-course,
operations, folder-restore, batch-delete/edit, restore-deletion
"""

import json
import shutil
from datetime import timedelta
from pathlib import Path

from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User
from django.db.models import Q, Max
from django.db import transaction
from django.conf import settings
from django.utils import timezone

from .utils import (
    _err, _ok, _get_or_create_profile, _create_notification,
    _check_moderator_access, _get_courses_in_category,
    _get_category_preload, _safe_dir_name, _get_visible_deletion_records,
    _safe_int,
    require_login, require_role,
    UserProfile, Material, Course, CourseCategory, College,
    Notification, FolderOperation, DeletionRecord,
)


@csrf_exempt
@require_login
def api_file_update(request, file_id):
    """PATCH /api/files/<id>/update/ — 更新文件元信息"""
    if request.method != "PATCH":
        return _err("仅支持 PATCH", 405)
    material = get_object_or_404(Material, id=file_id)
    profile = _get_or_create_profile(request.user)
    if material.uploader_id != request.user.id:
        if profile.role not in (UserProfile.Role.SUPER_ADMIN, UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR):
            return _err("无权编辑", 403)
        try:
            _check_moderator_access(request.user, material)
        except Exception:
            return _err("无权编辑该资料", 403)
    try:
        body = json.loads(request.body)
    except Exception:
        return _err("请求格式错误")
    updated = []
    if "title" in body and body["title"].strip():
        material.title = body["title"].strip()
        updated.append("title")
    if "teacher" in body:
        material.teacher = body["teacher"].strip()
        updated.append("teacher")
    if "description" in body:
        material.description = body["description"].strip()
        updated.append("description")
    if "material_type_id" in body:
        mtid = body["material_type_id"]
        if mtid and str(mtid).isdigit():
            material.material_type_id = int(mtid)
            updated.append("material_type")
        elif mtid == "" or mtid is None:
            material.material_type = None
            updated.append("material_type")
    if updated:
        material.save(update_fields=updated)
    return _ok({
        "id": material.id, "title": material.title,
        "teacher": material.teacher, "description": material.description,
        "material_type_id": material.material_type_id,
    })


def _next_custom_code():
    """生成下一个自建课程代码 UNBxxxxx"""
    prefix = "UNB"
    existing = Course.objects.filter(code__startswith=prefix)
    if not existing.exists():
        return f"{prefix}00001"
    max_code = existing.aggregate(m=Max('code'))['m']
    num = int(max_code.replace(prefix, '')) + 1
    return f"{prefix}{num:05d}"


def _check_category_scope(user, cat):
    """检查用户是否有权操作该 CourseCategory 节点（适配于 CourseCategory 而非 Material）"""
    profile = _get_or_create_profile(user)
    if profile.role == UserProfile.Role.SUPER_ADMIN:
        return True
    if profile.role == UserProfile.Role.USER:
        return False
    if cat.parent is None:
        return False  # 根节点（专业课/通识课）仅 super_admin 可编辑

    _get_category_preload()  # 预热分类缓存，后续 3 次 _get_courses_in_category 走内存版

    # 收集该节点下的关联课程
    related_courses = _get_courses_in_category(cat)

    if profile.role == UserProfile.Role.SUB_MODERATOR:
        # 学院一级节点（根的直属子节点）：小版主一律不可编辑
        college_node = _find_college_node(cat)
        if college_node is not None and college_node.pk == cat.pk:
            return False
        for section in profile.moderated_sections.all():
            section_courses = _get_courses_in_category(section)
            for rc in related_courses:
                if rc in section_courses:
                    return True
        # 纯中间节点（无 course）：小版主允许操作管辖板块下
        if not related_courses:
            for section in profile.moderated_sections.all():
                if cat.pk == section.pk or _is_descendant(cat, section):
                    return True
        return False

    if profile.role == UserProfile.Role.MODERATOR:
        # 一级节点（根的直接子节点 = 学院/通识分类）：版主不能编辑自己管辖学院的一级目录
        college_node = _find_college_node(cat)
        if college_node is not None and college_node.pk == cat.pk:
            ccourses = _get_courses_in_category(college_node)
            if any(
                rc.college_id
                and profile.managed_majors.filter(id=rc.college_id).exists()
                for rc in ccourses
            ):
                return False

        # 有课程节点：按课程学院匹配
        for rc in related_courses:
            if rc.college_id and profile.managed_majors.filter(id=rc.college_id).exists():
                return True
            if not rc.college_id and profile.can_moderate_general:
                return True
            for section in profile.moderated_sections.all():
                section_courses = _get_courses_in_category(section)
                if rc in section_courses:
                    return True

        # 无课程纯节点：属某管辖学院子树的严格后代也可操作（含版主新建的中间节点）
        if not related_courses:
            if college_node is not None and college_node.pk != cat.pk:
                ccourses = _get_courses_in_category(college_node)
                if any(
                    rc.college_id
                    and profile.managed_majors.filter(id=rc.college_id).exists()
                    for rc in ccourses
                ):
                    return True
            if profile.can_moderate_general:
                return True
            for section in profile.moderated_sections.all():
                if cat.pk == section.pk or _is_descendant(cat, section):
                    return True
        return False

    return False


def _is_descendant(cat, ancestor):
    """检查 cat 是否是 ancestor 的后代节点"""
    p = cat.parent
    while p:
        if p.pk == ancestor.pk:
            return True
        p = p.parent
    return False


def _find_college_node(cat):
    """返回 cat 所属的最顶层一级节点（根的直接子节点 = 学院/通识分类节点）。

    cat 本身就是一级节点时返回自身；cat 是根时返回 None。
    """
    chain = []
    p = cat
    while p:
        chain.append(p)
        p = p.parent
    if len(chain) < 2:
        return None
    return chain[-2]  # 根的直属子节点


def _can_create_under(user, cat):
    """判断用户是否可以在 cat 下创建子文件夹。

    与编辑节点本身（_check_category_scope）是两回事：
    - 版主可在「所管辖学院的一级节点」下新建专业文件夹，但**不能**重命名/移动/
      删除该学院节点本身（那由 _check_category_scope 拦截，保证学院卡不可编辑）。
    - 其余场景（学院下级、通识课、小版主板块内）复用 _check_category_scope。
    """
    profile = _get_or_create_profile(user)
    if profile.role == UserProfile.Role.SUPER_ADMIN:
        return True
    if profile.role == UserProfile.Role.USER:
        return False
    if cat.parent is None:
        return False  # 根下新建（学院）仅 super_admin

    if profile.role == UserProfile.Role.MODERATOR:
        # 专业课学院一级节点：属管辖学院 → 允许在其下新建
        college_node = _find_college_node(cat)
        if college_node is not None and college_node.pk == cat.pk:
            if cat.parent.name == '专业课':
                ccourses = _get_courses_in_category(college_node)
                if any(
                    rc.college_id
                    and profile.managed_majors.filter(id=rc.college_id).exists()
                    for rc in ccourses
                ):
                    return True

    return _check_category_scope(user, cat)


def _managed_college_subtree_ids(college_ids):
    """返回版主管辖学院子树内的全部 CourseCategory id（含学院一级节点自身）。

    学院一级节点 = 根（parent=None）的直接子节点；某一级节点属于管辖学院 ⟺ 其子树内
    课程 college_id ∈ college_ids。用 _get_category_preload 内存模式遍历，避免 N+1。
    """
    college_ids = set(college_ids or [])
    if not college_ids:
        return set()
    _get_category_preload()
    all_cats = list(CourseCategory.objects.all())
    child_map = {}
    root_ids = set()
    for c in all_cats:
        child_map.setdefault(c.parent_id, []).append(c)
        if c.parent_id is None:
            root_ids.add(c.id)
    result = set()
    for c in all_cats:
        if c.parent_id is not None and c.parent_id in root_ids:
            ccourses = _get_courses_in_category(c)
            if any(rc.college_id and rc.college_id in college_ids for rc in ccourses):
                result.add(c.id)
                stack = list(child_map.get(c.id, []))
                while stack:
                    node = stack.pop()
                    result.add(node.id)
                    stack.extend(child_map.get(node.id, []))
    return result


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_folder_create(request):
    """POST /api/folders/create/ — 新建文件夹（支持三种类型）

    folder_type:
      intermediate — 中间节点（纯父节点，无课程绑定）
      course       — 课程节点（需 course_code + course_name）
      custom       — 自建文件夹（自动编号 UNBxxxxx）
    """
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body)
    except Exception:
        return _err("请求格式错误")
    name = (body.get("name") or "").strip()
    parent_id = body.get("parent_id")
    folder_type = body.get("folder_type", "intermediate")
    if not name:
        return _err("文件夹名称不能为空")

    if parent_id:
        parent = get_object_or_404(CourseCategory, id=parent_id)
        if not _can_create_under(request.user, parent):
            return _err("无权在该目录下创建文件夹", 403)
    else:
        # 根下新建（学院一级节点）仅 super_admin
        profile = _get_or_create_profile(request.user)
        if profile.role != UserProfile.Role.SUPER_ADMIN:
            return _err("无权在根目录下创建文件夹", 403)
        parent = None

    course = None
    if folder_type == "course":
        course_code = (body.get("course_code") or "").strip()
        course_name = (body.get("course_name") or "").strip()
        if not course_code:
            return _err("课程节点必须填写课程代码")
        if not course_name:
            return _err("课程节点必须填写课程名称")
        matched = Course.objects.filter(code=course_code)
        if matched.count() == 1:
            course = matched.first()
        elif matched.count() > 1:
            return _err(f"课程代码 {course_code} 对应多个课程，请检查数据", 400)
        else:
            course = Course.objects.create(
                code=course_code, name=course_name,
                course_type="major",
            )
    elif folder_type == "custom":
        auto_code = _next_custom_code()
        course = Course.objects.create(
            code=auto_code, name=name,
            course_type="major",
        )

    cat = CourseCategory.objects.create(
        name=name, parent=parent, order=0, course=course,
    )

    # 写日志
    path_parts = []
    p = cat.parent
    while p:
        path_parts.append(p.name or f"#{p.id}")
        p = p.parent
    parent_path = "/".join(reversed(path_parts))
    FolderOperation.objects.create(
        user=request.user, action=FolderOperation.Action.CREATE,
        category_id=cat.id, category_name=cat.name,
        parent_path=parent_path, folder_type=folder_type,
    )
    return _ok({
        "id": cat.id, "name": cat.name, "parent_id": cat.parent_id,
        "course_code": course.code if course else None,
        "folder_type": folder_type,
    })


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_folder_delete(request, folder_id):
    """DELETE /api/folders/<id>/ — 删除文件夹（去皮式：子节点上提给祖父）"""
    if request.method != "DELETE":
        return _err("仅支持 DELETE", 405)
    cat = get_object_or_404(CourseCategory, id=folder_id)

    # 权限检查
    if not _check_category_scope(request.user, cat):
        return _err("无权删除该文件夹", 403)

    children = list(CourseCategory.objects.filter(parent=cat))
    child_count = len(children)

    # 记录操作前信息
    path_parts = []
    p = cat.parent
    while p:
        path_parts.append(p.name or f"#{p.id}")
        p = p.parent
    parent_path = "/".join(reversed(path_parts))
    cat_name = cat.name or f"#{cat.id}"
    cat_id = cat.id
    grandparent_id = cat.parent_id

    # 去皮：子节点上提给祖父
    if child_count > 0:
        for child in children:
            child.parent_id = grandparent_id
            child.save(update_fields=["parent_id"])

    # 只解除 Course 关联（不删 Course 对象）
    if cat.course_id:
        cat.course = None
        cat.save(update_fields=["course"])

    cat.delete()

    # 写日志
    FolderOperation.objects.create(
        user=request.user, action=FolderOperation.Action.DELETE,
        category_id=cat_id, category_name=cat_name,
        parent_path=parent_path, folder_type="",
        reason=f"已删除，{'，'.join((
            f'{child_count} 个子节点已上提至父节点' if child_count else '',
        ))}" if child_count else "",
    )

    # 非 super_admin 删文件夹→通知 super_admin
    if request.user.profile.role != UserProfile.Role.SUPER_ADMIN:
        admins = User.objects.filter(
            profile__role=UserProfile.Role.SUPER_ADMIN
        ).exclude(id=request.user.id)
        peel_note = f"，其{child_count}个子节点已上提至父节点" if child_count else ""
        for admin in admins:
            _create_notification(
                recipient=admin, type=Notification.Type.OPERATION,
                title="文件夹被删除",
                message=f"{request.user.first_name or request.user.username} 删除了文件夹「{cat_name}」（路径：{parent_path}）{peel_note}。",
                triggered_by=request.user,
            )
    return _ok({
        "message": f"文件夹「{cat_name}」已删除",
        "peeled_children": child_count,
    })


@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_operations(request):
    """GET /api/operations/ — 文件夹操作记录"""
    profile = _get_or_create_profile(request.user)
    qs = FolderOperation.objects.all().select_related("user")
    if profile.role == UserProfile.Role.SUPER_ADMIN:
        pass
    else:
        visible_cat_ids = set(profile.moderated_sections.values_list("id", flat=True))
        if profile.role == UserProfile.Role.MODERATOR:
            college_ids = list(profile.managed_majors.values_list("id", flat=True))
            visible_cat_ids |= _managed_college_subtree_ids(college_ids)
        if visible_cat_ids:
            qs = qs.filter(category_id__in=visible_cat_ids)
        else:
            qs = qs.none()

    page = _safe_int(request.GET.get("page"), 1, lo=1)
    per_page = min(_safe_int(request.GET.get("per_page"), 20, lo=1), 100)
    total = qs.count()
    total_pages = (total + per_page - 1) // per_page if total > 0 else 1
    start = (page - 1) * per_page
    records = qs[start:start + per_page]

    now = timezone.now()

    def _serialize(op):
        can_restore = False
        if not op.is_restored:
            age = now - op.created_at
            if age.total_seconds() < 48 * 3600:
                p = _get_or_create_profile(request.user)
                if p.role == UserProfile.Role.SUPER_ADMIN or op.user_id == request.user.id:
                    can_restore = True
        return {
            "id": op.id, "user_id": op.user_id,
            "user_name": op.user.first_name or op.user.username if op.user else "未知",
            "action": op.action, "action_label": op.get_action_display(),
            "category_id": op.category_id, "category_name": op.category_name,
            "parent_path": op.parent_path, "folder_type": op.folder_type,
            "reason": op.reason or "", "is_restored": op.is_restored,
            "can_restore": can_restore,
            "created_at": op.created_at.strftime("%Y-%m-%d %H:%M") if op.created_at else "",
        }

    return _ok({
        "items": [_serialize(r) for r in records],
        "total": total, "page": page, "per_page": per_page, "total_pages": total_pages,
    })


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_folder_restore(request, operation_id):
    """POST /api/operations/<id>/restore/ — 撤销文件夹操作"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    op = get_object_or_404(FolderOperation, id=operation_id)
    if op.is_restored:
        return _err("该操作已撤销", 400)
    # 作用域校验：与列表端 can_restore 规则一致——仅超管或操作者本人可撤销
    profile = _get_or_create_profile(request.user)
    if profile.role != UserProfile.Role.SUPER_ADMIN and op.user_id != request.user.id:
        return _err("无权撤销该操作", 403)
    if timezone.now() - op.created_at > timedelta(hours=48):
        return _err("已超过48小时，无法撤销", 400)
    try:
        body = json.loads(request.body) if request.body else {}
    except Exception:
        body = {}
    reason = body.get("reason", "")

    if op.action == FolderOperation.Action.CREATE:
        try:
            cat = CourseCategory.objects.get(id=op.category_id)
            if cat.course_id or cat.course_text:
                return _err("无法撤销：该文件夹已被系统使用", 400)
            cat.delete()
        except CourseCategory.DoesNotExist:
            pass
    elif op.action == FolderOperation.Action.DELETE:
        CourseCategory.objects.create(name=op.category_name, parent=None, order=0)

    op.is_restored = True
    op.restored_at = timezone.now()
    op.restored_by = request.user
    op.reason = reason
    op.save(update_fields=["is_restored", "restored_at", "restored_by", "reason"])

    if reason and op.user and op.user_id != request.user.id:
        _create_notification(
            recipient=op.user, type=Notification.Type.OPERATION,
            title="你的文件夹操作已被撤销",
            message=f"{request.user.first_name or request.user.username} 撤销了你的文件夹「{op.category_name}」的「{op.get_action_display()}」操作。\n撤销理由：{reason}",
            triggered_by=request.user,
        )

    return _ok({"message": "操作已撤销"})


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_restore_deletion(request, deletion_id):
    """POST /api/moderation/deletions/<id>/restore/ — 恢复已删除文件"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    dr = get_object_or_404(DeletionRecord, id=deletion_id)
    if dr.is_restored:
        return _err("该文件已恢复", 400)
    if timezone.now() - dr.deleted_at > timedelta(hours=48):
        return _err("已超过48小时，无法恢复", 400)
    # 作用域校验：与列表端 _get_visible_deletion_records 一致，防止越权恢复管辖外记录
    profile = _get_or_create_profile(request.user)
    if profile.role != UserProfile.Role.SUPER_ADMIN:
        visible_ids = set(_get_visible_deletion_records(request.user).values_list("id", flat=True))
        if dr.id not in visible_ids:
            return _err("无权恢复该记录", 403)
    try:
        body = json.loads(request.body) if request.body else {}
    except Exception:
        body = {}
    reason = body.get("reason", "")

    course = Course.objects.filter(code=dr.course_code).first()
    if not course:
        return _err("原课程已不存在，无法恢复", 400)
    material = Material.objects.create(
        course=course, title=dr.title, file_name=dr.file_name,
        file_size=dr.file_size, file_path="",
        uploader_name=dr.uploader_name,
        review_status="approved", is_approved=True,
        reviewed_by=dr.deleted_by,
    )
    dr.is_restored = True
    dr.restored_at = timezone.now()
    dr.restored_by = request.user
    dr.save(update_fields=["is_restored", "restored_at", "restored_by"])

    original_uploader = User.objects.filter(username=dr.uploader_name).first()
    if original_uploader and original_uploader != request.user:
        _create_notification(
            recipient=original_uploader, type=Notification.Type.OPERATION,
            title="你的资料已被恢复",
            message=f"管理员恢复了你的资料「{dr.title}」，现在可以查看和下载了。",
            material=material, triggered_by=request.user,
        )

    if reason and dr.deleted_by and dr.deleted_by_id != request.user.id:
        _create_notification(
            recipient=dr.deleted_by, type=Notification.Type.OPERATION,
            title="你的删除操作已被撤销",
            message=f"管理员撤销了你对资料「{dr.title}」的删除操作。撤销理由：{reason}",
            material=material, course_code=dr.course_code,
            course_name=dr.course_name, triggered_by=request.user,
        )

    return _ok({"message": "文件已恢复", "material_id": material.id})


@csrf_exempt
@require_login
def api_file_batch_delete(request):
    """POST /api/files/batch-delete/ — 批量删除文件"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body)
    except Exception:
        return _err("请求格式错误")
    file_ids = body.get("file_ids", [])
    reason = body.get("reason", "")
    if not file_ids:
        return _err("请选择要删除的文件")
    profile = _get_or_create_profile(request.user)
    deleted = 0
    errors = []
    for fid in file_ids:
        try:
            m = Material.objects.get(id=fid)
            if profile.role == UserProfile.Role.SUPER_ADMIN:
                pass
            elif m.uploader_id == request.user.id:
                if m.review_status not in ("rejected",):
                    errors.append(f"文件#{fid}：仅可删除已驳回资料")
                    continue
            elif profile.role in (UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR):
                try:
                    _check_moderator_access(request.user, m)
                except Exception:
                    errors.append(f"文件#{fid}：无权删除")
                    continue
            else:
                errors.append(f"文件#{fid}：无权删除")
                continue
            DeletionRecord.objects.create(
                material_id=m.id, title=m.title,
                file_name=m.file_name, file_size=m.file_size,
                course_code=m.course.code if m.course else "",
                course_name=m.course.name if m.course else "",
                college_id=m.course.college_id if m.course and m.course.college else None,
                uploader_name=m.uploader_name or (m.uploader.first_name if m.uploader else "匿名"),
                deleted_by=request.user, delete_reason=reason,
            )
            m.delete()
            deleted += 1
        except Material.DoesNotExist:
            errors.append(f"文件#{fid}：不存在")
    if deleted > 0 and reason:
        notified_uploaders = set()
        for fid in file_ids:
            try:
                m = Material.objects.get(id=fid)
                if m.uploader and m.uploader_id not in notified_uploaders:
                    if m.uploader_id != request.user.id:
                        _create_notification(
                            recipient=m.uploader, type=Notification.Type.FILE_DELETED,
                            title="你的资料被管理员批量删除",
                            message=f"管理员批量删除了你的一部分资料。\n删除理由：{reason}\n如有疑问请联系管理员。",
                            course_code=m.course.code if m.course else "",
                            course_name=m.course.name if m.course else "",
                            triggered_by=request.user,
                        )
                        notified_uploaders.add(m.uploader_id)
            except Material.DoesNotExist:
                continue
    return _ok({"deleted": deleted, "errors": errors, "total": len(file_ids)})


@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_file_batch_edit(request):
    """POST /api/files/batch-edit/ — 批量修改文件元信息"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body)
    except Exception:
        return _err("请求格式错误")
    file_ids = body.get("file_ids", [])
    if not file_ids:
        return _err("请选择文件")
    updated = 0
    for fid in file_ids:
        try:
            m = Material.objects.get(id=fid)
            try:
                _check_moderator_access(request.user, m)
            except Exception:
                continue
            changed = False
            update_fields = []
            if "teacher" in body:
                m.teacher = body["teacher"].strip()
                changed = True
                update_fields.append("teacher")
            if "description" in body:
                m.description = body["description"].strip()
                changed = True
                update_fields.append("description")
            if "material_type_id" in body:
                mtid = body["material_type_id"]
                if mtid and str(mtid).isdigit():
                    m.material_type_id = int(mtid)
                    changed = True
                    update_fields.append("material_type")
                elif mtid == "" or mtid is None:
                    m.material_type = None
                    changed = True
                    update_fields.append("material_type")
            if changed:
                m.save(update_fields=update_fields)
                updated += 1
        except Material.DoesNotExist:
            continue
    return _ok({"updated": updated})


# ═══════════════════════════════════════════════════════════════
# 课程树管理 API — 管理模式编辑
# ═══════════════════════════════════════════════════════════════

@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_folder_rename(request, folder_id):
    """POST /api/folders/<id>/rename/ — 重命名文件夹"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    cat = get_object_or_404(CourseCategory, id=folder_id)

    if not _check_category_scope(request.user, cat):
        return _err("无权操作", 403)

    try:
        body = json.loads(request.body)
    except Exception:
        return _err("请求格式错误")

    new_name = (body.get("name") or "").strip()
    if not new_name:
        return _err("名称不能为空")

    old_name = cat.name or f"#{cat.id}"
    cat.name = new_name
    cat.save(update_fields=["name"])

    path_parts = []
    p = cat.parent
    while p:
        path_parts.append(p.name or f"#{p.id}")
        p = p.parent
    parent_path = "/".join(reversed(path_parts))

    FolderOperation.objects.create(
        user=request.user, action="rename", folder_type="",
        category_id=cat.id, category_name=f"{old_name} → {new_name}",
        parent_path=parent_path,
        reason=f"重命名：{old_name} → {new_name}",
    )
    return _ok({"id": cat.id, "name": cat.name})




@csrf_exempt
@require_role(UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)
def api_folder_set_course(request, folder_id):
    """POST /api/folders/<id>/set-course/ — 设置/修改课程代码

    返回 situation 供前端选择：
      new_code          — 新代码不存在（重命名当前课程）
      exists_single     — 新代码存在且唯一（链接/合并二选一）
      exists_multiple   — 新代码存在多个（选一个再走链接）
    """
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    cat = get_object_or_404(CourseCategory, id=folder_id)

    if not _check_category_scope(request.user, cat):
        return _err("无权操作", 403)

    try:
        body = json.loads(request.body)
    except Exception:
        return _err("请求格式错误")

    course_code = (body.get("course_code") or "").strip()
    course_name = (body.get("course_name") or "").strip()
    action_id = body.get("action_id", "")
    if not course_code:
        return _err("课程代码不能为空")

    # 课程代码既作目录名又作 Course.code：拒绝一切路径穿越字符（/ \ .. 及空白），
    # 防止重命名后 file_path 前缀带 .. 逃逸出 MEDIA_ROOT
    safe_code = _safe_dir_name(course_code)
    if safe_code != course_code or "/" in course_code or "\\" in course_code or ".." in course_code:
        return _err("课程代码包含非法字符（仅允许字母、数字、-、_、*）", 400)
    course_code = safe_code

    # 阶段 1：只查询→返回情况（前端未选 action 时）
    if not action_id:
        # 获取当前关联的 Course 信息
        current_course = cat.course
        current_course_info = None
        if current_course:
            current_course_info = {
                "id": current_course.id,
                "code": current_course.code,
                "name": current_course.name,
                "college": current_course.college.short_name if current_course.college_id else "",
                "file_count": Material.objects.filter(course=current_course).count(),
            }

        matched_courses = list(Course.objects.filter(code=course_code))

        if not matched_courses:
            # 情况 A：新代码不存在
            return _ok({
                "situation": "new_code",
                "note": f"课程代码 {course_code} 不存在",
                "current_course": current_course_info,
                "options": [
                    {
                        "id": "rename_self",
                        "label": "重命名当前课程",
                        "desc": f"将当前课程代码改为 {course_code}，文件路径同步迁移",
                    },
                ],
            })

        elif len(matched_courses) == 1:
            # 情况 B：新代码存在且唯一
            target = matched_courses[0]
            ref_count = CourseCategory.objects.filter(course=target).count()
            target_info = {
                "id": target.id,
                "code": target.code,
                "name": target.name,
                "college": target.college.short_name if target.college_id else "",
                "file_count": Material.objects.filter(course=target).count(),
                "ref_count": ref_count,
            }
            options = [
                {
                    "id": "link",
                    "label": "链接到此课程",
                    "desc": f"当前节点指向已有课程 {target.code}（{ref_count}个节点已引用它）",
                },
            ]
            # 只有当前有关联课程且不是同一个课程时，才可合并
            if current_course and current_course.id != target.id:
                current_file_count = Material.objects.filter(course=current_course).count()
                options.append({
                    "id": "merge",
                    "label": "合并到此课程",
                    "desc": f"将当前课程下的 {current_file_count} 个文件迁移到 {target.code}，删除当前课程",
                })
            return _ok({
                "situation": "exists_single",
                "note": f"已有课程 {target.code}（{target.name}，{target_info['college'] or '无学院'}，{target_info['file_count']}个文件）",
                "existing_course": target_info,
                "current_course": current_course_info,
                "options": options,
            })

        else:
            # 情况 C：新代码存在不唯一
            return _ok({
                "situation": "exists_multiple",
                "note": f"课程代码 {course_code} 对应多个课程",
                "matching_courses": [
                    {
                        "id": c.id,
                        "code": c.code,
                        "name": c.name,
                        "college": c.college.short_name if c.college_id else "",
                        "file_count": Material.objects.filter(course=c).count(),
                    }
                    for c in matched_courses
                ],
            })

    # 阶段 2：管理员已选择 action，执行操作
    if action_id == "rename_self":
        # 重命名当前课程代码 + 迁移文件
        if not cat.course_id:
            return _err("当前节点未关联课程，无法重命名", 400)
        old_course = cat.course
        old_code = old_course.code

        # 迁移物理文件
        old_dir = Path(settings.MEDIA_ROOT) / old_code
        new_dir = Path(settings.MEDIA_ROOT) / course_code
        if old_dir.exists() and old_dir != new_dir:
            new_dir.mkdir(parents=True, exist_ok=True)
            for f in old_dir.iterdir():
                if f.is_file():
                    shutil.move(str(f), str(new_dir / f.name))
            try:
                old_dir.rmdir()
            except OSError:
                pass  # 非空时静默失败

        # 更新 file_path
        if old_dir != new_dir:
            Material.objects.filter(course=old_course).update(
                file_path=transaction.atomic().on_commit(
                    lambda: None  # 下面积累
                )
            )
            # 用 F 表达式安全更新 file_path 前缀
            for m in Material.objects.filter(course=old_course):
                if m.file_path.startswith(old_code + "/"):
                    m.file_path = course_code + m.file_path[len(old_code):]
                    m.save(update_fields=["file_path"])

        # 改 Course.code
        old_course.code = course_code
        old_course.save(update_fields=["code"])

        FolderOperation.objects.create(
            user=request.user, action="set_course", folder_type="",
            category_id=cat.id, category_name=cat.name or f"#{cat.id}",
            reason=f"课程代码重命名：{old_code} → {course_code}",
        )
        return _ok({"message": f"课程代码已重命名为 {course_code}", "course_code": course_code})

    elif action_id == "link":
        target_id = body.get("target_course_id")
        if not target_id:
            return _err("请指定目标课程", 400)
        target = get_object_or_404(Course, id=target_id)
        cat.course = target
        cat.save(update_fields=["course"])
        FolderOperation.objects.create(
            user=request.user, action="set_course", folder_type="",
            category_id=cat.id, category_name=cat.name or f"#{cat.id}",
            reason=f"链接到已有课程 {target.code}（{target.name}）",
        )
        return _ok({
            "message": f"已链接到课程 {target.code}",
            "course_code": target.code,
            "course_name": target.name,
        })

    elif action_id == "merge":
        target_id = body.get("target_course_id")
        if not target_id:
            return _err("请指定目标课程", 400)
        target = get_object_or_404(Course, id=target_id)
        if not cat.course_id:
            return _err("当前节点未关联课程，无法合并", 400)
        old_course = cat.course
        if old_course.id == target.id:
            return _err("不能合并到自身")

        # 1. 迁移文件归属
        Material.objects.filter(course=old_course).update(course=target)

        # 2. 迁移物理文件
        old_dir = Path(settings.MEDIA_ROOT) / old_course.code
        new_dir = Path(settings.MEDIA_ROOT) / target.code
        if old_dir.exists() and old_dir != new_dir:
            new_dir.mkdir(parents=True, exist_ok=True)
            for f in old_dir.iterdir():
                if f.is_file():
                    dest = new_dir / f.name
                    if not dest.exists():
                        shutil.move(str(f), str(dest))
            try:
                old_dir.rmdir()
            except OSError:
                pass

        # 3. 更新 file_path 前缀
        old_prefix = old_course.code + "/"
        for m in Material.objects.filter(course=target, file_path__startswith=old_prefix):
            m.file_path = target.code + m.file_path[len(old_prefix):]
            m.save(update_fields=["file_path"])

        # 4. 更新其他 CourseCategory 节点引用
        CourseCategory.objects.filter(course=old_course).exclude(id=cat.id).update(course=target)

        # 5. 当前节点也指向目标
        cat.course = target
        cat.save(update_fields=["course"])

        # 6. 删除旧 Course
        old_course.delete()

        FolderOperation.objects.create(
            user=request.user, action="set_course", folder_type="",
            category_id=cat.id, category_name=cat.name or f"#{cat.id}",
            reason=f"合并：将 {old_course.code}（{old_course.name}）合并到 {target.code}（{target.name}）",
        )
        return _ok({
            "message": f"已合并到课程 {target.code}",
            "course_code": target.code,
            "course_name": target.name,
        })

    return _err("未知的操作")
