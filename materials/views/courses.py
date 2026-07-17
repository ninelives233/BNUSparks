"""
BNU Sparks · 木铎星火 — 课程 & 搜索 & 统计 API

courses list, course-tree, course-files, search, stats, colleges
"""

import json

from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.db.models import Count, Q
from django.contrib.auth.models import User
from django.utils import timezone

from .utils import (
    _err, _ok, _get_user, _get_or_create_profile,
    _build_tree_node, _get_courses_in_category,
    _create_notification,
    UserProfile, Course, College, CourseCategory, Material,
    Notification, DownloadRecord,
)


# ═══════════════════════════════════════════════════════════════
# 课程列表
# ═══════════════════════════════════════════════════════════════

def api_courses(request):
    """GET /api/courses/ — 课程列表（支持 ?type=general|major&search=&college=）"""
    qs = Course.objects.all()
    t = request.GET.get("type")
    s = request.GET.get("search", "").strip()
    college_id = request.GET.get("college")

    if t in ("general", "major"):
        qs = qs.filter(course_type=t)
    if college_id:
        qs = qs.filter(college_id=college_id)
    if s:
        qs = qs.filter(
            Q(code__icontains=s) | Q(name__icontains=s)
        )
    qs = qs.order_by("code")[:100]
    return _ok([{
        "code": c.code,
        "name": c.name,
        "course_type": c.course_type,
        "college_name": c.college.short_name if c.college_id else "",
        "material_count": Material.objects.filter(course_id=c.id, review_status="approved").count(),
    } for c in qs])


# ═══════════════════════════════════════════════════════════════
# 课程文件列表
# ═══════════════════════════════════════════════════════════════

def api_course_files(request, course_code):
    """GET /api/courses/<code>/files — 课程文件列表（含自动托管延迟隐藏逻辑）"""
    try:
        course = Course.objects.get(code=course_code)
    except Course.DoesNotExist:
        cleaned = course_code.replace("*", "").replace("-", "")
        matched = Course.objects.filter(code__startswith=cleaned)
        if matched.count() == 1:
            course = matched.first()
        elif matched.count() > 1:
            return _err("课程代码不明确")
        else:
            return _err("课程不存在", 404)
    except Course.MultipleObjectsReturned:
        courses = Course.objects.filter(code=course_code).order_by("id")
        with_files = courses.filter(materials__is_approved=True).distinct()
        if with_files.count() == 1:
            course = with_files.first()
        elif with_files.count() > 1:
            return _err("课程代码不明确")
        else:
            course = courses.first()

    user = _get_user(request)

    q_filter = Q(course=course, is_approved=True)
    if user is not None:
        q_filter |= Q(course=course, uploader=user, review_status__in=["pending", "approved"])

    materials = Material.objects.filter(q_filter).select_related(
        "material_type"
    ).order_by("-created_at")

    from datetime import timedelta
    delay_boundary = timezone.now() - timedelta(minutes=1)
    user_id = user.id if user is not None else None

    def _serialize_file(m):
        rs = m.review_status
        if (rs == "approved"
                and user is not None
                and m.uploader_id == user.id
                and m.reviewed_by_id is not None
                and m.reviewed_by_id != user.id
                and m.created_at > delay_boundary):
            rs = "pending"
        elif (rs == "approved"
              and user is not None
              and m.uploader_id == user.id
              and m.reviewed_by_id is not None
              and m.reviewed_by_id != user.id
              and not Notification.objects.filter(
                  recipient=user, material=m,
                  type=Notification.Type.APPROVED,
              ).exists()):
            _create_notification(
                recipient=user, type=Notification.Type.APPROVED,
                title="你的资料已通过审核",
                message=f"你的资料「{m.title}」已通过审核，现在可以下载了。",
                material=m,
            )
        return {
            "id": m.id, "title": m.title,
            "file_name": m.file_name, "file_size": m.file_size,
            "file_type": m.material_type.name if m.material_type else (m.file_type or "其他"),
            "uploader": m.uploader_name or (m.uploader.first_name if m.uploader else "匿名"),
            "teacher": m.teacher, "description": m.description or "",
            "course_name": m.course.name if m.course else "",
            "course_code": m.course.code if m.course else "",
            "download_count": m.download_count,
            "created_at": m.created_at.strftime("%Y-%m-%d"),
            "review_status": rs,
            "is_uploader": user is not None and m.uploader_id == user.id,
            "is_admin_uploaded": user is not None and m.uploader_id == user.id and _get_or_create_profile(user).role in (
                UserProfile.Role.SUPER_ADMIN, UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR
            ),
            "can_download": m.is_approved or (user is not None and m.uploader_id == user.id),
            "can_delete": user is not None and (
                m.uploader_id == user.id
                or _get_or_create_profile(user).role == UserProfile.Role.SUPER_ADMIN
                or _get_or_create_profile(user).role == UserProfile.Role.MODERATOR
                or _get_or_create_profile(user).role == UserProfile.Role.SUB_MODERATOR
            ),
        }

    return _ok([_serialize_file(m) for m in materials])


# ═══════════════════════════════════════════════════════════════
# 课程树
# ═══════════════════════════════════════════════════════════════

def api_course_tree(request):
    """GET /api/courses/tree — 课程导航树"""
    roots = CourseCategory.objects.filter(parent=None).order_by("order")
    tree = {}
    for root in roots:
        children = root.children.all()
        if children:
            tree[root.name] = {"children": _build_tree_node(children)}
    return _ok(tree)


# ═══════════════════════════════════════════════════════════════
# 搜索
# ═══════════════════════════════════════════════════════════════

def api_search(request):
    """GET /api/search/?q=&type=course|material"""
    query = request.GET.get("q", "").strip()
    search_type = request.GET.get("type", "all")

    if not query:
        return _err("搜索关键词不能为空")

    results = {"courses": [], "materials": []}

    if search_type in ("all", "course"):
        courses_qs = Course.objects.filter(
            Q(code__icontains=query) | Q(name__icontains=query)
        ).order_by("code")
        seen = set()
        results["courses"] = []
        for c in courses_qs:
            if c.code not in seen:
                seen.add(c.code)
                results["courses"].append({
                    "code": c.code,
                    "name": c.name,
                    "course_type": c.course_type,
                    "college_name": c.college.short_name if c.college_id else "",
                })
                if len(results["courses"]) >= 20:
                    break

    if search_type in ("all", "material"):
        q = Q(title__icontains=query) | Q(teacher__icontains=query) | Q(description__icontains=query)
        materials_qs = Material.objects.filter(q, review_status="approved").select_related("course")[:50]
        results["materials"] = [{
            "id": m.id,
            "title": m.title,
            "course_code": m.course.code if m.course_id else "",
            "course_name": m.course.name if m.course_id else "",
            "file_type": m.file_type,
        } for m in materials_qs]

    return _ok(results)


# ═══════════════════════════════════════════════════════════════
# 统计
# ═══════════════════════════════════════════════════════════════

def api_stats(request):
    """GET /api/stats/ — 首页统计"""
    total_courses = Course.objects.count()
    total_materials = Material.objects.filter(review_status="approved").count()
    total_users = User.objects.filter(is_active=True).count()

    # 前向兼容旧字段名
    college_with_data_count = College.objects.filter(
        course__materials__review_status="approved"
    ).distinct().count()
    general_with_data_count = Course.objects.filter(
        course_type="general", materials__review_status="approved"
    ).distinct().count()
    major_with_data_count = Course.objects.filter(
        course_type="major", materials__review_status="approved"
    ).distinct().count()

    limit = int(request.GET.get("limit", 10))

    popular = Material.objects.filter(review_status="approved") \
        .order_by("-download_count") \
        .select_related("course")[:limit]
    top_downloaded = [{
        "id": m.id,
        "title": m.title,
        "course_code": m.course.code if m.course_id else "",
        "course_name": m.course.name if m.course_id else "",
        "college": m.course.college.short_name if m.course_id and m.course.college_id else "",
        "download_count": m.download_count,
        "file_type": m.file_type,
    } for m in popular]

    recent = Material.objects.filter(review_status="approved") \
        .order_by("-created_at") \
        .select_related("course")[:limit]
    recent_uploads = [{
        "id": m.id,
        "title": m.title,
        "course_code": m.course.code if m.course_id else "",
        "course_name": m.course.name if m.course_id else "",
        "college": m.course.college.short_name if m.course_id and m.course.college_id else "",
        "file_type": m.file_type,
        "uploader_name": m.uploader_name or "",
        "created_at": m.created_at.isoformat() if m.created_at else "",
    } for m in recent]

    return _ok({
        "total_courses": total_courses,
        "total_files": total_materials,
        "total_users": total_users,
        "college_with_data_count": college_with_data_count,
        "general_with_data_count": general_with_data_count,
        "major_with_data_count": major_with_data_count,
        "material_count": total_materials,
        "top_downloaded": top_downloaded,
        "recent_uploads": recent_uploads,
    })


# ═══════════════════════════════════════════════════════════════
# 学院
# ═══════════════════════════════════════════════════════════════

def api_colleges(request):
    """GET /api/colleges/ — 学院列表"""
    colleges = College.objects.order_by("order")
    return _ok([{
        "id": c.id,
        "name": c.name,
        "short_name": c.short_name,
        "slug": c.slug,
    } for c in colleges])
