"""
BNU Sparks · 木铎星火 — 文件夹管理内部辅助函数

课程树节点权限判定 / 学院子树计算 / 自建课程编号生成。
被 operations_* 各子模块与 course_requests 复用。
"""

from django.db.models import Max

from ..models import Course, CourseCategory
from .utils import (
    _get_or_create_profile, _get_category_preload, _get_courses_in_category,
    UserProfile,
)

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
