"""
BNU Sparks · 木铎星火 — JSON API 视图

所有视图返回 JSON，前端通过 fetch() 调用。
"""

import json
import uuid
import hmac
import hashlib
import base64
import time
from pathlib import Path
from functools import wraps

from django.shortcuts import get_object_or_404
from django.http import JsonResponse, FileResponse
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.conf import settings
from django.db.models import Q, Count

from .models import College, Course, Material, MaterialType, CourseCategory


# ═══════════════════════════════════════════════════════════════
# JWT 工具（纯 Python 实现，不依赖外部库）
# ═══════════════════════════════════════════════════════════════

def _jwt_encode(payload):
    header = base64.urlsafe_b64encode(
        json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    ).rstrip(b"=").decode()
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload).encode()
    ).rstrip(b"=").decode()
    sig = hmac.new(
        settings.SECRET_KEY.encode(),
        f"{header}.{payload_b64}".encode(),
        hashlib.sha256,
    ).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    return f"{header}.{payload_b64}.{sig_b64}"


def _jwt_decode(token):
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        h, p, s = parts
        expected = hmac.new(
            settings.SECRET_KEY.encode(),
            f"{h}.{p}".encode(), hashlib.sha256,
        ).digest()
        actual = base64.urlsafe_b64decode(s + "==")
        if not hmac.compare_digest(expected, actual):
            return None
        payload = json.loads(base64.urlsafe_b64decode(p + "=="))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None


def _get_user(request):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    payload = _jwt_decode(auth[7:])
    if payload is None:
        return None
    try:
        return User.objects.get(id=payload["user_id"])
    except User.DoesNotExist:
        return None


def require_login(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        user = _get_user(request)
        if user is None:
            return JsonResponse({"ok": False, "error": "请先登录"}, status=401)
        request.user = user
        return view(request, *args, **kwargs)
    return wrapper


def _ok(data=None, status=200):
    return JsonResponse({"ok": True, "data": data}, status=status)


def _err(msg, status=400):
    return JsonResponse({"ok": False, "error": msg}, status=status)


# ═══════════════════════════════════════════════════════════════
# 认证 API
# ═══════════════════════════════════════════════════════════════

@csrf_exempt
def api_register(request):
    """POST /api/auth/register — 仅需 email + nickname，自动生成密码"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("请求格式错误")

    email = (body.get("email") or "").strip().lower()
    nickname = (body.get("nickname") or "").strip()

    if not email:
        return _err("邮箱不能为空")
    if not nickname:
        return _err("昵称不能为空")
    if not email.endswith("@mail.bnu.edu.cn"):
        return _err("请使用北师大校内邮箱（@mail.bnu.edu.cn）")

    if User.objects.filter(username=email).exists():
        return _err("该邮箱已注册")

    # 自动生成 10 位随机密码
    password = uuid.uuid4().hex[:10]

    user = User.objects.create_user(
        username=email, password=password, email=email,
        first_name=nickname,
    )

    token = _jwt_encode({
        "user_id": user.id,
        "exp": time.time() + 7 * 86400,
    })
    return _ok({
        "token": token,
        "generated_password": password,
        "user": {
            "id": user.id,
            "username": user.username,
            "nickname": nickname,
            "email": user.email,
        },
    })


@csrf_exempt
def api_login(request):
    """POST /api/auth/login — 支持邮箱或用户名登录"""
    if request.method != "POST":
        return _err("仅支持 POST", 405)
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _err("请求格式错误")

    username = (body.get("username") or "").strip()
    password = (body.get("password") or "").strip()

    if not username or not password:
        return _err("邮箱和密码不能为空")

    # 直接用 username/password 认证
    user = authenticate(username=username, password=password)
    # 如果失败，按邮箱查找
    if user is None:
        try:
            user_obj = User.objects.get(email__iexact=username)
            user = authenticate(username=user_obj.username, password=password)
        except User.DoesNotExist:
            pass

    if user is None:
        return _err("邮箱或密码错误")

    token = _jwt_encode({
        "user_id": user.id,
        "exp": time.time() + 7 * 86400,
    })
    return _ok({
        "token": token,
        "user": {
            "id": user.id,
            "username": user.username,
            "nickname": user.first_name or user.username,
            "email": user.email,
        },
    })


def api_me(request):
    """GET /api/auth/me"""
    user = _get_user(request)
    if user is None:
        return _err("请先登录", 401)
    return _ok({
        "id": user.id,
        "username": user.username,
        "nickname": user.first_name or user.username,
        "email": user.email,
        "is_staff": user.is_staff,
    })


# ═══════════════════════════════════════════════════════════════
# 课程 API
# ═══════════════════════════════════════════════════════════════

def api_courses(request):
    """GET /api/courses"""
    qs = Course.objects.annotate(
        material_cnt=Count("materials", filter=Q(materials__is_approved=True)),
    ).order_by("name")

    course_type = request.GET.get("type")
    if course_type in ("general", "major"):
        qs = qs.filter(course_type=course_type)

    college = request.GET.get("college")
    if college:
        qs = qs.filter(college__name__icontains=college)

    search = request.GET.get("search")
    if search:
        qs = qs.filter(Q(name__icontains=search) | Q(code__icontains=search))

    return _ok([
        {
            "id": c.id, "name": c.name, "code": c.code,
            "course_type": c.course_type,
            "college": c.college.name if c.college else None,
            "material_count": c.material_cnt,
        }
        for c in qs[:300]
    ])


def api_course_files(request, course_code):
    """GET /api/courses/<code>/files"""
    course = get_object_or_404(Course, code=course_code)
    materials = Material.objects.filter(
        course=course, is_approved=True
    ).select_related("material_type").order_by("-created_at")

    return _ok([
        {
            "id": m.id, "title": m.title,
            "file_name": m.file_name, "file_size": m.file_size,
            "file_type": m.material_type.name if m.material_type else (m.file_type or "其他"),
            "uploader": m.uploader_name or "匿名",
            "teacher": m.teacher,
            "download_count": m.download_count,
            "created_at": m.created_at.strftime("%Y-%m-%d"),
        }
        for m in materials
    ])


# ═══════════════════════════════════════════════════════════════
# 文件上传 / 下载
# ═══════════════════════════════════════════════════════════════

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

    if not course_code or not title or not uploaded_file:
        return _err("课程代码、标题和文件不能为空")

    try:
        course = Course.objects.get(code=course_code)
    except Course.DoesNotExist:
        return _err("课程不存在")

    # 保存文件
    ext = Path(uploaded_file.name).suffix
    safe_name = f"{uuid.uuid4().hex[:12]}_{title[:40]}{ext}"
    save_dir = Path(settings.MEDIA_ROOT) / course_code
    save_dir.mkdir(parents=True, exist_ok=True)

    with open(save_dir / safe_name, "wb") as f:
        for chunk in uploaded_file.chunks():
            f.write(chunk)

    file_size = (save_dir / safe_name).stat().st_size

    material = Material.objects.create(
        course=course, title=title, description=description,
        teacher=teacher,
        file_name=uploaded_file.name,
        file_path=f"{course_code}/{safe_name}",
        file_size=file_size,
        uploader_name=request.user.username,
        is_approved=True,
    )

    # 尝试 git commit
    try:
        from git_storage import commit_file
        commit_file(f"{course_code}/{safe_name}")
    except Exception:
        pass

    return _ok({
        "id": material.id, "title": material.title,
        "file_name": uploaded_file.name, "file_size": file_size,
        "created_at": material.created_at.strftime("%Y-%m-%d"),
    })


def api_file_download(request, file_id):
    """GET /api/files/<id>/download"""
    material = get_object_or_404(Material, id=file_id, is_approved=True)
    file_path = Path(settings.MEDIA_ROOT) / material.file_path

    if not file_path.exists():
        return _err("文件不存在", 404)

    Material.objects.filter(id=file_id).update(
        download_count=material.download_count + 1
    )

    return FileResponse(
        open(file_path, "rb"),
        as_attachment=True,
        filename=material.file_name or material.title,
    )


# ═══════════════════════════════════════════════════════════════
# 搜索
# ═══════════════════════════════════════════════════════════════

def api_search(request):
    """GET /api/search?q="""
    q = request.GET.get("q", "").strip()
    if len(q) < 1:
        return _ok({"query": q, "courses": [], "materials": []})

    courses = Course.objects.filter(
        Q(name__icontains=q) | Q(code__icontains=q)
    ).annotate(
        material_cnt=Count("materials", filter=Q(materials__is_approved=True)),
    )[:20]

    materials = Material.objects.filter(is_approved=True).filter(
        Q(title__icontains=q) | Q(description__icontains=q) |
        Q(course__name__icontains=q)
    ).select_related("course")[:20]

    return _ok({
        "query": q,
        "courses": [
            {"id": c.id, "name": c.name, "code": c.code,
             "course_type": c.course_type,
             "college": c.college.name if c.college else None,
             "material_count": c.material_cnt}
            for c in courses
        ],
        "materials": [
            {"id": m.id, "title": m.title,
             "course_name": m.course.name, "course_code": m.course.code,
             "file_name": m.file_name, "file_size": m.file_size,
             "uploader": m.uploader_name or "匿名",
             "teacher": m.teacher,
             "created_at": m.created_at.strftime("%Y-%m-%d")}
            for m in materials
        ],
    })


# ═══════════════════════════════════════════════════════════════
# 课程导航树
# ═══════════════════════════════════════════════════════════════

def _build_tree_node(qs):
    """递归构建课程树节点"""
    result = []
    for cat in qs:
        if cat.is_divider:
            result.append({"divider": True})
            continue

        node = {}
        if cat.name:
            node["name"] = cat.name
        if cat.icon_class:
            node["iconClass"] = cat.icon_class
        if cat.is_math_card:
            node["mathCard"] = True

        children = cat.children.all()
        if children:
            node["children"] = _build_tree_node(children)
        elif cat.course_id:
            # 叶子节点：关联真实课程
            node["courseId"] = cat.course.code
            node["hasFiles"] = Material.objects.filter(
                course=cat.course, is_approved=True
            ).exists()
        elif cat.course_text:
            # 叶子节点：通配符代码
            node["courseId"] = cat.course_text
            # 试试能否匹配实际课程
            code = cat.course_text.replace("*", "").replace("-", "")
            if code:
                node["hasFiles"] = Material.objects.filter(
                    course__code__startswith=code, is_approved=True
                ).exists()

        result.append(node)

    # 纯叶子节点层：有资料的课程浮到顶端
    if result and not any("children" in r for r in result):
        result.sort(key=lambda r: (0 if r.get("hasFiles") else 1, r.get("name", "")))

    return result


def api_course_tree(request):
    """GET /api/courses/tree — 课程导航树（动态构建，含实时 hasFiles）"""
    roots = CourseCategory.objects.filter(parent=None).order_by("order")
    tree = {}
    for root in roots:
        children = root.children.all()
        if children:
            tree[root.name] = {"children": _build_tree_node(children)}
    return _ok(tree)


# ═══════════════════════════════════════════════════════════════
# 统计
# ═══════════════════════════════════════════════════════════════

def api_stats(request):
    limit = request.GET.get("limit", 5)
    try:
        limit = int(limit) if limit else None
    except ValueError:
        limit = 5

    top = Material.objects.filter(is_approved=True).select_related(
        "course__college"
    ).order_by("-download_count")[:limit]
    recent = Material.objects.filter(is_approved=True).select_related(
        "course__college"
    ).order_by("-created_at")[:limit]

    # 只统计有已获批材料的课程
    courses_with_materials = Course.objects.filter(
        materials__is_approved=True
    ).distinct()
    colleges_with_materials = College.objects.filter(
        course__materials__is_approved=True
    ).distinct()
    general_with_data = courses_with_materials.filter(course_type="general").count()
    major_with_data = courses_with_materials.filter(course_type="major").count()

    return _ok({
        "course_count": Course.objects.count(),
        "course_with_data_count": courses_with_materials.count(),
        "general_count": Course.objects.filter(course_type="general").count(),
        "major_count": Course.objects.filter(course_type="major").count(),
        "general_with_data_count": general_with_data,
        "major_with_data_count": major_with_data,
        "material_count": Material.objects.filter(is_approved=True).count(),
        "user_count": User.objects.count(),
        "college_count": College.objects.count(),
        "college_with_data_count": colleges_with_materials.count(),
        "colleges_with_data": [
            {"id": c.id, "name": c.name}
            for c in colleges_with_materials.order_by("name")
        ],
        "top_downloaded": [
            {"id": m.id, "title": m.title,
             "course_name": m.course.name, "course_code": m.course.code,
             "college": m.course.college.name if m.course.college else None,
             "download_count": m.download_count}
            for m in top
        ],
        "recent_uploads": [
            {"id": m.id, "title": m.title,
             "course_name": m.course.name, "course_code": m.course.code,
             "college": m.course.college.name if m.course.college else None,
             "created_at": m.created_at.strftime("%Y-%m-%d"),
             "uploader": m.uploader_name or "匿名"}
            for m in recent
        ],
    })
