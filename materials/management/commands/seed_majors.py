"""建库：专业库（Major）+ 学位点承载学院（College），覆盖北京与珠海两校区。

四步：
1. 补齐学位点承载学院（北京 4 个见 NEW_COLLEGES，珠海 6 个见 ZHUHAI_COLLEGES）；
2. 从课程树「专业课」分支同步北京本科专业（选项口径与前端 fillIdentityMajors 完全一致：
   学院节点下非 divider 且有子节点的父节点）；
3. 按 majors_catalog.ZHUHAI_MAJORS 静态建珠海本科专业（不在北京课程树内；
   文理学院按学院 13 系建制挂 department，供本科下拉按系分组）；
4. 按 GRAD_MAJORS（北京）与 ZHUHAI_MAJORS 硕博段建硕博专业（2026 招生目录核实口径）。

幂等可重跑：目录内条目缺则建；课程树/目录中已消失的本科专业只停用（is_active=False），
不删除。预览模式（默认）零写入；--apply 写入并清空相关 API 缓存。
"""

from django.core.cache import cache
from django.core.management.base import BaseCommand

from ...models import College, CourseCategory, Major
from ...majors_catalog import (
    GRAD_MAJORS, NEW_COLLEGES, ZHUHAI_COLLEGES, ZHUHAI_MAJORS,
)
from ...views.majors import MAJORS_CATALOG_CACHE_KEY

TRACK_LABEL = {"academic": "学硕/学博", "professional": "专硕/专博"}
ZHUHAI_COLLEGE_NAMES = {e["name"] for e in ZHUHAI_COLLEGES}


def _undergrad_majors_from_tree():
    """按前端 fillIdentityMajors 同样的口径从课程树提取 本科专业：{学院名: [专业名]}。

    fillIdentityMajors 只抓「专业课」分支下学院节点的非 divider 父节点（有子目录）。
    """
    nodes = list(CourseCategory.objects.all().values(
        "id", "name", "parent_id", "is_divider",
    ))
    by_parent = {}
    for node in nodes:
        by_parent.setdefault(node["parent_id"], []).append(node)

    def _has_children(node):
        kids = by_parent.get(node["id"], [])
        return any(not kid["is_divider"] for kid in kids)

    roots = {node["name"]: node for node in nodes if node["parent_id"] is None}
    tree_root = roots.get("专业课")
    if not tree_root:
        return {}

    result = {}
    for college_node in by_parent.get(tree_root["id"], []):
        if college_node["is_divider"]:
            continue
        majors = [
            kid["name"] for kid in by_parent.get(college_node["id"], [])
            if not kid["is_divider"] and _has_children(kid)
        ]
        if majors:
            result[college_node["name"]] = majors
    return result


class Command(BaseCommand):
    help = ("建库：补学位点承载学院（京珠）+ 同步北京本科专业（课程树）"
            "+ 珠海本科专业 + 两校区硕博专业目录")

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument("--apply", action="store_true", help="实际写入数据库；不提供时仅预览")
        mode.add_argument("--dry-run", action="store_true", help="显式预览，不修改数据库（默认行为）")

    def handle(self, *args, **options):
        apply_mode = options["apply"]
        stats = {"colleges_created": 0, "undergrad_created": 0, "undergrad_deactivated": 0,
                 "zhuhai_undergrad_created": 0, "grad_created": 0, "missing_college": []}

        colleges_by_name = {c.name: c for c in College.objects.all()}
        catalog_colleges = {e["name"]: e for e in NEW_COLLEGES + ZHUHAI_COLLEGES}

        def _get_college(name):
            """预览时 College 缺失只返回 None；apply 时按目录补建（带校区）。"""
            college = colleges_by_name.get(name)
            entry = catalog_colleges.get(name)
            if college is None and entry is not None:
                if not apply_mode:
                    return None
                campus = (College.Campus.ZHUHAI if name in ZHUHAI_COLLEGE_NAMES
                          else College.Campus.BEIJING)
                college = College.objects.create(
                    name=entry["name"], short_name=entry["short_name"],
                    slug=entry["slug"], order=entry["order"], campus=campus,
                )
                colleges_by_name[name] = college
                stats["colleges_created"] += 1
                self.stdout.write(f"  + 学院 {college.name}（slug={college.slug}，{campus}）")
            return college

        def _get_major(college, name, level, track, code, order, department=""):
            """预览返回 (是否存在, None)；apply 时缺则建。返回 (existed, major)。

            department 仅在目录给出非空值时回填（课程树同步路径不带系，不清洗已有系归属）。
            """
            existing = Major.objects.filter(college=college, name=name, level=level).first()
            if existing:
                if apply_mode and existing.track != track:
                    # 目录调整了学位类型时以目录为准
                    existing.track = track
                    existing.code = existing.code or code
                    existing.save(update_fields=["track", "code"])
                if apply_mode and department and existing.department != department:
                    existing.department = department
                    existing.save(update_fields=["department"])
                return True, existing
            if apply_mode:
                Major.objects.create(
                    college=college, name=name, level=level,
                    track=track, code=code, order=order, department=department,
                )
            return False, None

        # ── 1. 学位点承载学院（预览也要统计将新增数）──
        for entry in NEW_COLLEGES + ZHUHAI_COLLEGES:
            if entry["name"] not in colleges_by_name:
                _get_college(entry["name"])

        # ── 2. 北京本科专业：课程树 → Major（缺则建 + 停用消失项）──
        tree_majors = _undergrad_majors_from_tree()
        if not tree_majors:
            self.stdout.write(self.style.WARNING("课程树「专业课」分支为空，本科专业未同步"))
        seen_undergrad = set()
        for college_name, major_names in tree_majors.items():
            college = _get_college(college_name)
            if college is None:
                stats["missing_college"].append(college_name)
                continue
            for idx, major_name in enumerate(major_names):
                seen_undergrad.add((college.id, major_name))
                existed, existing = _get_major(college, major_name, Major.Level.UNDERGRADUATE, "", "", idx)
                if not existed:
                    stats["undergrad_created"] += 1
                elif not existing.is_active:
                    # 课程树恢复的曾停用专业重新启用
                    if apply_mode:
                        existing.is_active = True
                        existing.save(update_fields=["is_active"])
        if tree_majors:
            stale_ids = [
                m.id for m in Major.objects.filter(level=Major.Level.UNDERGRADUATE, is_active=True)
                .exclude(college__name__in=ZHUHAI_COLLEGE_NAMES)
                if (m.college_id, m.name) not in seen_undergrad
            ]
            stats["undergrad_deactivated"] = len(stale_ids)
            if apply_mode and stale_ids:
                Major.objects.filter(id__in=stale_ids).update(is_active=False)

        # ── 3. 珠海本科专业：静态目录（不在北京课程树内；条目可带所属系）──
        seen_zhuhai_undergrad = set()
        for college_name, major_names in ZHUHAI_MAJORS["本科"]:
            college = _get_college(college_name)
            if college is None:
                stats["missing_college"].append(f"珠海/{college_name}")
                continue
            for idx, entry in enumerate(major_names):
                if isinstance(entry, tuple):
                    major_name, department = entry
                else:
                    major_name, department = entry, ""
                seen_zhuhai_undergrad.add((college.id, major_name))
                existed, existing = _get_major(
                    college, major_name, Major.Level.UNDERGRADUATE, "", "", idx, department)
                if not existed:
                    stats["zhuhai_undergrad_created"] += 1
                elif not existing.is_active and apply_mode:
                    existing.is_active = True
                    existing.save(update_fields=["is_active"])
        stale_zhuhai_ids = [
            m.id for m in Major.objects.filter(level=Major.Level.UNDERGRADUATE, is_active=True)
            .filter(college__name__in=ZHUHAI_COLLEGE_NAMES)
            if (m.college_id, m.name) not in seen_zhuhai_undergrad
        ]
        if apply_mode and stale_zhuhai_ids:
            Major.objects.filter(id__in=stale_zhuhai_ids).update(is_active=False)

        # ── 4. 硕博专业目录（北京 GRAD_MAJORS + 珠海 ZHUHAI_MAJORS）──
        for source, catalog in (("北京", GRAD_MAJORS), ("珠海", {
            level: ZHUHAI_MAJORS.get(level, {}) for level in ("硕士", "博士")
        })):
            for level, tracks in catalog.items():
                for track, college_majors in tracks.items():
                    for idx, (college_name, major_list) in enumerate(college_majors):
                        college = _get_college(college_name)
                        if college is None:
                            stats["missing_college"].append(f"{source}/{college_name}")
                            continue
                        for major_name, code in major_list:
                            existed, _major = _get_major(college, major_name, level, track, code, idx)
                            if not existed:
                                stats["grad_created"] += 1
                                self.stdout.write(
                                    f"  + {level}·{TRACK_LABEL[track]} {college.name} / {major_name}（{code}）"
                                )

        mode = "已写入" if apply_mode else "预览"
        self.stdout.write(self.style.SUCCESS(
            f"[{mode}] 新增学院 {stats['colleges_created']}，"
            f"北京本科专业 +{stats['undergrad_created']} 停用 {stats['undergrad_deactivated']}，"
            f"珠海本科专业 +{stats['zhuhai_undergrad_created']}，硕博专业 +{stats['grad_created']}"
        ))
        if stats["missing_college"]:
            self.stdout.write(self.style.WARNING(
                "以下学院没有 College 记录，专业未建：" + "、".join(sorted(set(stats["missing_college"])))
            ))
        if apply_mode:
            # 学院/专业列表有 600s 缓存，写入后立即失效
            cache.delete("api_colleges_data")
            cache.delete(MAJORS_CATALOG_CACHE_KEY)
        else:
            self.stdout.write(self.style.WARNING("当前为预览模式，未修改数据库；确认后追加 --apply。"))
