"""存量硕博用户专业标签迁移（v259）。

背景：硕博专业建库前，「专业」下拉只有本科培养方案里的专业名，硕博用户
（学号 2xxx/3xxx 类别或手动选择）只能被迫选本科专业名或「其他」。
专业库建成后，把这类用户的专业标签与硕博目录匹配：

1. 精确命中（专业名已在本人学院的目标层次目录中）→ 保留不动；
2. 去括号/双学位前缀后命中（如「心理学（公费师范）」→「心理学」）→ 更新；
3. 别名命中（GRAD_MAJOR_ALIASES：汉语言文学→中国语言文学等）→ 更新；
4. 都不命中 → 置「其他」。

仅调整「专业」；「学院」「培养层次」一律保留原值，匹配限定在用户所选学院内，
不跨学院猜测。直接写库不走 profile 接口，不占每日一次修改额度。
先 --dry-run 预览（默认），确认后 --apply。
"""

import re

from django.core.management.base import BaseCommand
from django.db.models import Q

from ...models import Major, UserProfile
from ...majors_catalog import GRAD_MAJOR_ALIASES

OTHER = "其他"


def _candidate_names(raw):
    """展开一个存量专业名为候选集：原名、去括号注记、双学位「+」前段。"""
    candidates = {raw}
    base = re.split(r"[（(＋+]", raw)[0].strip()
    if base:
        candidates.add(base)
    return candidates


def _match_major(raw, college_name, level):
    """返回 (结果专业, 匹配方式)；匹配方式 ∈ exact/base/alias/none。

    exact 仅指原名已在目录中（保留不动）；去前缀/别名命中都会改写标签。
    """
    catalog = set(
        Major.objects.filter(
            college__name=college_name, level=level, is_active=True,
        ).values_list("name", flat=True)
    )
    if raw in catalog:
        return raw, "exact"
    candidates = _candidate_names(raw)
    for name in candidates:
        if name in catalog:
            return name, "base"
    for name in candidates:
        target = GRAD_MAJOR_ALIASES.get(name)
        if target and target in catalog:
            return target, "alias"
    return None, "none"


class Command(BaseCommand):
    help = "将硕博用户的本科式专业标签与硕博专业目录匹配：命中即更新，否则置「其他」"

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument("--apply", action="store_true", help="实际写入数据库；不提供时仅预览")
        mode.add_argument("--dry-run", action="store_true", help="显式预览，不修改数据库（默认行为）")

    def handle(self, *args, **options):
        apply_mode = options["apply"]
        queryset = UserProfile.objects.exclude(
            Q(identity_education="") | Q(identity_education=UserProfile.EducationLevel.UNDERGRADUATE),
        ).filter(~Q(identity_major="") & ~Q(identity_major=OTHER)).select_related("user")

        stats = {"scanned": 0, "exact": 0, "base": 0, "alias": 0, "to_other": 0}
        previews = []

        for profile in queryset:
            stats["scanned"] += 1
            level = profile.identity_education
            college_name = profile.identity_college
            raw_major = profile.identity_major
            matched, method = _match_major(raw_major, college_name, level)
            if matched is None:
                matched = OTHER
            stats["to_other" if method == "none" else method] += 1

            changed = method != "exact"
            if changed:
                line = (f"  {profile.user.username} [{level}/{college_name}] "
                        f"{raw_major} → {matched}" + ("" if method == "none" else f"（{method}）"))
                if len(previews) < 40:
                    previews.append(line)
                if apply_mode:
                    profile.identity_major = matched
                    profile.save(update_fields=["identity_major"])

        mode = "已写入" if apply_mode else "预览"
        self.stdout.write(self.style.SUCCESS(
            f"[{mode}] 扫描硕博有专业标签用户 {stats['scanned']} 个："
            f"精确保留 {stats['exact']}，前缀归一 {stats['base']}，别名 {stats['alias']}，"
            f"落「其他」{stats['to_other']}"
        ))
        if previews:
            self.stdout.write("变更明细（最多 40 条）：")
            for line in previews:
                self.stdout.write(line)
        if apply_mode:
            from django.core.cache import cache
            from ...views.majors import MAJORS_CATALOG_CACHE_KEY
            cache.delete(MAJORS_CATALOG_CACHE_KEY)
        else:
            self.stdout.write(self.style.WARNING("当前为预览模式，未修改数据库；确认后追加 --apply。"))
