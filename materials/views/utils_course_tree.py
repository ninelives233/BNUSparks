"""
BNU Sparks · 木铎星火 — 课程树辅助（存在性收敛、壳节点去重、preload 缓存、树构建/遍历）
"""

import threading

from ..models import Course, CourseCategory, Material

# ── 课程存在性收敛 / 壳节点去重（v=165） ──
# 同一课程代码在历史种子中可能有多条 Course 行（每学院一条）。文件按 code
# 全局解析 → 同码课程本质共享同一目录。凡「新建课程」类操作（申请批准 /
# 管理模式建课程文件夹）都应收敛复用既有 Course，而非对多行同码硬报错。
# 放本模块避免 course_requests → operations 循环依赖。

def _find_existing_course(code, college_id=None):
    """确定性收敛同码 Course：① 学院匹配 → ② 有已审资料（最早）→ ③ 最早。找不到返回 None。"""
    if not code:
        return None
    qs = Course.objects.filter(code=code)
    if college_id:
        hit = qs.filter(college_id=college_id).first()
        if hit:
            return hit
    hit = qs.filter(materials__is_approved=True).order_by("id").first()
    if hit:
        return hit
    return qs.order_by("id").first()


def _find_leaf_under_parent(parent, course):
    """父节点下是否已有指向该 Course 的叶子（壳节点去重用）。"""
    if parent is None or course is None:
        return None
    return CourseCategory.objects.filter(parent=parent, course=course).first()


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


def _node_contains_course(node, course):
    """分类节点是否包含该课程（叶子 FK 或 course_text 前缀命中）"""
    if course is None or node is None:
        return False
    if node.course_id == course.id:
        return True
    pattern = (node.course_text or "").replace("*", "").replace("-", "")
    return bool(pattern) and (course.code or "").startswith(pattern)


def _college_node_of(cat):
    """返回 cat 所属的一级节点（根的直属子节点 = 学院/通识大类；cat 是根时返回 None）"""
    if cat is None:
        return None
    chain = []
    p = cat
    while p:
        chain.append(p)
        p = p.parent
    return chain[-2] if len(chain) >= 2 else None


def _node_under(cat, ancestor):
    """cat 是否等于 ancestor 或是其后代"""
    p = cat
    while p:
        if p.pk == ancestor.pk:
            return True
        p = p.parent
    return False


def _find_nodes_containing_course(root, course):
    """在 root 子树内找出所有包含 course 的分类节点（叶子 FK 或 course_text 前缀）"""
    found = []
    if _node_contains_course(root, course):
        found.append(root)
    stack = list(root.children.all())
    while stack:
        n = stack.pop()
        if _node_contains_course(n, course):
            found.append(n)
        stack.extend(n.children.all())
    return found


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


