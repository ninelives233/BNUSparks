"""根据北师大学号编码为存量用户补齐身份标签。

默认仅处理已激活账号、仅补空字段，不覆盖用户自行填写的身份。
先运行 ``--dry-run`` 查看统计；确认后使用 ``--apply`` 写入数据库。
"""

import re

from django.core.management.base import BaseCommand
from django.contrib.auth.models import User

from ...models import UserProfile


COLLEGE_BY_CODE = {
    "010": "教育学部",
    "011": "统计学院",
    "021": "新闻传播学院",
    "030": "经济与工商管理学院",
    "031": "哲学学院",
    "040": "法学院",
    "041": "社会学院",
    "050": "马克思主义学院",
    "051": "地理科学学部",
    "061": "心理学部",
    "070": "体育与运动学院",
    "080": "文学院",
    "081": "人工智能学院",
    "100": "外国语言文学学院",
    "101": "物理与天文学院",
    "110": "艺术与传媒学院",
    "120": "历史学院",
    "130": "数学科学学院",
    "150": "化学学院",
    "180": "环境学院",
    "200": "生命科学学院",
    "260": "政府管理学院",
}

SID_RE = re.compile(r"^(?P<century>20)(?P<year>\d{2})(?P<category>\d{2})(?P<college>\d{3})(?P<serial>\d{3})$")


def infer_labels(username):
    """返回 (education, college, major, reason)，无法解析时返回 None。"""
    sid = (username or "").split("@", 1)[0]
    match = SID_RE.fullmatch(sid)
    if not match:
        return None

    category = match.group("category")
    if category == "61":
        education = UserProfile.EducationLevel.UNDERGRADUATE
    elif category == "62":
        education = UserProfile.EducationLevel.MASTER
    elif category.startswith("1"):
        education = UserProfile.EducationLevel.UNDERGRADUATE
    elif category.startswith("2"):
        education = UserProfile.EducationLevel.MASTER
    elif category.startswith("3"):
        education = UserProfile.EducationLevel.DOCTOR
    else:
        # 编码存在但培养层次无法从规则确定，使用合法的“其他”兜底。
        education = UserProfile.EducationLevel.OTHER

    college_code = match.group("college")
    college = COLLEGE_BY_CODE.get(college_code, "其他")
    # 学号只提供院系代码，无法可靠推断具体专业；“其他”表示未知而非清空。
    major = "其他"
    reason = "已匹配院系代码" if college_code in COLLEGE_BY_CODE else "院系代码未收录，使用其他"
    return education, college, major, reason


class Command(BaseCommand):
    help = "根据 12 位学号编码为已激活用户补齐培养层次、学院和专业标签"

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument(
            "--apply", action="store_true",
            help="实际写入数据库；不提供时仅预览",
        )
        mode.add_argument(
            "--dry-run", action="store_true",
            help="显式预览，不修改数据库（默认行为）",
        )
        parser.add_argument(
            "--include-inactive", action="store_true",
            help="同时处理尚未激活的邮箱账号（默认跳过）",
        )
        parser.add_argument(
            "--limit", type=int, default=0,
            help="仅处理前 N 个账号，0 表示不限制（用于小范围演练）",
        )

    def handle(self, *args, **options):
        queryset = User.objects.all().select_related("profile").order_by("id")
        if not options["include_inactive"]:
            queryset = queryset.filter(is_active=True)
        if options["limit"] > 0:
            queryset = queryset[:options["limit"]]

        stats = {
            "scanned": 0,
            "matched": 0,
            "changed": 0,
            "complete": 0,
            "skipped_existing": 0,
            "conflicts": 0,
        }
        education_counts = {}
        college_counts = {}
        previews = []

        for user in queryset:
            stats["scanned"] += 1
            inferred = infer_labels(user.username)
            if inferred is None:
                continue
            stats["matched"] += 1
            education, college, major, reason = inferred
            try:
                profile = user.profile
            except UserProfile.DoesNotExist:
                profile = UserProfile.objects.create(user=user, role=UserProfile.Role.USER)

            before = {
                "identity_education": profile.identity_education or "",
                "identity_college": profile.identity_college or "",
                "identity_major": profile.identity_major or "",
            }
            expected = {
                "identity_education": education,
                "identity_college": college,
                "identity_major": major,
            }
            update_fields = [field for field, value in expected.items() if not before[field]]
            conflicts = [
                field for field, value in expected.items()
                if before[field] and before[field] != value
            ]
            if conflicts:
                stats["conflicts"] += 1
            if update_fields:
                stats["changed"] += 1
                if options["apply"]:
                    for field in update_fields:
                        setattr(profile, field, expected[field])
                    profile.save(update_fields=update_fields)
            else:
                stats["skipped_existing"] += 1
            final = {field: (before[field] or expected[field]) for field in expected}
            if all(final.values()):
                stats["complete"] += 1
            education_counts[final["identity_education"]] = education_counts.get(final["identity_education"], 0) + 1
            college_counts[final["identity_college"]] = college_counts.get(final["identity_college"], 0) + 1
            if len(previews) < 12 and (update_fields or conflicts):
                previews.append((user.username, final, reason, conflicts))

        mode = "已写入" if options["apply"] else "预览"
        self.stdout.write(self.style.SUCCESS(f"[{mode}] 扫描 {stats['scanned']} 个账号，匹配 {stats['matched']} 个数字学号"))
        self.stdout.write(
            f"将补齐/已补齐 {stats['complete']} 个，{'实际变更' if options['apply'] else '预计变更'} {stats['changed']} 个，"
            f"已有完整标签跳过 {stats['skipped_existing']} 个，字段冲突保留原值 {stats['conflicts']} 个。"
        )
        self.stdout.write("培养层次分布：" + ("、".join(f"{key} {value}" for key, value in sorted(education_counts.items())) or "无"))
        self.stdout.write("学院分布：" + ("、".join(f"{key} {value}" for key, value in sorted(college_counts.items())) or "无"))
        if previews:
            self.stdout.write("示例（最多 12 条，仅展示学号与标签结果）：")
            for username, labels, reason, conflicts in previews:
                conflict_note = f"；冲突字段：{','.join(conflicts)}" if conflicts else ""
                self.stdout.write(
                    f"  {username} → {labels['identity_education']} / {labels['identity_college']} / {labels['identity_major']}"
                    f"（{reason}{conflict_note}）"
                )
        if not options["apply"]:
            self.stdout.write(self.style.WARNING("当前为预览模式，未修改数据库；确认后追加 --apply。"))
