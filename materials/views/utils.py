"""
BNU Sparks · 木铎星火 — 共享辅助函数

供 views/ 下各功能模块引用，避免跨模块循环依赖。
"""

import json
import uuid
import hmac
import hashlib
import base64
import io
import os
import re
import time
import threading
from pathlib import Path
from functools import wraps

from django.shortcuts import get_object_or_404
from django.http import JsonResponse, FileResponse
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.conf import settings
from django.db.models import Q, Count, Sum, F
from django.utils import timezone
from datetime import date, timedelta

from PIL import Image as PILImage

from ..models import (
    College, Course, CourseType, Material, MaterialType,
    CourseCategory, UserProfile, Notification, ReviewComment,
    Favorite, DownloadRecord, DeletionRecord, FolderOperation, Announcement,
    _bump_user_public_gen,
)


# 普通用户每日下载限额（版主/总管理员豁免）
DAILY_DOWNLOAD_LIMIT = 15


# ── 文件名/目录名清洗（防路径穿越，S1） ──

def _sanitize_filename_part(name, max_len=40):
    """清洗用户提供的文件名片段：消除路径穿越（/ \\ ..），截断长度，兜底空值。

    所有上传处拼接 safe_name 前必须经过本函数：
        safe_name = f"{uuid}_{_sanitize_filename_part(title)}{ext}"
    """
    if not name:
        return ""
    name = str(name).replace("\\", "/").rsplit("/", 1)[-1]
    if name in ("", ".", ".."):
        return ""
    name = re.sub(r"[\x00-\x1f\x7f]", "", name)
    if len(name) > max_len:
        name = name[:max_len]
    return name


def _safe_dir_name(name, fallback="default"):
    """清洗目录名：仅保留安全字符（字母/数字/-/_/*/中文），防目录穿越。

    course_code 用作 data/materials/ 下的目录名时使用；真实课程代码均为
    字母数字，清洗前后一致，仅对恶意输入（含 / \\ .. 等）生效。
    """
    if not name:
        return fallback
    name = str(name).replace("\\", "/").rsplit("/", 1)[-1]
    name = re.sub(r"[^A-Za-z0-9一-鿿\-_*]", "", name)
    return name.strip(".") or fallback


# ── 上传扩展名黑名单（S8）：可执行/活动内容一律拒绝 ──
# 材料平台用黑名单而非白名单：保留 caj/epub/mob 等生僻合法类型，仅拦截能在
# 源内执行或被当作程序的类型。与 nginx /media/ 移除、预览 inline 限制组合
# 成存储型 XSS 防线。
_BLOCKED_UPLOAD_EXTS = {
    '.html', '.htm', '.shtml', '.xhtml', '.svg',
    '.js', '.mjs', '.php', '.php3', '.php4', '.php5', '.php7', '.phar', '.phtml',
    '.asp', '.aspx', '.ashx', '.jsp', '.jspx', '.exe', '.com', '.bat', '.cmd',
    '.sh', '.bash', '.zsh', '.py', '.pyc', '.pyo', '.pl', '.rb', '.jar', '.dll',
    '.scr', '.vbs', '.ps1', '.msi', '.app', '.reg', '.lnk', '.hta', '.cpl',
    '.wsf', '.gadget', '.deb', '.rpm', '.apk', '.xap', '.swf',
}


def _blocked_upload_ext(ext):
    """扩展名是否在黑名单（小写匹配，含无点前缀容错）。"""
    if not ext:
        return False
    e = str(ext).strip().lower()
    if not e.startswith("."):
        e = "." + e
    return e in _BLOCKED_UPLOAD_EXTS


def _safe_int(value, default=1, lo=None, hi=None):
    """安全解析 int（防非法输入导致 500），越界收敛到 lo/hi。"""
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    if lo is not None and n < lo:
        n = lo
    if hi is not None and n > hi:
        n = hi
    return n


# ── Category/Course batch preload (request-scoped) ──
_thread_local = threading.local()


def _get_category_preload():
    """惰性加载全部 CourseCategory + Course 到线程局部存储。

    首次调用执行 2 次查询（全部 cat + 全部 course），
    后续同请求内直接返回缓存数据。
    """
    if hasattr(_thread_local, 'cat_preload'):
        return _thread_local.cat_preload

    all_cats = list(CourseCategory.objects.select_related('course').all())
    child_map = {}
    cat_by_id = {}
    for c in all_cats:
        cat_by_id[c.id] = c
        child_map.setdefault(c.parent_id, []).append(c)

    all_courses = list(Course.objects.all())
    course_by_code = {c.code: c for c in all_courses}

    _thread_local.cat_preload = {
        'child_map': child_map,
        'cat_by_id': cat_by_id,
        'course_by_code': course_by_code,
    }
    return _thread_local.cat_preload


def _clear_category_preload():
    """清除线程局部预加载数据（主要用于测试隔离）"""
    if hasattr(_thread_local, 'cat_preload'):
        del _thread_local.cat_preload


def _get_courses_in_category_preloaded(cat, preload):
    """纯内存递归遍历分类树 — 0 次 SQL。

    使用 preload 中的 child_map/cat_by_id/course_by_code
    替代所有 DB 查询。cat_by_id 确保 FK 安全的课程访问。
    """
    child_map = preload['child_map']
    cat_by_id = preload['cat_by_id']
    course_by_code = preload['course_by_code']

    courses = []

    if cat.course_id:
        preloaded_cat = cat_by_id.get(cat.id)
        if preloaded_cat and preloaded_cat.course_id:
            courses.append(preloaded_cat.course)

    if cat.course_text:
        code = cat.course_text.replace("*", "").replace("-", "")
        if code:
            courses.extend(
                c for c in course_by_code.values()
                if c.code.startswith(code)
            )

    for child in child_map.get(cat.id, []):
        courses.extend(_get_courses_in_category_preloaded(child, preload))

    return courses


# ═══════════════════════════════════════════════════════════════
# JWT 工具（纯 Python 实现，不依赖外部库）
# ═══════════════════════════════════════════════════════════════

def _jwt_encode(payload):
    """编码 JWT（role 不在 token 中，从数据库实时读取；携带 token_version 供撤销）"""
    payload = dict(payload)
    uid = payload.get("user_id")
    if uid:
        try:
            payload["ver"] = UserProfile.objects.filter(user_id=uid).values_list(
                "token_version", flat=True).first() or 0
        except Exception:
            pass

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
    if not auth.startswith("Bearer ") or len(auth) < 20:
        return None
    payload = _jwt_decode(auth[7:])
    if payload is None:
        return None
    try:
        user = User.objects.get(id=payload["user_id"])
    except User.DoesNotExist:
        return None
    # 令牌版本校验（P2.5）：改密/重置后 token_version+1，旧 JWT 立即失效。
    # 无 ver 字段的旧 token（本改动前签发）不校验，平滑过渡。
    ver = payload.get("ver")
    if ver is not None:
        try:
            current = UserProfile.objects.filter(user_id=user.id).values_list(
                "token_version", flat=True).first()
            if current is not None and current != ver:
                return None
        except Exception:
            pass
    return user


# ═══════════════════════════════════════════════════════════════
# 短时下载令牌（替代 JWT 用于 download URL，避免 token 泄露到日志）
# ═══════════════════════════════════════════════════════════════

def _generate_download_token(file_id, user_id, ttl=60):
    """生成短时下载令牌（非 JWT，URL 安全，默认 60s 过期）"""
    payload = f"{file_id}:{user_id}:{int(time.time()) + ttl}"
    sig = hmac.new(settings.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()[:16]
    return base64.urlsafe_b64encode(f"{payload}:{sig}".encode()).rstrip(b"=").decode()


def _verify_download_token(token, expected_file_id):
    """验证短时下载令牌，返回 user_id 或 None"""
    try:
        raw = base64.urlsafe_b64decode(token + "==").decode()
        parts = raw.rsplit(":", 1)
        if len(parts) != 2:
            return None
        data, sig = parts
        file_id, user_id, exp = data.split(":")
        expected = hmac.new(settings.SECRET_KEY.encode(), data.encode(), hashlib.sha256).hexdigest()[:16]
        if not hmac.compare_digest(expected, sig):
            return None
        if int(exp) < time.time():
            return None
        if int(file_id) != expected_file_id:
            return None
        return int(user_id)
    except Exception:
        return None


# ═══════════════════════════════════════════════════════════════
# 装饰器 & 基础响应
# ═══════════════════════════════════════════════════════════════

def require_login(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        user = _get_user(request)
        if user is None:
            return JsonResponse({"ok": False, "error": "请先登录"}, status=401)
        request.user = user
        return view(request, *args, **kwargs)
    return wrapper


def _get_or_create_profile(user):
    """获取用户资料，不存在则自动创建（兼容存量用户）"""
    try:
        return user.profile
    except UserProfile.DoesNotExist:
        return UserProfile.objects.create(user=user, role=UserProfile.Role.USER)


def require_role(*roles):
    """限制视图仅允许指定角色的用户访问（叠加 require_login）"""
    def decorator(view):
        @wraps(view)
        def wrapper(request, *args, **kwargs):
            user = _get_user(request)
            if user is None:
                return _err("请先登录", 401)
            profile = _get_or_create_profile(user)
            if profile.role not in roles:
                return _err("权限不足", 403)
            request.user = user
            return view(request, *args, **kwargs)
        return wrapper
    return decorator


def _ok(data=None, status=200):
    return JsonResponse({"ok": True, "data": data}, status=status)


def _err(msg, status=400):
    return JsonResponse({"ok": False, "error": msg}, status=status)


# ═══════════════════════════════════════════════════════════════
# 通知
# ═══════════════════════════════════════════════════════════════

def _create_notification(recipient, type, title, message="", material=None, triggered_by=None,
                         course_code=None, course_name=None):
    """创建通知的便捷方法，自动从 material 冗余存储 course_code/course_name"""
    if course_code is None:
        course_code = ""
        if material and material.course_id:
            try:
                course_code = material.course.code
            except Exception:
                pass
    if course_name is None:
        course_name = ""
        if material and material.course_id:
            try:
                course_name = material.course.name
            except Exception:
                pass
    return Notification.objects.create(
        recipient=recipient,
        type=type,
        title=title,
        message=message,
        material=material,
        course_code=course_code,
        course_name=course_name,
        triggered_by=triggered_by,
    )


# ═══════════════════════════════════════════════════════════════
# 下载配额
# ═══════════════════════════════════════════════════════════════

def _check_download_quota(user, material=None):
    """检查并扣除下载配额，返回 (allowed, remaining, message)

    daily_download_count 语义 = 「当天已下载的不同文件数」。
    传入 material 时：同一天同一文件只计一次数——今天已下载过的文件再次
    下载直接放行不扣配额（下载失败后重试、重复下载都不重复计数）。
    文件不存在等失败场景在调用方已前置拦截（不进入本函数）。
    """
    profile = _get_or_create_profile(user)
    if profile.role in (UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN):
        return True, -1, ""

    today = date.today()
    if profile.last_download_date != today:
        UserProfile.objects.filter(user=user).update(
            daily_download_count=0,
            last_download_date=today,
        )
        profile.refresh_from_db()

    # 同一天同一文件只计一次数：今天已下载过 → 不重复扣配额，直接放行
    if material is not None and DownloadRecord.objects.filter(
        user=user, material_id=material.id, created_at__date=today
    ).exists():
        remaining = DAILY_DOWNLOAD_LIMIT - profile.daily_download_count
        return True, remaining, ""

    if profile.daily_download_count >= DAILY_DOWNLOAD_LIMIT:
        return False, 0, f"今日下载次数已达上限（{DAILY_DOWNLOAD_LIMIT} 次）"

    UserProfile.objects.filter(user=user).update(
        daily_download_count=F('daily_download_count') + 1,
        last_download_date=today,
    )
    profile.refresh_from_db()
    remaining = DAILY_DOWNLOAD_LIMIT - profile.daily_download_count
    return True, remaining, ""


# ═══════════════════════════════════════════════════════════════
# EXIF 清理
# ═══════════════════════════════════════════════════════════════

def _strip_exif(file_path):
    """清除图片文件的 EXIF 元数据（GPS 位置信息等）

    仅处理 JPEG/PNG/WebP 格式，非图片文件静默跳过。
    失败时静默回退，不阻塞上传流程。
    """
    ext = Path(file_path).suffix.lower()
    if ext not in ('.jpg', '.jpeg', '.png', '.webp'):
        return
    try:
        img = PILImage.open(file_path)
        img.load()
        fmt = {'jpg': 'JPEG', 'jpeg': 'JPEG', 'png': 'PNG', 'webp': 'WEBP'}[ext.lstrip('.')]
        save_kwargs = {'format': fmt}
        if fmt == 'JPEG':
            save_kwargs['quality'] = 85
        buf = io.BytesIO()
        img.save(buf, **save_kwargs)
        with open(file_path, 'wb') as f:
            f.write(buf.getvalue())
    except Exception:
        pass


# ═══════════════════════════════════════════════════════════════
# 自动托管
# ═══════════════════════════════════════════════════════════════

def _check_auto_approve(course):
    """检查是否有开启了自动托管的版主/小版主管辖该课程。
    返回自动审核人 User 或 None。"""
    preload = _get_category_preload()
    cat_by_id = preload['cat_by_id']
    for p in UserProfile.objects.filter(
        role=UserProfile.Role.SUB_MODERATOR, auto_approve=True
    ).select_related('user'):
        cat_ids = set(p.moderated_sections.values_list('id', flat=True))
        for cat_id in cat_ids:
            cat = cat_by_id.get(cat_id)
            if cat is None:
                continue
            courses = _get_courses_in_category(cat)
            if course in set(courses):
                return p.user
    for p in UserProfile.objects.filter(
        role=UserProfile.Role.MODERATOR, auto_approve=True
    ).select_related('user'):
        colleges = set(p.managed_majors.values_list('id', flat=True))
        if course.college_id is None:
            if p.can_moderate_general:
                return p.user
        elif course.college_id in colleges:
            return p.user
    return None


def _get_subordinate_covered_course_ids(request_user):
    """获取被下级版主覆盖的课程 ID 集合（用于分流过滤）"""
    profile = _get_or_create_profile(request_user)
    if profile.role not in (UserProfile.Role.MODERATOR, UserProfile.Role.SUPER_ADMIN):
        return set()
    sub_cat_ids = list(UserProfile.objects.filter(
        role=UserProfile.Role.SUB_MODERATOR
    ).exclude(user=request_user).values_list('moderated_sections__id', flat=True).distinct())
    if not sub_cat_ids:
        return set()
    preload = _get_category_preload()
    cat_by_id = preload['cat_by_id']
    course_ids = set()
    for cat_id in sub_cat_ids:
        cat = cat_by_id.get(cat_id)
        if cat is None:
            continue
        course_ids.update(c.id for c in _get_courses_in_category(cat))
    return course_ids


# ═══════════════════════════════════════════════════════════════
# 课程树
# ═══════════════════════════════════════════════════════════════

def _build_tree_node(qs, *, preload=None):
    """递归构建课程树节点

    当提供 preload 参数时，使用预加载数据避免 N+1 查询。
    preload = {
        'child_map': {parent_id: [CourseCategory]},
        'course_by_code': {code: Course},
        'material_counts': {code: int},
    }
    """
    result = []
    child_map = preload.get('child_map') if preload else None
    course_by_code = preload.get('course_by_code') if preload else None
    material_counts = preload.get('material_counts') if preload else None

    for cat in qs:
        if cat.is_divider:
            result.append({"divider": True})
            continue

        node = {}
        node["id"] = cat.id
        if cat.name:
            node["name"] = cat.name
        if cat.icon_class:
            node["iconClass"] = cat.icon_class
        if cat.is_math_card:
            node["mathCard"] = True
        if cat.is_third_row:
            node["thirdRow"] = True
        # 学院 ID（用于前端权限匹配）
        if cat.course_id and cat.course.college_id:
            node["collegeId"] = cat.course.college_id

        if child_map is not None:
            children = child_map.get(cat.id, [])
        else:
            children = list(cat.children.all())

        if children:
            built = _build_tree_node(children, preload=preload)
            node["children"] = built
            # 从子节点传播 collegeId 向上
            if "collegeId" not in node:
                for child in built:
                    cid = child.get("collegeId")
                    if cid:
                        node["collegeId"] = cid
                        break
        elif cat.course_id:
            node["courseId"] = cat.course.code
            if material_counts is not None:
                node["fileCount"] = material_counts.get(cat.course.code, 0)
            else:
                node["fileCount"] = Material.objects.filter(
                    course__code=cat.course.code, is_approved=True
                ).count()
        elif cat.course_text:
            code = cat.course_text.replace("*", "").replace("-", "")
            if code:
                if "*" not in cat.course_text and material_counts is not None:
                    # 通过 preload 数据匹配课程
                    matched = []
                    for cc in course_by_code.values():
                        if cc.code.startswith(code):
                            matched.append(cc)
                    if len(matched) == 1:
                        node["courseId"] = matched[0].code
                        if matched[0].college_id:
                            node["collegeId"] = matched[0].college_id
                    else:
                        node["courseId"] = cat.course_text
                    node["fileCount"] = sum(
                        material_counts.get(c.code, 0) for c in matched
                    )
                elif "*" not in cat.course_text:
                    real = Course.objects.filter(code__startswith=code)
                    if real.count() == 1:
                        node["courseId"] = real[0].code
                        if real[0].college_id:
                            node["collegeId"] = real[0].college_id
                    else:
                        node["courseId"] = cat.course_text
                    node["fileCount"] = Material.objects.filter(
                        course__code__startswith=code, is_approved=True
                    ).count()
                else:
                    node["courseId"] = cat.course_text
                    if material_counts is not None:
                        matched = []
                        for cc in course_by_code.values():
                            if cc.code.startswith(code):
                                matched.append(cc)
                        node["fileCount"] = sum(
                            material_counts.get(c.code, 0) for c in matched
                        )
                    else:
                        node["fileCount"] = Material.objects.filter(
                            course__code__startswith=code, is_approved=True
                        ).count()

        result.append(node)

    # 显示次序：中间文件夹与空分类目录按原 order 显示，真正的课程叶子（含 courseId）置后。
    # 空分类目录（无 children、无 courseId 的命名分类）也是结构节点——如尚未导入课程的
    # 通识课大类（艺术鉴赏与审美体验/经典研读与文化传承），不应被当叶子排到末尾。
    if result and any("children" in r for r in result):
        result.sort(key=lambda r: 1 if ("courseId" in r and "children" not in r) else 0)
    elif result:
        result.sort(key=lambda r: (0 if r.get("fileCount", 0) else 1, r.get("name", "")))

    return result


# ═══════════════════════════════════════════════════════════════
# 审核路由 & 权限
# ═══════════════════════════════════════════════════════════════

def _find_moderators_for_course(course):
    """查找管辖该课程的版主（通过 managed_majors / can_moderate_general / moderated_sections）"""
    mods = UserProfile.objects.filter(
        role=UserProfile.Role.MODERATOR,
    ).prefetch_related("managed_majors", "moderated_sections")
    result = []
    for mp in mods:
        if course.college_id and mp.managed_majors.filter(id=course.college_id).exists():
            result.append(mp)
            continue
        if course.college_id is None and mp.can_moderate_general:
            result.append(mp)
            continue
        for cat in mp.moderated_sections.all():
            if course in _get_courses_in_category(cat):
                result.append(mp)
                break
    return result


def _calculate_review_assignment(material):
    """
    审核路由逻辑：
    专业课 → 有小版主？→ 推给小版主
           → 无小版主？→ 推给版主
           → 无版主？→ 不指派
    通识课 → 推给板块对应的版主
           → 无对应？→ 不指派
    返回 User 或 None
    """
    course = material.course
    if course.course_type == CourseType.MAJOR and course.college_id:
        sub_mods = UserProfile.objects.filter(
            role=UserProfile.Role.SUB_MODERATOR,
        ).prefetch_related("moderated_sections")
        for sm in sub_mods:
            for cat in sm.moderated_sections.all():
                if course in _get_courses_in_category(cat):
                    return sm.user

        mods = _find_moderators_for_course(course)
        if mods:
            return mods[0].user
    else:
        mods = _find_moderators_for_course(course)
        if mods:
            return mods[0].user

    return None


def _get_courses_in_category(cat):
    """递归获取分类节点下所有 Course 实例（自动使用预加载数据，若可用）"""
    preload = getattr(_thread_local, 'cat_preload', None)
    if preload is not None:
        return _get_courses_in_category_preloaded(cat, preload)

    courses = []
    if cat.course_id:
        courses.append(cat.course)
    if cat.course_text:
        code = cat.course_text.replace("*", "").replace("-", "")
        if code:
            courses.extend(Course.objects.filter(code__startswith=code))
    for child in cat.children.all():
        courses.extend(_get_courses_in_category(child))
    return courses


def _get_moderated_material_qs(user, include_assigned=True):
    """获取用户权限范围内的 Material QuerySet"""
    profile = _get_or_create_profile(user)
    if profile.role == UserProfile.Role.SUPER_ADMIN:
        qs = Material.objects.select_related("course", "uploader", "material_type", "reviewed_by")
        return qs if include_assigned else qs

    _get_category_preload()  # 预热 preload，后续 _get_courses_in_category 走内存

    if profile.role == UserProfile.Role.SUB_MODERATOR:
        all_courses = []
        for cat in profile.moderated_sections.all():
            all_courses.extend(_get_courses_in_category(cat))
        q = Q(course__in=set(all_courses)) if all_courses else Q(pk__in=[])
        q |= Q(uploader=user)
        if include_assigned:
            q |= Q(assigned_moderator=user)
        return Material.objects.filter(q).select_related("course", "uploader", "material_type", "reviewed_by")

    all_courses = set()
    for college in profile.managed_majors.all():
        all_courses.update(Course.objects.filter(college=college))
    if profile.can_moderate_general:
        all_courses.update(Course.objects.filter(college_id__isnull=True))
    for cat in profile.moderated_sections.all():
        all_courses.update(_get_courses_in_category(cat))
    q = Q(course__in=all_courses) if all_courses else Q(pk__in=[])
    q |= Q(uploader=user)
    if include_assigned:
        q |= Q(assigned_moderator=user)
    return Material.objects.filter(q).select_related("course", "uploader", "material_type", "reviewed_by")


def _user_can_edit_material(user, material):
    """返回当前用户是否有权编辑/删除该资料（用于 can_delete 字段，不抛异常）"""
    if not user.is_authenticated:
        return False
    # 自己上传的始终可编辑
    if material.uploader_id == user.id:
        return True
    profile = _get_or_create_profile(user)
    if profile.role == UserProfile.Role.SUPER_ADMIN:
        return True
    if profile.role in (UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR):
        try:
            _check_moderator_access(user, material)
            return True
        except Exception:
            return False
    return False


def _check_moderator_access(user, material, allow_uploader=True):
    """校验 moderator / sub_moderator 是否有权操作该资料

    allow_uploader=True: 上传者本人始终可访问（编辑/删除/审核上下文默认）
    allow_uploader=False: 上传者本人不算权限（「驳回资料下载」场景专用，
                          防止普通用户绕过审核下载自己被驳回的文件）
    """
    profile = _get_or_create_profile(user)
    if profile.role == UserProfile.Role.SUPER_ADMIN:
        return
    # 自己上传的始终可访问（驳回下载时关闭）
    if allow_uploader and material.uploader_id == user.id:
        return
    if profile.role == UserProfile.Role.SUB_MODERATOR:
        # 缓存全量课程集合在同一次请求内的 user 对象上（避免每文件重复查询）
        if not hasattr(user, '_sub_managed_courses'):
            preload = _get_category_preload()
            cat_by_id = preload['cat_by_id']
            cat_ids = set(profile.moderated_sections.values_list("id", flat=True))
            all_courses = []
            for cat_id in cat_ids:
                cat = cat_by_id.get(cat_id)
                if cat is None:
                    continue
                all_courses.extend(_get_courses_in_category(cat))
            user._sub_managed_courses = set(all_courses)
        if material.course not in user._sub_managed_courses and material.assigned_moderator_id != user.id:
            from django.http import Http404
            raise Http404("无权操作该资料")
        return
    # MODERATOR 分支：预热 preload，后续 _get_courses_in_category 走内存版
    _get_category_preload()
    # 新建课程申请随附文件（course 为 NULL）：仅指派审核人可操作，
    # 不得经由「can_moderate_general」等课程作用域分支触碰
    if material.course_id is None:
        if material.assigned_moderator_id != user.id:
            from django.http import Http404
            raise Http404("无权操作该资料")
        return
    if not hasattr(user, '_mod_colleges'):
        user._mod_colleges = set(profile.managed_majors.values_list("id", flat=True))
    colleges = user._mod_colleges
    if material.course.college_id is None:
        if profile.can_moderate_general:
            return
        for cat in profile.moderated_sections.all():
            if material.course in _get_courses_in_category(cat):
                return
        if material.assigned_moderator_id != user.id:
            from django.http import Http404
            raise Http404("无权操作该资料")
        return
    if material.course.college_id in colleges:
        return
    for cat in profile.moderated_sections.all():
        if material.course in _get_courses_in_category(cat):
            return
    if material.assigned_moderator_id == user.id:
        return
    from django.http import Http404
    raise Http404("无权操作该资料")


# ═══════════════════════════════════════════════════════════════
# 管辖范围显示
# ═══════════════════════════════════════════════════════════════

def _unique_college_names(colleges):
    """College 列表按全称去重"""
    seen = set()
    result = []
    for c in colleges:
        if c.name not in seen:
            seen.add(c.name)
            result.append({"id": c.id, "name": c.short_name or c.name})
    return result


def _get_managed_sections_display(profile):
    """返回用户管辖范围的可读描述（用于个人中心显示）"""
    if profile.role == UserProfile.Role.MODERATOR:
        parts = []
        seen = set()
        for c in profile.managed_majors.all():
            name = c.short_name or c.name
            if name not in seen:
                seen.add(name)
                parts.append(name)
        if profile.can_moderate_general:
            parts.append("通识课")
        elif profile.moderated_sections.exists():
            for s in profile.moderated_sections.all():
                if s.name and s.name not in parts:
                    parts.append(s.name)
        return parts or "未分配"
    elif profile.role == UserProfile.Role.SUB_MODERATOR:
        sections = list(profile.moderated_sections.all())
        all_ids = set(s.id for s in sections)
        top = [s for s in sections if s.parent_id not in all_ids]
        parts = []
        for s in top:
            n = s.name or f"节点 #{s.id}"
            if n not in parts:
                parts.append(n)
        return parts or "未分配"
    return []


# ═══════════════════════════════════════════════════════════════
# 删除记录权限
# ═══════════════════════════════════════════════════════════════

def _get_visible_deletion_records(user):
    """获取管理员可见的删除记录（按管辖范围过滤）"""
    from ..models import Course  # noqa: F811 — local import to avoid cycles
    profile = _get_or_create_profile(user)
    if profile.role == UserProfile.Role.SUPER_ADMIN:
        return DeletionRecord.objects.all()

    preload = _get_category_preload()
    cat_by_id = preload['cat_by_id']
    visible_codes = set()
    if profile.role == UserProfile.Role.MODERATOR:
        college_ids = list(profile.managed_majors.values_list("id", flat=True))
        for c in Course.objects.filter(college_id__in=college_ids).only("code"):
            if c.code: visible_codes.add(c.code)
        if profile.can_moderate_general:
            for c in Course.objects.filter(college__isnull=True).only("code"):
                if c.code: visible_codes.add(c.code)
        for cat_id in profile.moderated_sections.values_list("id", flat=True):
            cat = cat_by_id.get(cat_id)
            if cat is None:
                continue
            for c in _get_courses_in_category(cat):
                if c.code: visible_codes.add(c.code)
    elif profile.role == UserProfile.Role.SUB_MODERATOR:
        for cat_id in profile.moderated_sections.values_list("id", flat=True):
            cat = cat_by_id.get(cat_id)
            if cat is None:
                continue
            for c in _get_courses_in_category(cat):
                if c.code: visible_codes.add(c.code)

    if visible_codes:
        return DeletionRecord.objects.filter(course_code__in=visible_codes)
    return DeletionRecord.objects.none()
