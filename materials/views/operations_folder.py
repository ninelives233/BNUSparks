"""
BNU Sparks · 木铎星火 — 文件夹创建 / 删除 API
"""

import json
import re

from django.contrib.auth.models import User
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt

from ..models import (
    Course, CourseCategory, FolderOperation, Notification, UserProfile,
)
from .utils import (
    _err, _ok, _get_or_create_profile, _create_notification,
    _find_existing_course, _find_leaf_under_parent, require_role,
)
from .operations_helpers import (
    _next_custom_code, _check_category_scope, _can_create_under,
)

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
    reused = False
    if folder_type == "course":
        course_code = (body.get("course_code") or "").strip()
        course_name = (body.get("course_name") or "").strip()
        if not course_code:
            return _err("课程节点必须填写课程代码")
        if not course_name:
            return _err("课程节点必须填写课程名称")
        # v=158：课程代码仅允许字母和数字（既作 Course.code 又作目录名）
        if not re.match(r"^[A-Za-z0-9]+$", course_code):
            return _err("课程代码仅允许字母和数字", 400)
        # v=165：同码课程确定性收敛复用（壳语义）——多行同码不再硬报错
        existing = _find_existing_course(course_code)
        if existing:
            course = existing
            reused = True
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

    # v=165：目标位置已有同课程叶子 → 不重复创建节点（提示并复用）
    if folder_type == "course" and parent is not None:
        existing_leaf = _find_leaf_under_parent(parent, course)
        if existing_leaf:
            return _ok({
                "id": existing_leaf.id,
                "name": existing_leaf.name or course.name,
                "parent_id": parent.id,
                "course_code": course.code,
                "folder_type": folder_type,
                "reused": True,
                "message": "该课程已在此位置存在，未重复创建",
            })

    # 复用既有课程时用权威名 course.name（与申请流壳语义一致）；新建时 course.name 即提交名
    cat = CourseCategory.objects.create(
        name=course.name or name, parent=parent, order=0, course=course,
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
        reason="新建课程文件夹" + (f"（已链接到既有课程 {course.code}）" if reused else ""),
    )
    return _ok({
        "id": cat.id, "name": cat.name, "parent_id": cat.parent_id,
        "course_code": course.code if course else None,
        "folder_type": folder_type,
        "reused": reused,
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
