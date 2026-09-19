"""后门：从培养方案数据按需导入课程

数据来源：data/major_course_map.json

用法：
  python3 manage.py import_pyfa --list-colleges       # 列出所有学院
  python3 manage.py import_pyfa --list-programs        # 列出所有培养方案
  python3 manage.py import_pyfa --college 哲学学院     # 导入某学院的全部课程
  python3 manage.py import_pyfa --major 080901         # 导入指定专业代码
  python3 manage.py import_pyfa --program "计算机"     # 按方案名搜索导入
  python3 manage.py import_pyfa --id <uuid>            # 按方案ID直接导入
  python3 manage.py import_pyfa --preview --college 文  # 预览（不真正导入）
  python3 manage.py import_pyfa --all                  # 导入全部（慎用！）
"""
import json
from pathlib import Path
from collections import Counter

from django.core.management.base import BaseCommand, CommandError
from materials.models import College, Course


DATA_FILE = Path("data/major_course_map.json")


def load_data():
    if not DATA_FILE.exists():
        raise CommandError(f"数据文件不存在：{DATA_FILE}")
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


class Command(BaseCommand):
    help = "从培养方案 JSON 数据按需导入课程"

    def add_arguments(self, parser):
        parser.add_argument("--list-colleges", action="store_true", help="列出所有学院")
        parser.add_argument("--list-programs", action="store_true", help="列出所有培养方案")
        parser.add_argument("--college", type=str, default="", help="按学院名导入（模糊匹配）")
        parser.add_argument("--major", type=str, default="", help="按专业代码导入")
        parser.add_argument("--program", type=str, default="", help="按方案名搜索导入")
        parser.add_argument("--id", type=str, default="", dest="prog_id", help="按方案UUID导入")
        parser.add_argument("--all", action="store_true", help="导入全部（慎用！）")
        parser.add_argument("--preview", action="store_true", help="仅预览，不实际导入")

    def handle(self, *args, **options):
        data = load_data()

        # ── 列出学院 ──
        if options["list_colleges"]:
            self.stdout.write("\n=== 学院列表 ===")
            for name, info in sorted(data["colleges"].items(), key=lambda x: -x[1]["program_count"]):
                self.stdout.write(f"  {name:20s}  {info['program_count']} 个方案")
            self.stdout.write(f"\n共 {len(data['colleges'])} 个学院，{len(data['programs'])} 个方案")
            return

        # ── 列出方案 ──
        if options["list_programs"]:
            self.stdout.write(f"\n=== 培养方案列表（共 {len(data['programs'])} 个）===")
            by_college = {}
            for pid, prog in data["programs"].items():
                col = prog.get("college", "未知")
                by_college.setdefault(col, []).append((pid, prog))
            for col in sorted(by_college):
                self.stdout.write(f"\n  【{col}】")
                for pid, prog in sorted(by_college[col], key=lambda x: x[1].get("major_name", "")):
                    cc = len(data["program_courses"].get(pid, []))
                    self.stdout.write(f"    {prog['name'][:70]:70s} | {prog.get('major_name',''):12s} | {cc:3d}门课")
            return

        # ── 搜索匹配 ──
        matched = []
        if options["college"]:
            for pid, prog in data["programs"].items():
                if options["college"] in prog.get("college", ""):
                    matched.append(pid)
        if options["major"]:
            for pid, prog in data["programs"].items():
                if options["major"] in prog.get("major_code", ""):
                    matched.append(pid)
        if options["program"]:
            for pid, prog in data["programs"].items():
                if options["program"] in prog.get("name", ""):
                    matched.append(pid)
        if options["prog_id"]:
            if options["prog_id"] in data["programs"]:
                matched.append(options["prog_id"])
            else:
                self.stderr.write(f"方案ID {options['prog_id']} 不存在")
        if options["all"]:
            matched = list(data["programs"].keys())

        matched = list(set(matched))
        if not matched:
            self.stdout.write("未匹配到任何方案。试试 --list-programs 或 --list-colleges")
            return

        # ── 预览/统计 ──
        matched.sort()
        self.stdout.write(f"\n匹配到 {len(matched)} 个培养方案：")
        all_codes = set()
        for pid in matched:
            prog = data["programs"][pid]
            cc = len(data["program_courses"].get(pid, []))
            self.stdout.write(f"  [{pid[:8]}..] {prog['name'][:60]} | {cc:3d}门课")
            for c in data["program_courses"].get(pid, []):
                if c.get("course_code"):
                    all_codes.add(c["course_code"])

        self.stdout.write(f"\n将会影响 {len(all_codes)} 门课程（跨方案去重后）")
        self.stdout.write(f"当前数据库已有 {Course.objects.count()} 门课程")

        if options["preview"]:
            self.stdout.write("\n✅ 预览模式，未做任何更改。去掉 --preview 执行导入。")
            return

        if not options["all"]:
            answer = input(f"\n确定导入以上 {len(matched)} 个方案？(y/N) ")
            if answer.lower() != "y":
                self.stdout.write("已取消。")
                return

        # ── 执行导入 ──
        stats = {"created": 0, "updated": 0, "skipped": 0}
        new_colleges = set()

        for pid in matched:
            prog = data["programs"][pid]
            college_name = prog.get("college", "")
            college = None
            if college_name:
                new_colleges.add(college_name)
                college, _ = College.objects.get_or_create(
                    name=college_name,
                    defaults={"short_name": college_name[:4], "slug": f"clg-{college_name[:10]}", "order": 0},
                )

            for c in data["program_courses"].get(pid, []):
                code = c.get("course_code", "")
                name = (c.get("name", "") or "").strip() or "未命名课程"
                if not code or not name:
                    stats["skipped"] += 1
                    continue

                module = c.get("module", "")
                category = c.get("category", "")
                is_general = "通识" in (module or "") or "通识" in (category or "")

                try:
                    course_obj, created = Course.objects.update_or_create(
                        code=code,
                        defaults={
                            "name": name,
                            "course_type": "general" if is_general else "major",
                            "college": college if not is_general else None,
                        },
                    )
                    if created:
                        stats["created"] += 1
                    else:
                        stats["updated"] += 1
                except Exception:
                    stats["skipped"] += 1

        self.stdout.write("\n" + "=" * 50)
        self.stdout.write("✅ 导入完成！")
        self.stdout.write(f"  新建课程:  {stats['created']}")
        self.stdout.write(f"  更新课程:  {stats['updated']}")
        self.stdout.write(f"  跳过:      {stats['skipped']}")
        self.stdout.write(f"  新建学院:  {len(new_colleges)}")
        self.stdout.write(f"  数据库总计: {College.objects.count()} 个学院, {Course.objects.count()} 门课程")
        if new_colleges:
            self.stdout.write("\n新建学院：")
            for name in sorted(new_colleges):
                cnt = Course.objects.filter(college__name=name).count()
                self.stdout.write(f"  {name}: {cnt} 门课")
