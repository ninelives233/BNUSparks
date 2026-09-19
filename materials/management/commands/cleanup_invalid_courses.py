"""清理无效课程节点与孤立占位课程（幂等）。

删除对象（v=142 需求，v=147 补「死节点收敛」）：
- 通识课树中的无效叶子节点（无有效课程代码或代码为无意义填充字符）：
  2262 学术英语 / 人文通识课程群（course_text='GEN02***'）
  2274 经典影视作品分析（无 course、无 course_text）
  2275 艺术作品中的国家形象（无 course、无 course_text）
  2290 经典研读与文化传承（模块课程）（course_text='GEN02***'）
- 孤立占位 Course 记录：
  6486 个性化发展选修（code='GEN****'）
  6487 经典研读与文化传承（模块课程）（code='GEN02***'）
- 死节点收敛：无效叶子删除后，向上递归删除变成「空壳」的父级
  （无 course、无 course_text、无 children、非 divider），
  如 2273 艺术鉴赏与审美体验、2289 经典研读与文化传承 会被顺带收敛。

运行：python manage.py cleanup_invalid_courses [--apply]
（不带 --apply 时为 dry-run 预览，不真正删除）
"""
import logging

from django.core.management.base import BaseCommand
from django.db import transaction

from materials.models import Course, CourseCategory

logger = logging.getLogger(__name__)

INVALID_NODE_IDS = [2262, 2274, 2275, 2290]
ORPHAN_COURSE_IDS = [6486, 6487]


def _is_dead_node(n):
    """死节点 = 非 divider、无课程、无通配代码、无子节点"""
    return (not n.is_divider
            and n.course_id is None
            and not (n.course_text or "").strip()
            and not n.children.exists())


def _is_protected_structural(n):
    """结构保护：深度 0/1 的节点（根、以及根的直接子节点，如通识课/专业课下的大类、
    各学院）是导航结构的一部分，即使暂时为空也不得收敛删除。

    血泪教训：v147 收敛「死节点」时误删了 2273 艺术鉴赏与审美体验、2289 经典研读
    与文化传承 这两个真正的通识课大类（当时空壳无课）——它们是 BNU 通识教育固定模块，
    后续培养方案导入会往里填课，绝不能自动删。见 xaccel-nonascii-header-bug 同批会话。
    """
    # n 的父是根（n.parent.parent 为 None）→ n 是深度 1 的顶级分类/学院
    if n.parent is None:
        return True
    if n.parent.parent is None:
        return True
    return False


def _predict_dead_ancestors(node_ids):
    """dry-run：模拟删除 node_ids 后会被收敛成死节点的祖先（不真正删除）"""
    ids = set(node_ids)
    dead = []
    for nid in node_ids:
        try:
            n = CourseCategory.objects.get(id=nid)
        except CourseCategory.DoesNotExist:
            continue
        parent = n.parent
        while parent is not None and _is_dead_node(parent) and parent.children.exists():
            # 结构保护：顶级分类/学院是导航骨架，永不收敛删除
            if _is_protected_structural(parent):
                break
            siblings = set(parent.children.values_list("id", flat=True))
            if siblings and siblings <= ids:
                if parent.id not in ids:
                    dead.append(parent)
                ids.add(parent.id)
                parent = parent.parent
            else:
                break
    return dead


class Command(BaseCommand):
    help = "清理无效课程节点（无课程代码/占位填充字符）与孤立占位 Course 记录"

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true",
            help="真正执行删除；缺省为 dry-run 预览",
        )

    def handle(self, *args, **opts):
        apply = opts["apply"]

        # ── 收集无效节点（幂等：只处理仍存在者）──
        invalid_nodes = CourseCategory.objects.filter(id__in=INVALID_NODE_IDS)
        nodes = list(invalid_nodes)
        for n in nodes[:]:
            if n.children.exists():
                self.stderr.write(
                    self.style.ERROR(f"[跳过] 节点 #{n.id} {n.name!r} 仍有子节点，不删除")
                )
                nodes.remove(n)
                continue
            if n.course_id is not None:
                self.stderr.write(
                    self.style.ERROR(f"[跳过] 节点 #{n.id} {n.name!r} 仍关联课程，不删除")
                )
                nodes.remove(n)
                continue

        # ── 收集孤立 Course（幂等：只处理仍存在且无引用的）──
        orphans = []
        for c in Course.objects.filter(id__in=ORPHAN_COURSE_IDS):
            if CourseCategory.objects.filter(course_id=c.id).exists():
                self.stderr.write(
                    self.style.ERROR(f"[跳过] Course #{c.id} {c.code!r} 仍被课程节点引用，不删除")
                )
                continue
            if c.materials.exists():
                self.stderr.write(
                    self.style.ERROR(f"[跳过] Course #{c.id} {c.code!r} 仍有资料，不删除")
                )
                continue
            orphans.append(c)

        # ── 预测死节点收敛（dry-run 预览用）──
        node_ids = [n.id for n in nodes]
        dead_ancestors = _predict_dead_ancestors(node_ids)

        self.stdout.write(
            f"待删除无效节点 {len(nodes)} 个："
            + ", ".join(f"#{n.id} {n.name or '(无名)'}" for n in nodes)
        )
        if dead_ancestors:
            self.stdout.write(
                f"执行后将被收敛的死节点父级 {len(dead_ancestors)} 个："
                + ", ".join(f"#{d.id} {d.name or '(无名)'}" for d in dead_ancestors)
            )
        self.stdout.write(
            f"待删除孤立课程 {len(orphans)} 个："
            + ", ".join(f"#{c.id} {c.code!r} {c.name!r}" for c in orphans)
        )

        if not apply:
            self.stdout.write(self.style.WARNING("dry-run：加 --apply 真正执行删除"))
            return

        with transaction.atomic():
            # 1. 删除无效叶子节点
            CourseCategory.objects.filter(id__in=node_ids).delete()
            # 2. 死节点收敛：从被删节点的父级向上清理空壳目录
            #    结构保护：顶级分类/学院是导航骨架，即使空壳也不收敛（见 _is_protected_structural）
            parent_ids = set(n.parent_id for n in nodes if n.parent_id)
            converged = []
            seen = set()
            stack = list(parent_ids)
            while stack:
                pid = stack.pop()
                if pid is None or pid in seen:
                    continue
                seen.add(pid)
                try:
                    n = CourseCategory.objects.get(id=pid)
                except CourseCategory.DoesNotExist:
                    continue
                if _is_protected_structural(n):
                    continue
                if not _is_dead_node(n):
                    continue
                converged.append(n)
                stack.append(n.parent_id)
            for n in converged:
                n.delete()
            # 3. 删除孤立占位 Course
            Course.objects.filter(id__in=[c.id for c in orphans]).delete()

        # CourseCategory post_delete 信号已清 COURSE_TREE_CACHE_KEY（models.py 信号）
        self.stdout.write(self.style.SUCCESS(
            f"完成：删除无效节点 {len(nodes)} 个，收敛死节点父级 {len(converged)} 个，"
            f"删除孤立课程 {len(orphans)} 个"
        ))
        self.stdout.write(self.style.SUCCESS("课程树缓存已随 post_delete 信号自动失效"))
