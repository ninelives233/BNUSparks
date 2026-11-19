"""Administrative review and reconciliation of placeholder course codes."""
import json
import shutil
from collections import defaultdict
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt

from ..models import (Course, CourseCategory, FolderOperation, Material, UserProfile,
                      invalidate_course_tree_cache, invalidate_stats_cache)
from ..services.course_codes import adopt_course_code, is_placeholder, normalized_course_name
from .operations_helpers import _check_category_scope, _find_college_node, _is_descendant
from .operations_manage import _unique_merge_destination
from .utils import _err, _ok, _safe_dir_name, require_role
from .utils_auth import _get_or_create_profile
from .utils_course_tree import _clear_category_preload, _follow_merge

ROLES = (UserProfile.Role.SUB_MODERATOR, UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN)


def _admin_covers_course(user, course, leaves):
    profile = _get_or_create_profile(user)
    if profile.role == UserProfile.Role.SUPER_ADMIN:
        return True
    if not leaves:
        return (profile.role == UserProfile.Role.MODERATOR and course.college_id
                and profile.managed_majors.filter(pk=course.college_id).exists())
    if not all(_check_category_scope(user, leaf) for leaf in leaves):
        return False
    # Course-based scope checks alone cannot distinguish shared mounts in different branches.
    branches = {_find_college_node(leaf).pk for leaf in leaves if _find_college_node(leaf)}
    if len(branches) > 1:
        sections = list(profile.moderated_sections.all())
        names = set(profile.managed_majors.values_list("name", flat=True)) if profile.role == UserProfile.Role.MODERATOR else set()
        return all(any(leaf.pk == section.pk or _is_descendant(leaf, section) for section in sections)
                   or (_find_college_node(leaf) and _find_college_node(leaf).name in names)
                   for leaf in leaves)
    return True


def _paths(leaves, categories):
    result = []
    for leaf in leaves:
        names, level, node, seen = [], "", leaf, set()
        while node and node.pk not in seen:
            seen.add(node.pk)
            names.append(node.name or (node.course.name if node.course_id else ""))
            level = level or node.education_level
            node = categories.get(node.parent_id)
        result.append({"category_id": leaf.pk, "path": " / ".join(reversed(names)), "education_level": level})
    return result


def _summary(course):
    return {"id": course.id, "code": course.code, "name": course.name,
            "college_name": course.college.name if course.college_id else ""}


def _body(request):
    try:
        body = json.loads(request.body)
        return body if isinstance(body, dict) else None
    except (ValueError, UnicodeDecodeError):
        return None


def _invalidate():
    _clear_category_preload()
    invalidate_course_tree_cache()
    invalidate_stats_cache()


@require_role(*ROLES)
def api_admin_placeholder_courses(request):
    _clear_category_preload()
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    try:
        page = max(1, int(request.GET.get("page", 1)))
        per_page = min(100, max(1, int(request.GET.get("per_page", 20))))
        college_id = int(request.GET["college_id"]) if request.GET.get("college_id") else None
    except ValueError:
        return _err("筛选参数无效")
    categories = {cat.id: cat for cat in CourseCategory.objects.select_related("course")}
    leaves = defaultdict(list)
    for cat in categories.values():
        if cat.course_id:
            leaves[cat.course_id].append(cat)
    courses = list(Course.objects.filter(merged_into__isnull=True).select_related("college").prefetch_related("materials", "merged_courses"))
    visible = [course for course in courses if _admin_covers_course(request.user, course, leaves[course.id])]
    by_name = defaultdict(list)
    for course in courses:
        by_name[normalized_course_name(course.name)].append(course)

    def details(course):
        materials = list(course.materials.all())
        return len(materials), sum(m.review_status == "approved" for m in materials), sum(m.review_status == "pending" for m in materials)

    items = []
    for course in visible:
        if not is_placeholder(course.code):
            continue
        paths = _paths(leaves[course.id], categories)
        count, approved, pending = details(course)
        clues = {"same_college_real": [], "same_college_bnux": [], "cross_college_real": []}
        for candidate in by_name[normalized_course_name(course.name)]:
            if candidate.id == course.id:
                continue
            same_college = candidate.college_id == course.college_id
            placeholder = is_placeholder(candidate.code)
            if not same_college and placeholder:
                continue
            kind = "same_college_bnux" if same_college and placeholder else "same_college_real" if same_college else "cross_college_real"
            clues[kind].append({"course_id": candidate.id, "code": candidate.code, "name": candidate.name,
                                "college_name": candidate.college.name if candidate.college_id else "",
                                "material_count": details(candidate)[0], "paths": _paths(leaves[candidate.id], categories), "match_kind": kind})
        item = {**_summary(course), "college_id": course.college_id, "course_type": course.course_type,
                "paths": paths, "material_count": count, "approved_count": approved, "pending_count": pending,
                "alias_codes": [alias.code for alias in course.merged_courses.all()], "conflict_clues": clues}
        items.append(item)
    query = request.GET.get("q", "").strip().casefold()
    items = [item for item in items if (not query or query in item["name"].casefold() or query in item["code"].casefold()
                                         or any(query in path["path"].casefold() for path in item["paths"]))]
    if request.GET.get("has_materials") in ("0", "1"):
        items = [item for item in items if bool(item["material_count"]) == (request.GET["has_materials"] == "1")]
    if request.GET.get("has_conflict") in ("0", "1"):
        items = [item for item in items if any(item["conflict_clues"].values()) == (request.GET["has_conflict"] == "1")]
    colleges = sorted({(item["college_id"], item["college_name"]) for item in items if item["college_id"]}, key=lambda pair: (pair[1], pair[0]))
    if college_id is not None:
        items = [item for item in items if item["college_id"] == college_id]
    total = len(items)
    return _ok({"items": items[(page - 1) * per_page:page * per_page], "total": total, "page": page,
                "total_pages": (total + per_page - 1) // per_page, "colleges": [{"id": pk, "name": name} for pk, name in colleges]})


@csrf_exempt
@require_role(*ROLES)
def api_admin_placeholder_adopt(request, course_id):
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    body = _body(request)
    if body is None or not isinstance(body.get("teaching_code"), str) or not body["teaching_code"].strip():
        return _err("请输入课程代码")
    course = get_object_or_404(Course, pk=course_id)
    leaves = list(CourseCategory.objects.filter(course=course))
    if not _admin_covers_course(request.user, course, leaves):
        return _err("权限不足", 403)
    if not is_placeholder(course.code) or course.merged_into_id:
        return _err("课程不是待补代码的主课程", 400)
    code = body["teaching_code"].strip().upper()
    old_code = course.code
    try:
        with transaction.atomic():
            course = adopt_course_code(course, code)
            FolderOperation.objects.create(user=request.user, action="set_course", category_name=course.name,
                                           category_id=leaves[0].id if len(leaves) == 1 else 0,
                                           reason=f"补正课程代码：{old_code} → {course.code}")
    except ValueError as exc:
        existing = Course.objects.filter(code__iexact=code).exclude(pk=course_id).first()
        if existing:
            existing = _follow_merge(existing)
            can_merge = _admin_covers_course(request.user, existing, list(CourseCategory.objects.filter(course=existing)))
            return JsonResponse({"ok": False, "error": str(exc),
                                 "existing_course": {**_summary(existing), "can_merge": can_merge}}, status=409)
        return _err(str(exc))
    _invalidate()
    return _ok({"id": course.id, "code": course.code, "name": course.name, "placeholder_alias": old_code})


@csrf_exempt
@require_role(*ROLES)
def api_admin_placeholder_merge(request, course_id):
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    body = _body(request)
    if body is None:
        return _err("请求格式错误")
    source = get_object_or_404(Course, pk=course_id)
    if not _admin_covers_course(request.user, source, list(CourseCategory.objects.filter(course=source))):
        return _err("权限不足", 403)
    if not is_placeholder(source.code) or source.merged_into_id:
        return _err("课程不是待补代码的主课程")
    target_id, target_code = body.get("target_course_id"), body.get("target_code")
    if target_id:
        try:
            raw_target = Course.objects.filter(pk=int(target_id)).first()
        except (ValueError, TypeError):
            return _err("目标课程无效")
    elif isinstance(target_code, str) and target_code.strip():
        raw_target = Course.objects.filter(code__iexact=target_code.strip()).order_by("id").first()
    else:
        return _err("请指定目标课程")
    if not raw_target:
        return _err("目标课程不存在", 404)
    target = _follow_merge(raw_target)
    if target.pk == source.pk or target.merged_into_id:
        return _err("不能合并到自身或无效的别名")
    if not _admin_covers_course(request.user, target, list(CourseCategory.objects.filter(course=target))):
        return _err("权限不足", 403)
    root = Path(settings.MEDIA_ROOT).resolve()
    target_dir = root / _safe_dir_name(target.code)
    created_dir = not target_dir.exists()
    moved = []
    try:
        with transaction.atomic():
            Course.objects.filter(pk__in=[source.pk, target.pk]).update(code=F('code'))
            source.refresh_from_db()
            target.refresh_from_db()
            if source.merged_into_id or not is_placeholder(source.code) or target.merged_into_id:
                raise ValueError("课程状态已变更，请刷新后重试")
            if not _admin_covers_course(request.user, source, list(CourseCategory.objects.filter(course=source))) or not _admin_covers_course(request.user, target, list(CourseCategory.objects.filter(course=target))):
                raise ValueError("课程权限已变更，请刷新后重试")
            if target_dir.resolve().parent != root:
                raise ValueError("目标目录无效")
            target_dir.mkdir(parents=True, exist_ok=True)
            for material in Material.objects.select_for_update().filter(course=source):
                if material.file_path:
                    old_path = root / material.file_path
                    resolved = old_path.resolve()
                    if root not in resolved.parents or old_path.is_symlink():
                        raise ValueError("资料路径无效")
                    if old_path.is_file():
                        destination = _unique_merge_destination(target_dir, old_path.name)
                        shutil.move(str(old_path), str(destination))
                        moved.append((destination, old_path))
                        material.file_path = f"{target_dir.name}/{destination.name}"
                material.course = target
                material.save(update_fields=["course", "file_path"])
            for leaf in CourseCategory.objects.filter(course=source):
                if CourseCategory.objects.filter(parent_id=leaf.parent_id, course=target).exists():
                    leaf.delete()
                else:
                    leaf.course = target
                    leaf.save(update_fields=["course"])
            Course.objects.filter(merged_into=source).update(merged_into=target)
            source.merged_into = target
            source.save(update_fields=["merged_into"])
            FolderOperation.objects.create(user=request.user, action="set_course", category_name=source.name,
                                           reason=f"合并课程：{source.code} → {target.code}")
    except Exception:
        for destination, old_path in reversed(moved):
            try:
                old_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(destination), str(old_path))
            except OSError:
                pass
        if created_dir:
            try:
                target_dir.rmdir()
            except OSError:
                pass
        return _err("课程合并失败，请检查文件与课程状态", 500)
    _invalidate()
    return _ok({"merged_code": source.code, "target_id": target.id, "target_code": target.code, "target_name": target.name})
