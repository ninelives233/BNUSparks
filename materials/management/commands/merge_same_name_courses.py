"""回填存量「同名同位不同码」重复课程（v=185 同名合并显示功能的一次性梳理）。

课程树中同一父目录下，常因不同用户用不同课程代码申请同一门课，出现
「名称相同、代码不同」的重复课程文件夹。本命令把它们标记为合并显示：

- 每组取最早创建（id 最小）的课程为主课程；
- 其余课程置 merged_into = 主课程（别名课程，资料目录跟随主课程）；
- 汇总通报：总管理员收全量摘要，辖区小版主/版主收各自辖区内的摘要
  （合并本身免审核，通报供事后复核拆分）。

幂等：已指向同一主课程的别名跳过；重复执行不产生重复标记。
安全依据：merged_into 只改展示与解析归属，不删行、不动文件，
误合并可随时把 merged_into 置回 NULL 拆开。

用法：python manage.py merge_same_name_courses            # 预览（dry-run）
      python manage.py merge_same_name_courses --apply    # 写入并通报
"""

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.db import transaction

from ...models import Course, CourseCategory, Notification, UserProfile


def _norm(name):
    s = (name or "").strip().lower()
    for a, b in (("（", "("), ("）", ")"), ("：", ":"), ("，", ","), ("；", ";"),
                 ("【", "["), ("】", "]")):
        s = s.replace(a, b)
    return "".join(s.split())


def _follow(course):
    seen = set()
    while course is not None and course.merged_into_id and course.merged_into_id not in seen:
        seen.add(course.id)
        course = course.merged_into
    return course


class Command(BaseCommand):
    help = "扫描课程树，将同一父目录下同名不同码的课程标记为合并显示（默认 dry-run，--apply 写入并通报管理员）"

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="实际写入合并标记并发送通报（默认仅预览）")

    def handle(self, *args, **opts):
        leaves = list(
            CourseCategory.objects
            .filter(parent__isnull=False, course__isnull=False)
            .select_related("course", "course__merged_into", "parent")
        )
        by_parent = {}
        for leaf in leaves:
            by_parent.setdefault(leaf.parent_id, []).append(leaf)

        pairs = []  # (leaf, alias_course, primary_course)
        for group_leaves in by_parent.values():
            groups = {}
            for leaf in group_leaves:
                primary = _follow(leaf.course)
                if primary is None:
                    continue
                key = _norm(primary.name)
                if not key:
                    continue
                groups.setdefault(key, []).append((leaf, leaf.course, primary))
            for entries in groups.values():
                # 主课程 = 组内最早创建的课程；其余（含历史别名改指）逐一生成合并对。
                # 已指向同一主课程的别名天然被跳过，重复执行幂等。
                primaries = {e[2].id: e[2] for e in entries}
                primary = min(primaries.values(), key=lambda c: c.id)
                for leaf, course, _p in entries:
                    if course.id == primary.id:
                        continue
                    if course.merged_into_id == primary.id:
                        continue
                    pairs.append((leaf, course, primary))

        if not pairs:
            self.stdout.write("未发现同名同位不同码的重复课程。")
            return

        def _path(cat):
            parts = []
            p = cat
            while p:
                parts.append(p.name or f"#{p.id}")
                p = p.parent
            return " / ".join(reversed(parts))

        for leaf, course, primary in pairs:
            note = ""
            if course.merged_into_id and course.merged_into_id != primary.id:
                note = f"（当前已指向 #{course.merged_into_id}，将被改指）"
            self.stdout.write(
                f"{_path(leaf.parent)}  |  {course.name} [{course.code}] → 合并至 "
                f"{primary.name} [{primary.code}]{note}"
            )

        if not opts["apply"]:
            self.stdout.write(self.style.WARNING(
                f"\n共 {len(pairs)} 组待合并（dry-run，未写入）。确认后加 --apply 执行。"))
            return

        # leaf.parent_id → pair 行索引，供辖区过滤
        pairs_by_parent = {}
        for idx, (leaf, _c, _p) in enumerate(pairs):
            pairs_by_parent.setdefault(leaf.parent_id, []).append(idx)

        notified = {}  # user_id → [pair 行文本]
        with transaction.atomic():
            for idx, (leaf, course, primary) in enumerate(pairs):
                course.merged_into = primary
                course.save(update_fields=["merged_into"])
                line = (f"「{course.name}」[{course.code}] → 合并至 "
                        f"「{primary.name}」[{primary.code}]，位置：{_path(leaf.parent)}")
                cat_ids = set()
                p = leaf.parent
                while p:
                    cat_ids.add(p.id)
                    p = p.parent
                for sm in UserProfile.objects.filter(
                    role=UserProfile.Role.SUB_MODERATOR
                ).prefetch_related("moderated_sections"):
                    if cat_ids & set(sm.moderated_sections.values_list("id", flat=True)):
                        notified.setdefault(sm.user_id, []).append(line)
                if primary.college_id:
                    for m in UserProfile.objects.filter(
                        role=UserProfile.Role.MODERATOR,
                        managed_majors=primary.college_id,
                    ):
                        notified.setdefault(m.user_id, []).append(line)
                if primary.course_type == "general":
                    for m in UserProfile.objects.filter(
                        role=UserProfile.Role.MODERATOR, can_moderate_general=True
                    ):
                        notified.setdefault(m.user_id, []).append(line)
            for sa in UserProfile.objects.filter(role=UserProfile.Role.SUPER_ADMIN):
                notified.setdefault(sa.user_id, []).extend(
                    f"「{c.name}」[{c.code}] → 合并至「{p.name}」[{p.code}]，位置：{_path(l.parent)}"
                    for l, c, p in pairs
                )

        sent = 0
        for uid, lines in notified.items():
            recipient = User.objects.filter(id=uid).first()
            if recipient is None or not lines:
                continue
            shown = lines[:30]
            tail = f"\n……等共 {len(lines)} 组" if len(lines) > 30 else ""
            Notification.objects.create(
                recipient=recipient,
                type=Notification.Type.MERGE_ALERT,
                title=f"同名课程合并梳理完成（{len(lines)} 组，请复核）",
                message=(
                    "系统已将课程树中同名同位不同码的重复课程标记为合并显示"
                    "（同一资料目录，资料不迁移），以下为本辖区/全站摘要：\n"
                    + "\n".join(shown) + tail
                    + "\n若合并有误，可在管理台将对应课程的 merged_into 置回空即可拆开。"
                ),
            )
            sent += 1

        self.stdout.write(self.style.SUCCESS(
            f"已合并 {len(pairs)} 组；通报已发送给 {sent} 位管理员。"))
