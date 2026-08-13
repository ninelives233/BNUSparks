"""
BNU Sparks · 木铎星火 — 审核路由与权限辅助
"""

from django.db.models import Q

from ..models import (
    Course, CourseCategory, CourseType, DeletionRecord, Material,
    Notification, UserProfile,
)

from .utils_auth import _get_or_create_profile
from .utils_course_tree import (
    _college_node_of, _find_nodes_containing_course, _get_category_preload,
    _get_courses_in_category, _node_under,
)

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
# 自动托管
# ═══════════════════════════════════════════════════════════════

def _user_covers_course(user, course):
    """当前用户是否在辖区上覆盖该课程（课程粒度，镜像 _check_moderator_access）。

    - super_admin → True
    - 普通用户 → False
    - sub_moderator → moderated_sections 展开命中课程
    - moderator → managed_majors 学院命中 / 通识课 can_moderate_general / moderated_sections 展开命中

    供自动托管判定（_check_auto_approve）与「越辖区上传走 pending」后备开关
    （ENFORCE_UPLOAD_SCOPE，默认关闭）复用，保证两处口径一致。
    """
    profile = _get_or_create_profile(user)
    if profile.role == UserProfile.Role.SUPER_ADMIN:
        return True
    if profile.role == UserProfile.Role.USER:
        return False
    _get_category_preload()
    if profile.role == UserProfile.Role.SUB_MODERATOR:
        for cat in profile.moderated_sections.all():
            if course in _get_courses_in_category(cat):
                return True
        return False
    # MODERATOR：三路匹配（managed_majors / can_moderate_general / moderated_sections）
    if course.college_id is None:
        if profile.can_moderate_general:
            return True
    elif profile.managed_majors.filter(id=course.college_id).exists():
        return True
    for cat in profile.moderated_sections.all():
        if course in _get_courses_in_category(cat):
            return True
    return False


def _check_auto_approve(course):
    """检查是否有开启了自动托管的版主/小版主管辖该课程。
    返回自动审核人 User 或 None。"""
    for p in UserProfile.objects.filter(
        role=UserProfile.Role.SUB_MODERATOR, auto_approve=True
    ).select_related('user'):
        if _user_covers_course(p.user, course):
            return p.user
    for p in UserProfile.objects.filter(
        role=UserProfile.Role.MODERATOR, auto_approve=True
    ).select_related('user'):
        # 统一走 _user_covers_course 三路匹配，修复此前版主分支漏查
        # moderated_sections 导致与 _review_candidates 口径分裂的问题
        if _user_covers_course(p.user, course):
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


def _review_candidates(material, context_category=None):
    """审核路由（v171 广播式）：返回同一优先层级内的全部候选，不挑人

      L1 上传上下文节点本身挂的小版主（节点精确命中，不展开祖先——A2/BCD 完全不看）
      → L2 同学院（上下文节点的一级节点子树）内所有含此课的节点的小版主
      → L3 版主兜底（有上下文时限定在学院子树内，杜绝 BCD 版主漏进）
      → L4 全部超管兜底

    广播语义：取第一个有候选的层级，返回该层级全部候选（去重），
    不再按待审量挑最少者——多候选同时收到通知，先审先得（审核动作原子归主）。

    通识课/无学院：版主 → 超管兜底（小版主不参与通识路由，v169 固化设计）。
    无上下文（category_id 缺失/伪造）：跳过 L1/L2，直接落版主 → 超管。
    返回 list[User]（可能为空；课程申请随附文件 course 为空时不参与）。
    """
    course = material.course
    if course is None:
        return []  # 课程申请随附文件（course_id 为空）不参与自动路由

    def _dedup(users):
        return list(dict.fromkeys(users))

    # 通识课 / 无学院：不走专业路由，版主 → 超管
    if course.course_type != CourseType.MAJOR or not course.college_id:
        mods = _find_moderators_for_course(course)
        if mods:
            return [m.user for m in mods]
        return _all_super_admins()

    sub_mods = UserProfile.objects.filter(
        role=UserProfile.Role.SUB_MODERATOR,
    ).select_related("user").prefetch_related("moderated_sections")

    college_node = _college_node_of(context_category) if context_category is not None else None

    # L1：上传上下文节点本身的小版主
    if context_category is not None:
        l1 = [sm.user for sm in sub_mods
              if context_category in sm.moderated_sections.all()]
        if l1:
            return _dedup(l1)

    # L2：同学院内所有含此课的节点的小版主
    if college_node is not None:
        nodes = _find_nodes_containing_course(college_node, course)
        l2 = [sm.user for sm in sub_mods
              if any(n in sm.moderated_sections.all() for n in nodes)]
        if l2:
            return _dedup(l2)

    # L3：版主兜底（有上下文 → 限定学院子树；无上下文 → 全口径）
    if context_category is not None and college_node is not None:
        mods = _find_moderators_for_course_scoped(course, college_node)
    else:
        mods = _find_moderators_for_course(course)
    if mods:
        return [m.user for m in mods]

    # L4：全部超管兜底
    return _all_super_admins()


def _find_moderators_for_course_scoped(course, college_node):
    """管辖该课程、且管辖范围在 college_node 子树内的版主。

    与 _find_moderators_for_course 同口径，但 moderated_sections 命中必须落在
    college_node 子树内——杜绝其他学院（BCD）仅凭板块挂课漏进 L3 兜底。
    """
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
            if _node_under(cat, college_node) and course in _get_courses_in_category(cat):
                result.append(mp)
                break
    return result


def _all_super_admins():
    """L4 兜底：全部超管（广播式——多超管同时收到待审）"""
    return [sa.user for sa in UserProfile.objects.filter(
        role=UserProfile.Role.SUPER_ADMIN,
    ).select_related("user")]


def _report_candidates(material):
    """举报分配候选：与上传审核路由完全一致（含小版主，L1→L2→L3→L4）。

    上报时无上传上下文，用材料课程反查树叶子节点（CourseCategory.course FK）作
    context_category 复现上传路由；课程不在树 / 上下文缺失 → _review_candidates
    落 L3 版主→L4 超管；course=None（悬空材料）→ 全部超管兜底。
    course 同时挂在多个树节点时取树序首个，属边缘情况（可接受）。
    """
    if material is None or material.course_id is None:
        return _all_super_admins()
    ctx = CourseCategory.objects.filter(course_id=material.course_id).first()
    cands = _review_candidates(material, ctx)
    return cands or _all_super_admins()


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
    """获取管理员可见的删除记录（按管辖范围过滤）

    v=XXX：追加「自己删除的记录」始终可见，与 _get_moderated_material_qs 的
    uploader/assigned 口径对齐的部分。注意 DeletionRecord.material_id 是裸
    IntegerField、无 uploader FK，故「自己上传的」无法用 FK 关联，不做上传者匹配。
    """
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

    q = Q(deleted_by=user)
    if visible_codes:
        q |= Q(course_code__in=visible_codes)
    return DeletionRecord.objects.filter(q)
