"""
BNU Sparks · 木铎星火 — 课程 & 搜索 & 统计 API

courses list, course-tree, course-files, search, stats, colleges
"""

import json
import hashlib

from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.db.models import Count, Q
from django.contrib.auth.models import User
from django.utils import timezone
from django.core.cache import cache
from django.http import JsonResponse, HttpResponseNotModified

from .utils import (
    _err, _ok, _get_user, _get_or_create_profile,
    _build_tree_node, _get_courses_in_category,
    _create_notification, _user_can_edit_material,
    UserProfile, Course, College, CourseCategory, Material,
    Notification, DownloadRecord, Favorite,
)
from ..models import COURSE_TREE_CACHE_KEY


def _etag_json_response(request, data):
    """内容 ETag + 304：浏览器每次重验证，未变返回 304（省去 406KB 树重复传输）。

    内容哈希保证数据变化后 ETag 必然变化 → 无陈旧缓存风险。
    """
    resp = JsonResponse({"ok": True, "data": data})
    etag = '"' + hashlib.md5(resp.content).hexdigest() + '"'
    if request.headers.get("If-None-Match") == etag:
        return HttpResponseNotModified(headers={"ETag": etag, "Cache-Control": "no-cache"})
    resp["ETag"] = etag
    resp["Cache-Control"] = "no-cache"
    return resp


# ═══════════════════════════════════════════════════════════════
# 课程列表
# ═══════════════════════════════════════════════════════════════

def api_courses(request):
    """GET /api/courses/ — 课程列表（支持 ?type=general|major&search=&college=）"""
    qs = Course.objects.select_related('college').annotate(
        _material_count=Count('materials', filter=Q(materials__review_status='approved'))
    )
    # v=147：只返回仍挂在课程树（有 CourseCategory 引用）的课程，
    # 文件夹被删除后残留的孤儿 Course 不再出现在列表里。
    qs = qs.filter(coursecategory__isnull=False)
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
        "material_count": c._material_count,
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
        "material_type", "course", "uploader", "uploader__profile"
    ).order_by("-is_pinned", "-created_at")

    # 注释收藏数
    from django.db.models import Count
    materials = materials.annotate(
        favorite_count=Count("favorited_by")
    )

    from datetime import timedelta
    delay_boundary = timezone.now() - timedelta(minutes=1)
    # v=175.2：补发「已通过审核」通知仅限 48h 内被批准的近期资料——老种子资料
    # （入库直置 approved、从未走过审批流）reviewed_at 已远超窗口或为空，一律不
    # 补发，根治「清空通知→再浏览→又补一遍」的循环轰炸。
    backfill_boundary = timezone.now() - timedelta(hours=48)
    user_id = user.id if user is not None else None

    def _serialize_file(m):
        rs = m.review_status
        if (rs == "approved"
                and user is not None
                and m.uploader_id == user.id
                and m.reviewed_by_id is not None
                and m.reviewed_by_id != user.id
                and m.uploader_id != m.reviewed_by_id
              and m.created_at > delay_boundary):
            rs = "pending"
        elif (rs == "approved"
              and user is not None
              and m.uploader_id == user.id
              and m.reviewed_by_id is not None
              and m.reviewed_by_id != user.id
              and m.uploader_id != m.reviewed_by_id
              and m.reviewed_at is not None
              and m.reviewed_at >= backfill_boundary
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
        uploader_profile = getattr(m.uploader, 'profile', None) if m.uploader else None
        return {
            "id": m.id, "title": m.title,
            "file_name": m.file_name, "file_size": m.file_size,
            "file_type": m.material_type.name if m.material_type else (m.file_type or "其他"),
            "user_material_type": m.material_type.name if m.material_type else "",
            "uploader": (m.uploader.first_name if m.uploader else m.uploader_name) or "匿名",
            "uploader_id": m.uploader_id or 0,
            "uploader_avatar": uploader_profile.avatar.url if uploader_profile and uploader_profile.avatar else "",
            "teacher": m.teacher, "description": m.description or "",
            "course_name": m.course.name if m.course else "",
            "course_code": m.course.code if m.course else "",
            "download_count": m.download_count,
            "favorite_count": getattr(m, "favorite_count", 0),
            "created_at": m.created_at.strftime("%Y-%m-%d"),
            "review_status": rs,
            "is_uploader": user is not None and m.uploader_id == user.id,
            "is_admin_uploaded": user is not None and m.uploader_id == user.id and _get_or_create_profile(user).role in (
                UserProfile.Role.SUPER_ADMIN, UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR
            ),
            "can_download": m.is_approved or (user is not None and m.uploader_id == user.id),
            "can_delete": user is not None and _user_can_edit_material(user, m),
            "is_pinned": m.is_pinned,
        }

    return _ok([_serialize_file(m) for m in materials])


# ═══════════════════════════════════════════════════════════════
# 课程树
# ═══════════════════════════════════════════════════════════════

def api_course_tree(request):
    """GET /api/courses/tree — 课程导航树（预加载优化版，4次查询代替400次，缓存10min，变更时信号清缓存）"""
    CACHE_KEY = COURSE_TREE_CACHE_KEY
    cached = cache.get(CACHE_KEY)
    if cached is not None:
        return _etag_json_response(request, cached)

    # 1. 一次性加载所有 CourseCategory（带 select_related('course') 避免 FK N+1）
    all_cats = CourseCategory.objects.select_related('course').all()
    child_map = {}
    for c in all_cats:
        pid = c.parent_id if c.parent_id else None
        child_map.setdefault(pid, []).append(c)

    # 2. 预聚合每个课程的已审核资料数
    count_qs = Material.objects.filter(is_approved=True).values('course__code').annotate(count=Count('id'))
    material_counts = {item['course__code']: item['count'] for item in count_qs}

    # 3. 预加载所有 Course（含 college FK，用于 course_text 前缀匹配）
    all_courses = list(Course.objects.select_related('college').all())
    course_by_code = {c.code: c for c in all_courses}

    preload = {
        'child_map': child_map,
        'course_by_code': course_by_code,
        'material_counts': material_counts,
    }

    roots = child_map.get(None, [])
    roots.sort(key=lambda c: c.order)
    tree = {}
    for root in roots:
        children = child_map.get(root.id, [])
        if children:
            tree[root.name] = {"children": _build_tree_node(children, preload=preload)}

    cache.set(CACHE_KEY, tree, 600)
    return _etag_json_response(request, tree)


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
        courses_qs = Course.objects.select_related('college').filter(
            Q(code__icontains=query) | Q(name__icontains=query),
            # v=147：排除已删除文件夹的孤儿 Course，避免搜索结果残留
            coursecategory__isnull=False,
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
    """GET /api/stats/ — 首页统计（缓存120s）"""
    CACHE_KEY = 'api_stats_data'
    cached = cache.get(CACHE_KEY)
    if cached is not None:
        return _ok(cached)

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
        .select_related("course", "uploader")[:limit]
    recent_uploads = [{
        "id": m.id,
        "title": m.title,
        "course_code": m.course.code if m.course_id else "",
        "course_name": m.course.name if m.course_id else "",
        "college": m.course.college.short_name if m.course_id and m.course.college_id else "",
        "file_type": m.file_type,
        "uploader_name": (m.uploader.first_name if m.uploader else m.uploader_name) or "",
        "created_at": m.created_at.strftime("%Y-%m-%d %H:%M") if m.created_at else "",
    } for m in recent]

    result = {
        "total_courses": total_courses,
        "total_files": total_materials,
        "total_users": total_users,
        "college_with_data_count": college_with_data_count,
        "general_with_data_count": general_with_data_count,
        "major_with_data_count": major_with_data_count,
        "material_count": total_materials,
        "top_downloaded": top_downloaded,
        "recent_uploads": recent_uploads,
    }
    cache.set(CACHE_KEY, result, 120)
    return _ok(result)


# ═══════════════════════════════════════════════════════════════
# 学院
# ═══════════════════════════════════════════════════════════════

def api_colleges(request):
    """GET /api/colleges/ — 学院列表（缓存600s）"""
    CACHE_KEY = 'api_colleges_data'
    cached = cache.get(CACHE_KEY)
    if cached is not None:
        return _ok(cached)

    colleges = College.objects.order_by("order")
    result = [{
        "id": c.id,
        "name": c.name,
        "short_name": c.short_name,
        "slug": c.slug,
    } for c in colleges]
    cache.set(CACHE_KEY, result, 600)
    return _ok(result)
