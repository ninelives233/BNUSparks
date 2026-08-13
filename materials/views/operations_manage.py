"""
BNU Sparks · 木铎星火 — 文件更新 / 置顶 / 文件夹重命名 / 设置课程 API
"""

import json
import re
import shutil
from pathlib import Path

from django.conf import settings
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from ..models import (
    Material, Course, CourseCategory, FolderOperation, UserProfile,
)
from .utils import (
    _err, _ok, _get_or_create_profile, _check_moderator_access,
    _safe_dir_name, require_login, require_role,
)
from .operations_helpers import _check_category_scope


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


@csrf_exempt
@require_login
def api_file_pin(request, file_id):
    """POST /api/files/<id>/pin/ — 置顶/取消置顶文件（管理动作，admin-only）

    置顶影响全体用户目录视图（高亮 + 默认排序置顶优先），普通 user 一律无权。
    body: {"pinned": true|false}（显式幂等）
    """
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    material = get_object_or_404(Material, id=file_id)
    profile = _get_or_create_profile(request.user)
    if profile.role not in (UserProfile.Role.SUPER_ADMIN, UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR):
        return _err("无权置顶", 403)
    try:
        _check_moderator_access(request.user, material)
    except Exception:
        return _err("无权置顶该资料", 403)
    try:
        body = json.loads(request.body) if request.body else {}
    except Exception:
        return _err("请求格式错误")
    pinned = body.get("pinned")
    if pinned is None:
        return _err("缺少 pinned 参数")
    # 兜底字符串态（v176 教训：JSON 布尔/字符串两态都要兼容，避免 "false" 被 bool() 误判为 True）
    if isinstance(pinned, str):
        pinned = pinned.strip().lower() in ("true", "1", "yes")
    material.is_pinned = bool(pinned)
    material.pinned_at = timezone.now() if material.is_pinned else None
    material.save(update_fields=["is_pinned", "pinned_at"])
    return _ok({
        "id": material.id,
        "is_pinned": material.is_pinned,
        "pinned_at": material.pinned_at.isoformat() if material.pinned_at else None,
    })


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

    # v=158：课程代码仅允许字母和数字。校验原始输入（非清洗后），
    # 避免 "BAD-CODE!" 被 _safe_dir_name 静默清洗成 "BADCODE" 而不报错；
    # 纯字母数字天然无路径穿越风险（/ \ .. 空白均被正则拦截），可安全作目录名。
    if not re.match(r"^[A-Za-z0-9]+$", course_code):
        return _err("课程代码仅允许字母和数字", 400)
    course_code = _safe_dir_name(course_code)

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

        # 更新 file_path 前缀：{旧code}/ → {新code}/
        # v=158：去掉残留的 `Material.objects.update(file_path=transaction.atomic().on_commit(...))`
        # 垃圾代码——on_commit 返回 None 会把全部 file_path 写成 NULL 且随后循环崩溃
        for m in Material.objects.filter(course=old_course):
            if m.file_path and m.file_path.startswith(old_code + "/"):
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

        # 3. 更新 file_path 前缀：{旧code}/ → {target.code}/
        # v=158：原来 `target.code + 后缀` 丢了斜杠（"TGT001test.pdf"），补回 "/"
        old_prefix = old_course.code + "/"
        for m in Material.objects.filter(course=target, file_path__startswith=old_prefix):
            m.file_path = target.code + "/" + m.file_path[len(old_prefix):]
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
