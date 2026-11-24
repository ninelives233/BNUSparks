import json
import tempfile
from io import StringIO
from pathlib import Path

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from materials.models import College, Course, CourseCategory, Material
from materials.services.course_codes import placeholder_code
from materials.services.course_tree_importer import ImportConflict, import_course_tree
from materials.tests.helpers import (
    create_category,
    create_college,
    create_course,
    create_material,
    create_user,
)


class CourseTreeImporterTests(TestCase):
    def write_tree(self, tree):
        temporary = tempfile.NamedTemporaryFile(mode="w", suffix=".json", encoding="utf-8", delete=False)
        self.addCleanup(Path(temporary.name).unlink, missing_ok=True)
        with temporary:
            json.dump(tree, temporary, ensure_ascii=False)
        return temporary.name

    def run_import(self, tree, *options):
        output = StringIO()
        call_command("import_course_tree", self.write_tree(tree), *options, stdout=output)
        return json.loads(output.getvalue()) if "--json" in options else output.getvalue()

    def test_dry_run_preview_does_not_write(self):
        tree = {
            "colleges": [{"name": "测试学院", "slug": "test-college"}],
            "folders": [
                {"path": ["专业课", "测试学院", "硕士"], "education_level": "硕士"},
                {"path": ["专业课", "测试学院", "博士"], "education_level": "博士"},
            ],
            "courses": [
                {"path": ["专业课", "测试学院", "硕士"], "name": "课程甲", "code": "A001", "course_type": "major", "college": "测试学院"},
                {"path": ["专业课", "测试学院", "博士"], "name": "课程乙", "code": "B001", "course_type": "major", "college": "测试学院"},
            ],
        }
        preview = self.run_import(tree, "--dry-run", "--json")
        self.assertEqual(preview["mode"], "dry-run")
        actions = {(item["action"], tuple(item["path"])) for item in preview["actions"]}
        for level, name in (("硕士", "课程甲"), ("博士", "课程乙")):
            self.assertIn(("CREATE_FOLDER", ("专业课", "测试学院", level)), actions)
            self.assertIn(("CREATE_COURSE", ("专业课", "测试学院", level, name)), actions)
            self.assertIn(("CREATE_LEAF", ("专业课", "测试学院", level, name)), actions)
        for model in (College, CourseCategory, Course, Material):
            self.assertEqual(model.objects.count(), 0)

    def test_apply_idempotent_and_placeholder_isolation(self):
        tree = {
            "colleges": [{"name": "测试学院", "slug": "test-college"}],
            "folders": [
                {"path": ["专业课", "测试学院", "硕士"], "education_level": "硕士"},
                {"path": ["专业课", "测试学院", "博士"], "education_level": "博士"},
            ],
            "courses": [
                {"path": ["专业课", "测试学院", level], "name": name, "course_type": "major", "college": "测试学院", "allow_placeholder": True}
                for level, name in (("硕士", "硕士课程"), ("博士", "博士课程"))
            ],
        }
        self.run_import(tree, "--apply", "--json")
        college = College.objects.get(name="测试学院")
        codes = []
        for level, name in (("硕士", "硕士课程"), ("博士", "博士课程")):
            course = Course.objects.get(name=name)
            self.assertEqual(course.code, placeholder_code(college.pk, name, education=level))
            self.assertTrue(course.code.startswith("BNUX"))
            codes.append(course.code)
        self.assertNotEqual(*codes)
        course_ids = set(Course.objects.values_list("pk", flat=True))
        category_ids = set(CourseCategory.objects.values_list("pk", flat=True))
        second = self.run_import(tree, "--apply", "--json")
        self.assertEqual(course_ids, set(Course.objects.values_list("pk", flat=True)))
        self.assertEqual(category_ids, set(CourseCategory.objects.values_list("pk", flat=True)))
        self.assertTrue(second["actions"])
        self.assertTrue(all(item["action"].startswith("KEEP_") or item["action"] == "REUSE_COURSE" for item in second["actions"]))

    def test_adopt_placeholder_and_cross_level_allowlist(self):
        college = create_college(name="测试学院", slug="test-college")
        root = create_category(name="专业课")
        college_node = create_category(name=college.name, parent=root)
        master = create_category(name="硕士", parent=college_node)
        master.education_level = "硕士"
        master.save(update_fields=["education_level"])
        old_code = placeholder_code(college.pk, "硕士课程", education="硕士")
        course = create_course(code=old_code, name="硕士课程", college=college, course_type="major")
        leaf = create_category(name=course.name, parent=master, course=course)
        material = create_material(course=course, uploader=create_user())
        original_path = material.file_path
        tree = {"courses": [{
            "path": ["专业课", "测试学院", "硕士"], "name": course.name,
            "code": "ECON2001", "course_type": "major", "college": college.name,
            "adopt_placeholder": True,
        }]}
        result = import_course_tree(tree, apply=True)
        self.assertIn("ADOPT_CODE", result["summary"])
        course.refresh_from_db()
        material.refresh_from_db()
        leaf.refresh_from_db()
        self.assertEqual(course.code, "ECON2001")
        self.assertEqual(material.course_id, course.pk)
        self.assertEqual(material.file_path, original_path)
        self.assertEqual(leaf.course_id, course.pk)
        self.assertEqual(Course.objects.get(code=old_code).merged_into_id, course.pk)

        undergraduate = create_category(name="本科", parent=college_node)
        undergraduate.education_level = "本科"
        undergraduate.save(update_fields=["education_level"])
        shared = create_course(code="ECON1001", name="本科课程", college=college, course_type="major")
        original_leaf = create_category(name=shared.name, parent=undergraduate, course=shared)
        original_material = create_material(course=shared, uploader=material.uploader)
        shared_path = original_material.file_path
        cross_tree = {
            "folders": [{"path": ["专业课", "测试学院", "跨层硕士"], "education_level": "硕士"}],
            "courses": [{"path": ["专业课", "测试学院", "跨层硕士"], "name": shared.name,
                         "code": shared.code, "course_type": "major", "college": college.name}],
        }
        with self.assertRaises(ImportConflict):
            import_course_tree(cross_tree, apply=True)
        self.assertFalse(CourseCategory.objects.filter(parent=college_node, name="跨层硕士").exists())
        cross_tree["cross_level_allowlist"] = [{
            "code": shared.code, "allowed_levels": ["本科", "硕士"], "expected_name": shared.name,
            "allowed_paths": [["专业课", "测试学院", "跨层硕士", shared.name]],
        }]
        rejected_tree = {
            "folders": cross_tree["folders"] + [{"path": ["专业课", "测试学院", "未授权硕士"], "education_level": "硕士"}],
            "courses": cross_tree["courses"] + [{**cross_tree["courses"][0], "path": ["专业课", "测试学院", "未授权硕士"]}],
            "cross_level_allowlist": cross_tree["cross_level_allowlist"],
        }
        with self.assertRaises(ImportConflict):
            import_course_tree(rejected_tree, apply=True)
        self.assertFalse(CourseCategory.objects.filter(parent=college_node, name__in=["跨层硕士", "未授权硕士"]).exists())
        result = import_course_tree(cross_tree, apply=True)
        self.assertEqual(result["summary"].get("CROSS_LEVEL_LINK"), 1)
        cross_master = CourseCategory.objects.get(parent=college_node, name="跨层硕士")
        self.assertTrue(CourseCategory.objects.filter(parent=cross_master, name=shared.name, course=shared).exists())
        original_leaf.refresh_from_db()
        original_material.refresh_from_db()
        self.assertEqual(original_leaf.course_id, shared.pk)
        self.assertEqual(original_material.course_id, shared.pk)
        self.assertEqual(original_material.file_path, shared_path)

    def test_cross_level_allowed_path_prefix(self):
        college = create_college(name="测试学院", slug="test-college")
        root = create_category(name="专业课")
        college_node = create_category(name=college.name, parent=root)
        undergraduate = create_category(name="本科", parent=college_node)
        undergraduate.education_level = "本科"
        undergraduate.save(update_fields=["education_level"])
        shared = create_course(code="SHARED101", name="共享课程", college=college, course_type="major")
        create_category(name=shared.name, parent=undergraduate, course=shared)
        tree = {
            "folders": [{"path": ["专业课", college.name, "硕士"], "education_level": "硕士"}],
            "courses": [{"path": ["专业课", college.name, "硕士", "方向"], "name": shared.name,
                         "code": shared.code, "course_type": "major", "college": college.name}],
            "cross_level_allowlist": [{"code": shared.code, "allowed_paths": [["专业课", college.name, "硕士"]]}],
        }
        result = import_course_tree(tree, apply=True)
        self.assertEqual(result["summary"].get("CROSS_LEVEL_LINK"), 1)

    def test_duplicate_folders_are_disambiguated_by_level(self):
        college = create_college(name="测试学院", slug="test-college")
        root = create_category(name="专业课")
        college_node = create_category(name=college.name, parent=root)
        undergraduate = create_category(name="哲学", parent=college_node)
        master = create_category(name="哲学", parent=college_node)
        master.education_level = "硕士"
        master.save(update_fields=["education_level"])
        path = ["专业课", college.name, "哲学"]
        course = {"path": path, "name": "逻辑学", "course_type": "major", "college": college.name,
                  "code": "LOGIC101"}
        tree = {"folders": [{"path": path, "education_level": "硕士"}], "courses": [course]}
        import_course_tree(tree, apply=True)
        self.assertTrue(CourseCategory.objects.filter(parent=master, name="逻辑学").exists())
        self.assertFalse(CourseCategory.objects.filter(parent=undergraduate).exists())
        undergraduate.refresh_from_db()
        self.assertEqual(undergraduate.education_level, "")
        with self.assertRaises(ImportConflict):
            import_course_tree({"courses": [course]})
        import_course_tree({"courses": [{**course, "education_level": "硕士"}]})
        duplicate = create_category(name="哲学", parent=college_node)
        duplicate.education_level = "硕士"
        duplicate.save(update_fields=["education_level"])
        with self.assertRaises(ImportConflict):
            import_course_tree(tree)

    def test_same_name_courses_are_isolated_by_level(self):
        college = create_college(name="测试学院", slug="test-college")
        root = create_category(name="专业课")
        college_node = create_category(name=college.name, parent=root)
        undergraduate = create_category(name="本科", parent=college_node)
        original = create_course(code="REAL101", name="逻辑学", college=college, course_type="major")
        create_category(name=original.name, parent=undergraduate, course=original)
        levels = ("硕士", "博士")
        tree = {
            "folders": [{"path": ["专业课", college.name, level], "education_level": level} for level in levels],
            "courses": [{"path": ["专业课", college.name, level], "name": original.name,
                         "course_type": "major", "college": college.name, "allow_placeholder": True}
                        for level in levels],
        }
        self.run_import(tree, "--apply", "--json")
        ids = set(Course.objects.filter(name=original.name).values_list("pk", flat=True))
        self.assertEqual(len(ids), 3)
        for level in levels:
            code = placeholder_code(college.pk, original.name, education=level)
            self.assertTrue(code.startswith("BNUX"))
            self.assertTrue(Course.objects.filter(name=original.name, code=code).exists())
        category_ids = set(CourseCategory.objects.values_list("pk", flat=True))
        self.run_import(tree, "--apply", "--json")
        self.assertEqual(ids, set(Course.objects.filter(name=original.name).values_list("pk", flat=True)))
        self.assertEqual(category_ids, set(CourseCategory.objects.values_list("pk", flat=True)))
        conflict = {**tree["courses"][0], "path": ["专业课", college.name, "硕士", "其他"], "code": "OTHER101"}
        # 占位码候选不参与真码行的并存判断：真码行与占位同名课允许并存
        import_course_tree({"courses": [conflict]}, apply=True)
        self.assertTrue(Course.objects.filter(code="OTHER101", name=original.name).exists())
        master_code = placeholder_code(college.pk, original.name, education="硕士")
        master = Course.objects.get(code=master_code)
        adopt = {**tree["courses"][0], "code": "MASTER101", "adopt_placeholder": True}
        import_course_tree({"courses": [adopt]}, apply=True)
        master.refresh_from_db()
        self.assertEqual(master.code, "MASTER101")
        self.assertTrue(Course.objects.filter(code=placeholder_code(college.pk, original.name, education="博士")).exists())

    def test_placeholder_row_coexists_with_real_code_same_name(self):
        college = create_college(name="测试学院", slug="test-college")
        root = create_category(name="专业课")
        create_category(name=college.name, parent=root)
        tree = {
            "folders": [
                {"path": ["专业课", college.name, "电子信息"], "education_level": "硕士"},
                {"path": ["专业课", college.name, "电子信息", "计算机技术"]},
                {"path": ["专业课", college.name, "电子信息", "人工智能"]},
                {"path": ["专业课", college.name, "电子信息", "计算机技术", "学位基础课"]},
                {"path": ["专业课", college.name, "电子信息", "人工智能", "学位基础课"]},
            ],
            "courses": [
                {"path": ["专业课", college.name, "电子信息", "计算机技术", "学位基础课"],
                 "name": "数字图像处理", "course_type": "major", "college": college.name,
                 "code": "SAI22063001"},
                {"path": ["专业课", college.name, "电子信息", "人工智能", "学位基础课"],
                 "name": "数字图像处理", "course_type": "major", "college": college.name,
                 "allow_placeholder": True},
            ],
        }
        result = self.run_import(tree, "--apply", "--json")
        self.assertEqual(result["summary"].get("CREATE_PLACEHOLDER_VARIANT"), 1)
        codes = set(Course.objects.filter(name="数字图像处理").values_list("code", flat=True))
        self.assertEqual(len(codes), 2)
        self.assertIn("SAI22063001", codes)
        self.assertIn(placeholder_code(college.pk, "数字图像处理", education="硕士"), codes)
        category_ids = set(CourseCategory.objects.values_list("pk", flat=True))
        second = self.run_import(tree, "--apply", "--json")
        self.assertEqual(category_ids, set(CourseCategory.objects.values_list("pk", flat=True)))
        self.assertTrue(all(
            item["action"].startswith("KEEP_") or item["action"] == "REUSE_COURSE"
            for item in second["actions"]))

    def test_same_major_real_code_conflict_still_blocked(self):
        college = create_college(name="测试学院", slug="test-college")
        root = create_category(name="专业课")
        create_category(name=college.name, parent=root)
        tree = {
            "folders": [
                {"path": ["专业课", college.name, "电子信息"], "education_level": "硕士"},
                {"path": ["专业课", college.name, "电子信息", "计算机技术"]},
                {"path": ["专业课", college.name, "电子信息", "人工智能"]},
                {"path": ["专业课", college.name, "电子信息", "计算机技术", "学位基础课"]},
                {"path": ["专业课", college.name, "电子信息", "人工智能", "学位基础课"]},
            ],
            "courses": [
                {"path": ["专业课", college.name, "电子信息", "计算机技术", "学位基础课"],
                 "name": "算法设计", "course_type": "major", "college": college.name,
                 "code": "SAI2001"},
                {"path": ["专业课", college.name, "电子信息", "人工智能", "学位基础课"],
                 "name": "算法设计", "course_type": "major", "college": college.name,
                 "code": "SAI2002"},
            ],
        }
        with self.assertRaises(ImportConflict):
            import_course_tree(tree, apply=True)
        self.assertFalse(Course.objects.filter(name="算法设计").exists())

    def test_cross_major_real_variant_allowed(self):
        college = create_college(name="测试学院", slug="test-college")
        root = create_category(name="专业课")
        create_category(name=college.name, parent=root)
        tree = {
            "folders": [
                {"path": ["专业课", college.name, "智能科学与技术"], "education_level": "硕士"},
                {"path": ["专业课", college.name, "智能科学与技术", "学位基础课"]},
                {"path": ["专业课", college.name, "电子信息"], "education_level": "硕士"},
                {"path": ["专业课", college.name, "电子信息", "学位基础课"]},
            ],
            "courses": [
                {"path": ["专业课", college.name, "智能科学与技术", "学位基础课"],
                 "name": "机器学习", "course_type": "major", "college": college.name,
                 "code": "AIC2001"},
                {"path": ["专业课", college.name, "电子信息", "学位基础课"],
                 "name": "机器学习", "course_type": "major", "college": college.name,
                 "code": "SAI2003"},
            ],
        }
        result = self.run_import(tree, "--apply", "--json")
        self.assertEqual(result["summary"].get("CREATE_CROSS_MAJOR_VARIANT"), 1)
        self.assertEqual(Course.objects.filter(name="机器学习").count(), 2)

    def test_orphan_real_candidate_is_not_auto_merged(self):
        college = create_college(name="测试学院", slug="test-college")
        root = create_category(name="专业课")
        create_category(name=college.name, parent=root)
        orphan = create_course(code="ORPHAN01", name="孤儿同名课", college=college, course_type="major")
        real_tree = {
            "folders": [{"path": ["专业课", college.name, "某专业"], "education_level": "硕士"}],
            "courses": [
                {"path": ["专业课", college.name, "某专业", "学位基础课"],
                 "name": "孤儿同名课", "course_type": "major", "college": college.name,
                 "code": "NEW9001"},
            ],
        }
        with self.assertRaises(ImportConflict):
            import_course_tree(real_tree, apply=True)
        orphan.refresh_from_db()
        self.assertIsNone(orphan.merged_into_id)
        self.assertFalse(Course.objects.filter(code="NEW9001").exists())

        placeholder_tree = {
            "folders": [{"path": ["专业课", college.name, "某专业"], "education_level": "硕士"}],
            "courses": [
                {"path": ["专业课", college.name, "某专业", "学位基础课"],
                 "name": "孤儿同名课", "course_type": "major", "college": college.name,
                 "allow_placeholder": True},
            ],
        }
        result = self.run_import(placeholder_tree, "--apply", "--json")
        self.assertEqual(result["summary"].get("CREATE_PLACEHOLDER_VARIANT"), 1)
        self.assertIsNone(result["summary"].get("MERGE_ORPHAN_COURSE"))
        orphan.refresh_from_db()
        self.assertIsNone(orphan.merged_into_id)
        self.assertEqual(Course.objects.filter(name="孤儿同名课", merged_into_id__isnull=True).count(), 2)

    def test_conflict_rolls_back_whole_batch(self):
        college = create_college(name="测试学院", slug="test-college")
        create_course(code="DUPLICATE", name="已有课程", college=college, course_type="major")
        tree = {"courses": [
            {"path": ["专业课", "测试学院", "新目录"], "name": "新课程", "code": "NEW1001", "course_type": "major", "college": college.name},
            {"path": ["专业课", "测试学院", "冲突目录"], "name": "冲突课程", "code": "DUPLICATE", "course_type": "major", "college": college.name},
        ]}
        with self.assertRaises(CommandError):
            call_command("import_course_tree", self.write_tree(tree), "--apply")
        self.assertFalse(Course.objects.filter(code="NEW1001").exists())
        self.assertFalse(CourseCategory.objects.filter(name__in=["专业课", "新目录", "冲突目录"]).exists())
