"""搜索 v2（独立搜索结果页）回归。

覆盖实施方案 §13.1：
- 版本分发：v1 结构与上传选课兼容；未支持版本 400；v2 方法校验；
  空词零结果结构、超长词、无效筛选 400。
- 课程：超过旧候选/展示上限后的真实计数与分页、跨页无重复漏项、越界页归末页；
  精确/归一化代码、别名代码、合并链、多目录挂载、目录重命名、
  同名不同 ID、同码未合并、零资料课程、孤儿课程排除。
- 计数口径：多路径/别名不乘大公开资料数；待审/驳回资料不进公开搜索或计数；
  孤立公开资料按原名称回退且可打开。
- 资料：标题/教师/描述匹配、命中字段、类型与格式区分、筛选前后计数、排序并列稳定。
- 问答：只搜公开内容、回答命中与选中回答、同题多回答只返回一次、
  标签 level 校验与合法无匹配组合、默认/最新排序、摘要计数与分页一致。
- 注入类关键词不造成 500；查询数量不随结果行线性增长。

运行：
  bash materials/tests/run_tests.sh materials.tests.test_search_v2
"""

from django.contrib.auth.models import User
from django.db import connection, reset_queries
from django.test.utils import CaptureQueriesContext

from materials.models import (
    College,
    Course,
    CourseCategory,
    Material,
    MaterialType,
    QaAnswer,
    QaQuestion,
    QaTag,
)

from .helpers import BnuTestCase, create_user

SYNTHETIC = "v2s_"  # 测试账号合成前缀（2099 口径的合成身份，不对应真实用户）


class SearchV2Base(BnuTestCase):
    """公共夹具：学院 / 课程树 / 资料 / 问答基线。"""

    def setUp(self):
        super().setUp()
        self.college = College.objects.create(name="搜索学院", slug="search-v2")
        self.general_college = College.objects.create(name="通识学院", slug="search-v2-gen")
        self.mt_notes = MaterialType.objects.create(name="笔记", slug="notes")
        self.mt_exam = MaterialType.objects.create(name="真题", slug="exam")

    def make_tree(self, segments, course=None, course_text=""):
        """按 segments 逐级建目录；最后一级挂 course（或 course_text）。"""
        parent = None
        for name in segments[:-1]:
            parent = CourseCategory.objects.create(name=name, parent=parent)
        return CourseCategory.objects.create(
            name=segments[-1], parent=parent, course=course, course_text=course_text)

    def make_course(self, code, name, college=None, course_type="major"):
        return Course.objects.create(
            code=code, name=name, college=college, course_type=course_type)

    def make_material(self, course, title, uploader=None, review_status="approved",
                      teacher="", description="", file_type="pdf",
                      material_type=None, download_count=0):
        uploader = uploader or self.user
        return Material.objects.create(
            course=course, title=title, teacher=teacher, description=description,
            file_name=f"v2-{title}.txt", file_path=f"v2/{title}.txt",
            file_size=128, file_type=file_type, uploader=uploader,
            uploader_name=uploader.first_name, review_status=review_status,
            is_approved=review_status == "approved",
            material_type=material_type, download_count=download_count,
        )


class SearchV2ContractTest(SearchV2Base):
    """版本分发、参数校验与 v1 兼容。"""

    def test_v1_structure_unchanged_for_upload_picker(self):
        """无 v 参数：旧结构 {courses, materials}（上传选课与旧测试依赖）。"""
        course = self.make_course("V1C100", "版本兼容课", self.college)
        self.make_tree(["专业课", "搜索学院", "专业一", course.name], course=course)
        self.make_material(course, "版本兼容资料", description="版本兼容描述")
        resp = self.client.get("/api/search/", data={"q": "版本兼容"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()["data"]
        self.assertIn("courses", data)
        self.assertIn("materials", data)
        self.assertEqual(data["courses"][0]["code"], "V1C100")
        self.assertEqual(data["materials"][0]["title"], "版本兼容资料")
        # v=1 显式等价于无 v
        resp1 = self.client.get("/api/search/", data={"q": "版本兼容", "v": "1"})
        self.assertEqual(resp1.status_code, 200)
        self.assertEqual(resp1.json()["data"]["courses"][0]["code"], "V1C100")

    def test_v2_unsupported_version_rejected(self):
        self.assertEqual(
            self.client.get("/api/search/", {"q": "任意", "v": "3"}).status_code, 400)
        self.assertEqual(
            self.client.get("/api/qa/search/", {"q": "任意", "v": "9"}).status_code, 400)

    def test_v2_requires_get(self):
        for path in ("/api/search/?v=2&type=course&q=x",
                     "/api/qa/search/?v=2&q=x"):
            self.assertEqual(self.client.post(path).status_code, 405)

    def test_v2_invalid_params(self):
        cases = [
            ("/api/search/?v=2&type=all&q=x", 400),          # v2 只接受 course|material
            ("/api/search/?v=2&type=course&q=x&page=0", 400),
            ("/api/search/?v=2&type=course&q=x&page=abc", 400),
            ("/api/search/?v=2&type=course&q=x&page_size=51", 400),
            ("/api/search/?v=2&type=course&q=x&sort=weird", 400),
            ("/api/search/?v=2&type=course&q=x&course_type=odd", 400),
            ("/api/search/?v=2&type=course&q=x&college=notint", 400),
            ("/api/search/?v=2&type=material&q=x&material_type=999", 400),
            ("/api/search/?v=2&type=course&q=" + "长" * 201, 400),
            ("/api/qa/search/?v=2&q=x&pageSize=0", 400),
            ("/api/qa/search/?v=2&q=x&sort=heat", 400),      # v2 问答不加相关度/热度
        ]
        for path, expected in cases:
            resp = self.client.get(path)
            self.assertEqual(resp.status_code, expected, path)
            self.assertFalse(resp.json()["ok"], path)

    def test_v2_empty_keyword_zero_structure(self):
        for path, type_ in (("/api/search/?v=2&type=course&q=", "course"),
                            ("/api/search/?v=2&type=material&q=", "material"),
                            ("/api/qa/search/?v=2&q=", "qa")):
            resp = self.client.get(path)
            self.assertEqual(resp.status_code, 200, path)
            data = resp.json()["data"]
            self.assertEqual(data["type"], type_)
            self.assertEqual(data["keyword_total"], 0)
            self.assertEqual(data["total"], 0)
            self.assertEqual(data["page"], 1)
            self.assertEqual(data["items"], [])

    def test_v2_envelope_fields(self):
        course = self.make_course("V2E100", "信封课程", self.college)
        self.make_tree(["专业课", "搜索学院", "专业一", course.name], course=course)
        resp = self.client.get("/api/search/?v=2&type=course&q=信封")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()["data"]
        for key in ("query", "type", "keyword_total", "total", "page", "page_size",
                    "total_pages", "has_more", "sort", "items", "facets"):
            self.assertIn(key, data)
        self.assertEqual(data["query"], "信封")
        self.assertEqual(data["type"], "course")
        self.assertEqual(data["keyword_total"], data["total"])
        self.assertFalse(data["has_more"])


class SearchV2CourseTest(SearchV2Base):
    """课程组：身份收敛、计数、排序与目录语义。"""

    def setUp(self):
        super().setUp()
        self.root = CourseCategory.objects.create(name="专业课")

    def mount(self, college_name, major_name, course, leaf_name=None):
        col_cat, _ = CourseCategory.objects.get_or_create(
            name=college_name, parent=self.root, defaults={})
        major_cat, _ = CourseCategory.objects.get_or_create(
            name=major_name, parent=col_cat, defaults={})
        return CourseCategory.objects.create(
            name=leaf_name or course.name, parent=major_cat, course=course)

    def test_exact_and_normalized_code(self):
        course = self.make_course("v2-norm-100", "归一化课", self.college)
        self.mount("搜索学院", "专业一", course)
        for kw in ("v2-norm-100", "V2NORM100", "V2-NORM-100"):
            data = self.client.get(
                "/api/search/", {"v": 2, "type": "course", "q": kw}).json()["data"]
            self.assertEqual(data["total"], 1, kw)
            item = data["items"][0]
            self.assertEqual(item["code"], "v2-norm-100")
            self.assertIn("code", item["matched_fields"])

    def test_alias_code_hits_root_and_codes_listed(self):
        root = self.make_course("V2ROOT01", "合并主课", self.college)
        alias = Course.objects.create(
            code="V2ALIAS1", name="合并主课别名", college=self.college,
            course_type="major", merged_into=root)
        self.mount("搜索学院", "专业一", root)
        self.mount("搜索学院", "专业一", alias, leaf_name="别名挂载")
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "course", "q": "V2ALIAS1"}).json()["data"]
        self.assertEqual(data["total"], 1)
        item = data["items"][0]
        self.assertEqual(item["id"], root.id)
        self.assertEqual(item["codes"], ["V2ROOT01", "V2ALIAS1"])
        self.assertIn("code", item["matched_fields"])

    def test_merge_chain_resolves_to_root(self):
        root = self.make_course("V2CHAIN1", "链主课", self.college)
        mid = Course.objects.create(
            code="V2CHAINM", name="链中课", college=self.college,
            course_type="major", merged_into=root)
        Course.objects.create(
            code="V2CHAINA", name="链尾课", college=self.college,
            course_type="major", merged_into=mid)
        self.mount("搜索学院", "专业一", root)
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "course", "q": "V2CHAINA"}).json()["data"]
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["id"], root.id)

    def test_multi_directory_paths_and_single_row(self):
        course = self.make_course("V2MULTI1", "多目录课", self.college)
        self.mount("搜索学院", "专业一", course)
        self.mount("搜索学院", "专业二", course)
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "course", "q": "多目录"}).json()["data"]
        self.assertEqual(data["total"], 1)
        paths = data["items"][0]["paths"]
        self.assertEqual(len(paths), 2)
        seg_sets = {tuple(p["segments"]) for p in paths}
        self.assertIn(("专业课", "搜索学院", "专业一", "多目录课"), seg_sets)
        self.assertIn(("专业课", "搜索学院", "专业二", "多目录课"), seg_sets)

    def test_directory_rename_display_name(self):
        """重命名目录只改 CourseCategory.name：按新显示名可搜到，名称用树名。"""
        course = self.make_course("V2RENA01", "旧课程名", self.college)
        self.mount("搜索学院", "专业一", course, leaf_name="目录新名称")
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "course", "q": "目录新名称"}).json()["data"]
        self.assertEqual(data["total"], 1)
        item = data["items"][0]
        self.assertEqual(item["name"], "目录新名称")
        self.assertIn("name", item["matched_fields"])

    def test_same_name_unmerged_rows_kept_separate(self):
        c1 = self.make_course("V2SAME01", "同名不同课", self.college)
        c2 = self.make_course("V2SAME02", "同名不同课", self.college)
        self.mount("搜索学院", "专业一", c1)
        self.mount("搜索学院", "专业二", c2)
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "course", "q": "同名不同课"}).json()["data"]
        self.assertEqual(data["total"], 2)
        self.assertEqual({i["id"] for i in data["items"]}, {c1.id, c2.id})

    def test_same_code_unmerged_kept_separate(self):
        """同码遗留行不能仅因代码相等被误判为别名。"""
        c1 = self.make_course("V2DUPCODE", "同码遗留一", self.college)
        c2 = self.make_course("V2DUPCODE", "同码遗留二", self.college)
        self.mount("搜索学院", "专业一", c1)
        self.mount("搜索学院", "专业二", c2)
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "course", "q": "V2DUPCODE"}).json()["data"]
        self.assertEqual(data["total"], 2)
        self.assertEqual({i["id"] for i in data["items"]}, {c1.id, c2.id})

    def test_orphan_course_excluded(self):
        orphan = self.make_course("V2ORPH01", "孤儿课程", self.college)
        mounted = self.make_course("V2ORPH02", "在树课程", self.college)
        self.mount("搜索学院", "专业一", mounted)
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "course", "q": "V2ORPH"}).json()["data"]
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["id"], mounted.id)
        self.assertFalse(CourseCategory.objects.filter(course=orphan).exists())

    def test_zero_material_course_listed(self):
        course = self.make_course("V2ZERO01", "零资料课", self.college)
        self.mount("搜索学院", "专业一", course)
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "course", "q": "零资料"}).json()["data"]
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["approved_material_count"], 0)

    def test_count_not_multiplied_and_pending_excluded(self):
        course = self.make_course("V2COUNT1", "计数课", self.college)
        alias = Course.objects.create(
            code="V2COUNTA", name="计数课别名", college=self.college,
            course_type="major", merged_into=course)
        self.mount("搜索学院", "专业一", course)
        self.mount("搜索学院", "专业二", course)
        self.mount("搜索学院", "专业一", alias, leaf_name="别名挂载")
        self.make_material(course, "计数资料一", material_type=self.mt_notes)
        self.make_material(course, "计数资料二", material_type=self.mt_notes)
        self.make_material(alias, "挂在别名行的资料", material_type=self.mt_notes)
        self.make_material(course, "待审资料", review_status="pending")
        self.make_material(course, "驳回资料", review_status="rejected")
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "course", "q": "计数"}).json()["data"]
        item = data["items"][0]
        # 3 份批准资料只计一次，不随 3 个挂载点/别名乘大；待审/驳回不计
        self.assertEqual(item["approved_material_count"], 3)

    def test_course_type_and_college_filters(self):
        major = self.make_course("V2FTLMJ1", "筛选专业课", self.college)
        general = self.make_course("V2FTLGN1", "筛选通识课", None, course_type="general")
        other = self.make_course("V2FTLOH1", "筛选他院课", self.general_college)
        self.mount("搜索学院", "专业一", major)
        self.make_tree(["通识课", "通识分类", general.name], course=general)
        self.mount("通识学院", "专业一", other)
        base = {"v": 2, "type": "course", "q": "筛选"}
        data = self.client.get("/api/search/", base).json()["data"]
        self.assertEqual(data["keyword_total"], 3)
        data = self.client.get(
            "/api/search/", dict(base, course_type="major")).json()["data"]
        self.assertEqual(data["total"], 2)
        self.assertEqual({i["id"] for i in data["items"]}, {major.id, other.id})
        self.assertEqual(data["keyword_total"], 3, "keyword_total 不含附加筛选")
        data = self.client.get(
            "/api/search/", dict(base, college=self.college.id)).json()["data"]
        self.assertEqual({i["id"] for i in data["items"]}, {major.id})
        # 通识 + 学院组合：400
        resp = self.client.get(
            "/api/search/", dict(base, course_type="general", college=self.college.id))
        self.assertEqual(resp.status_code, 400)
        # facets：按未附加筛选集合生成（专业课与外院课都有学院；通识课无学院不入列）
        facets = self.client.get("/api/search/", base).json()["data"]["facets"]
        self.assertEqual({c["id"] for c in facets["colleges"]},
                         {self.college.id, self.general_college.id})

    def test_relevance_tiers(self):
        exact_code = self.make_course("V2REL001", "普通课程甲", self.college)
        name_exact = self.make_course("V2REL099", "相关课", self.college)
        prefix = self.make_course("V2RELX99", "相关课延伸", self.college)
        contains = self.make_course("V2REL777", " discuss 相关课内容", self.college)
        self.mount("搜索学院", "专业一", exact_code, leaf_name="无关名字甲")
        self.mount("搜索学院", "专业一", name_exact)
        self.mount("搜索学院", "专业一", prefix)
        self.mount("搜索学院", "专业一", contains)
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "course", "q": "V2REL001"}).json()["data"]
        self.assertEqual(data["items"][0]["id"], exact_code.id, "代码精确匹配应排最前")
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "course", "q": "相关课",
                             "sort": "name"}).json()["data"]
        names = [i["name"] for i in data["items"]]
        self.assertEqual(names, sorted(names), "名称排序按显示名")

    def test_pagination_and_page_clamp(self):
        courses = []
        for idx in range(25):
            course = self.make_course(f"V2PAGE{idx:03d}", f"分页课程{idx:02d}", self.college)
            self.mount("搜索学院", "专业一", course)
            courses.append(course)
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "course", "q": "分页课程"}).json()["data"]
        self.assertEqual(data["keyword_total"], 25)
        self.assertEqual(data["total"], 25)
        self.assertEqual(data["total_pages"], 2)
        self.assertTrue(data["has_more"])
        page1 = data["items"]
        data2 = self.client.get(
            "/api/search/", {"v": 2, "type": "course", "q": "分页课程", "page": 2}).json()["data"]
        ids = [i["id"] for i in page1] + [i["id"] for i in data2["items"]]
        self.assertEqual(len(ids), len(set(ids)), "跨页不得重复")
        self.assertEqual(set(ids), {c.id for c in courses}, "跨页不得漏项")
        self.assertFalse(data2["has_more"])
        # 越界页归末页
        data9 = self.client.get(
            "/api/search/", {"v": 2, "type": "course", "q": "分页课程", "page": 9}).json()["data"]
        self.assertEqual(data9["page"], 2)
        self.assertEqual(len(data9["items"]), 5)


class SearchV2MaterialTest(SearchV2Base):
    """资料组：命中字段、筛选、排序、孤立资料。"""

    def setUp(self):
        super().setUp()
        self.course = self.make_course("V2MAT001", "资料课程", self.college)
        self.make_tree(["专业课", "搜索学院", "专业一", self.course.name], course=self.course)

    def test_title_teacher_description_match_fields(self):
        self.make_material(self.course, "线性代数讲义", teacher="王老师",
                           description="覆盖行列式与矩阵", material_type=self.mt_notes)
        self.make_material(self.course, "普通资料甲", teacher="线性代数教师")
        self.make_material(self.course, "普通资料乙", description="线性代数补充阅读")
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "material", "q": "线性代数"}).json()["data"]
        self.assertEqual(data["keyword_total"], 3)
        by_title = {i["title"]: i for i in data["items"]}
        self.assertIn("title", by_title["线性代数讲义"]["matched_fields"])
        self.assertIn("teacher", by_title["普通资料甲"]["matched_fields"])
        self.assertIn("description", by_title["普通资料乙"]["matched_fields"])
        # 描述命中才有摘要；标题命中不编造描述摘要
        self.assertTrue(by_title["普通资料乙"]["snippet"])
        self.assertEqual(by_title["线性代数讲义"]["snippet"], "")

    def test_snippet_window(self):
        long_desc = "前言。" + "无关内容" * 40 + "关键词出现在这里。" + "后续" * 40
        self.make_material(self.course, "长描述资料", description=long_desc)
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "material", "q": "关键词出现"}).json()["data"]
        snippet = data["items"][0]["snippet"]
        self.assertIn("关键词出现在这里", snippet)
        self.assertLessEqual(len(snippet), 170)

    def test_type_and_format_distinction(self):
        self.make_material(self.course, "类型格式甲", file_type="PDF",
                           material_type=self.mt_notes)
        self.make_material(self.course, "类型格式乙", file_type="txt",
                           material_type=self.mt_exam)
        base = {"v": 2, "type": "material", "q": "类型格式"}
        data = self.client.get("/api/search/", base).json()["data"]
        self.assertEqual(data["keyword_total"], 2, "keyword_total 不含筛选")
        data = self.client.get(
            "/api/search/", dict(base, material_type=self.mt_notes.id)).json()["data"]
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["material_type"]["slug"], "notes")
        data = self.client.get(
            "/api/search/", dict(base, format="pdf")).json()["data"]
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["file_type"], "pdf")
        facets = self.client.get("/api/search/", base).json()["data"]["facets"]
        self.assertEqual(sorted(facets["file_types"]), ["pdf", "txt"])
        self.assertEqual(
            {t["id"] for t in facets["material_types"]},
            {self.mt_notes.id, self.mt_exam.id})

    def test_course_type_college_filters_and_null_course(self):
        general = self.make_course("V2MATGEN", "资料通识课", None, course_type="general")
        self.make_tree(["通识课", "通识分类", general.name], course=general)
        self.make_material(self.course, "专业资料甲")
        self.make_material(general, "通识资料乙")
        orphan = self.make_material(None, "孤立公开资料", description="无课程关联")
        base = {"v": 2, "type": "material", "q": "资料"}
        data = self.client.get(
            "/api/search/", dict(base, course_type="major")).json()["data"]
        self.assertEqual([i["id"] for i in data["items"]], [  # 孤立资料被筛掉
            i["id"] for i in data["items"] if i["course"]])
        data = self.client.get(
            "/api/search/", dict(base, college=self.college.id)).json()["data"]
        self.assertTrue(all(i["course"] and i["course"]["college_id"] == self.college.id
                            for i in data["items"]))
        # 孤立公开资料：course=null 仍返回，且登录后可按 ID 打开详情
        data = self.client.get("/api/search/", base).json()["data"]
        orphan_item = next(i for i in data["items"] if i["id"] == orphan.id)
        self.assertIsNone(orphan_item["course"])
        self.client.set_token(self.user)
        detail = self.client.get(f"/api/files/{orphan.id}/")
        self.assertEqual(detail.status_code, 200)
        # 课程名按显示名回退：树内课程名与 Course.name 一致时用树名
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "material", "q": "专业资料甲"}).json()["data"]
        self.assertEqual(data["items"][0]["course"]["name"], "资料课程")

    def test_pending_rejected_not_searchable(self):
        self.make_material(self.course, "公开正常资料")
        self.make_material(self.course, "待审不出现资料", review_status="pending")
        self.make_material(self.course, "驳回不出现资料", review_status="rejected")
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "material", "q": "不出现"}).json()["data"]
        self.assertEqual(data["total"], 0)
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "material", "q": "公开正常"}).json()["data"]
        self.assertEqual(data["total"], 1)

    def test_sort_orders_stable(self):
        m1 = self.make_material(self.course, "排序资料甲", download_count=5)
        m2 = self.make_material(self.course, "排序资料乙", download_count=9)
        m3 = self.make_material(self.course, "排序资料丙", download_count=9)
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "material", "q": "排序资料",
                             "sort": "downloads"}).json()["data"]
        ids = [i["id"] for i in data["items"]]
        self.assertEqual(ids[0], max(m2.id, m3.id),
                         "下载并列按 -download_count,-created_at,-id：ID 大者在前")
        self.assertEqual(len(ids), 3)
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "material", "q": "排序资料",
                             "sort": "latest"}).json()["data"]
        latest_ids = [i["id"] for i in data["items"]]
        self.assertEqual(latest_ids[-1], m1.id, "最新上传在（同秒内）ID 倒序末位仍稳定")
        # 相关度：标题精确匹配最前
        self.make_material(self.course, "排序")
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "material", "q": "排序",
                             "sort": "relevance"}).json()["data"]
        self.assertEqual(data["items"][0]["title"], "排序")

    def test_pagination(self):
        for idx in range(55):
            self.make_material(self.course, f"分页资料{idx:03d}")
        data = self.client.get(
            "/api/search/", {"v": 2, "type": "material", "q": "分页资料"}).json()["data"]
        self.assertEqual(data["keyword_total"], 55)
        self.assertEqual(data["total_pages"], 3)
        data3 = self.client.get(
            "/api/search/", {"v": 2, "type": "material", "q": "分页资料",
                             "page": 3}).json()["data"]
        self.assertEqual(data3["page"], 3)
        self.assertEqual(len(data3["items"]), 15)
        data9 = self.client.get(
            "/api/search/", {"v": 2, "type": "material", "q": "分页资料",
                             "page": 9}).json()["data"]
        self.assertEqual(data9["page"], 3, "越界页归末页")


class SearchV2QaTest(SearchV2Base):
    """问答组：公开范围、命中确认、标签校验、排序。"""

    def setUp(self):
        super().setUp()
        self.author = create_user(SYNTHETIC + "qa_author", first_name="问答作者")
        self.tag_l1 = QaTag.objects.create(name="搜索一级", level=1)
        self.tag_l2 = QaTag.objects.create(name="搜索二级", level=2)

    def make_question(self, title, content="正文内容", pinned=False,
                      tag_l1=None, tag_l2=None, status="published", author=None):
        return QaQuestion.objects.create(
            title=title, content=content, author=author or self.author,
            tag_l1=tag_l1 or self.tag_l1, tag_l2=tag_l2 or self.tag_l2,
            is_pinned=pinned, status=status)

    def test_public_content_only(self):
        self.make_question("公开问题检索", content="<p>正文包含目标词</p>")
        self.make_question("待审问题检索", status="pending")
        self.make_question("已删问题检索", status="deleted")
        q = self.make_question("回答承载问题", content="正文无关")
        QaAnswer.objects.create(question=q, author=self.author,
                                content="回答里有目标词", status="published")
        QaAnswer.objects.create(question=q, author=self.author,
                                content="待审回答里的目标词", status="pending")
        data = self.client.get("/api/qa/search/", {"v": 2, "q": "目标词"}).json()["data"]
        self.assertEqual(data["total"], 2)
        by_id = {i["id"]: i for i in data["items"]}
        self.assertEqual(by_id[q.id]["hit"], "answer")
        self.assertIsNotNone(by_id[q.id]["answer_id"])

    def test_plain_text_confirmation_before_count(self):
        """仅 HTML 标签/属性命中的记录不进入计数。"""
        self.make_question("样式命中问题", content="<p style='目标词'>正常文字</p>")
        self.make_question("明文命中问题", content="<p>这里真的有目标词</p>")
        data = self.client.get("/api/qa/search/", {"v": 2, "q": "目标词"}).json()["data"]
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["title"], "明文命中问题")

    def test_answer_selection_prefers_accepted(self):
        q = self.make_question("采纳排序问题", content="正文无关")
        # 先建已采纳（更早、ID 更小），再建较新未采纳：已采纳仍应胜出
        accepted = QaAnswer.objects.create(question=q, author=self.author,
                                           content="已采纳的目标词回答",
                                           is_accepted=True, status="published")
        newer = QaAnswer.objects.create(question=q, author=self.author,
                                        content="较新的目标词回答", status="published")
        self.assertGreater(newer.id, accepted.id, "数据自检：较新回答 ID 更大")
        data = self.client.get(
            "/api/qa/search/", {"v": 2, "q": "目标词回答"}).json()["data"]
        self.assertEqual(data["total"], 1, "同题多回答只返回一次")
        item = data["items"][0]
        self.assertEqual(item["answer_id"], accepted.id, "已采纳优先于较新")

    def test_tag_level_validation_and_legal_empty_combo(self):
        self.make_question("标签问题甲")
        self.assertEqual(
            self.client.get("/api/qa/search/",
                            {"v": 2, "q": "标签问题", "tag_l1": self.tag_l2.id}).status_code,
            400, "tag_l1 必须是 level=1")
        self.assertEqual(
            self.client.get("/api/qa/search/",
                            {"v": 2, "q": "标签问题", "tag_l2": self.tag_l1.id}).status_code,
            400, "tag_l2 必须是 level=2")
        other_l2 = QaTag.objects.create(name="别的二级", level=2)
        data = self.client.get("/api/qa/search/", {
            "v": 2, "q": "标签问题", "tag_l1": self.tag_l1.id,
            "tag_l2": other_l2.id}).json()["data"]
        self.assertEqual(data["total"], 0, "两个合法标签组合无命中是正常零结果")

    def test_sort_default_pinned_latest_time(self):
        new_q = self.make_question("排序问题新")
        old_q = self.make_question("排序问题旧", pinned=True)
        # created_at 同秒：用 id 与 pinned 区分
        data = self.client.get(
            "/api/qa/search/", {"v": 2, "q": "排序问题"}).json()["data"]
        self.assertEqual([i["id"] for i in data["items"]][0], old_q.id,
                         "默认排序置顶优先")
        data = self.client.get(
            "/api/qa/search/", {"v": 2, "q": "排序问题", "sort": "latest"}).json()["data"]
        self.assertEqual(data["items"][0]["id"], new_q.id if new_q.created_at >= old_q.created_at
                         else old_q.id)

    def test_pagination_and_item_shape(self):
        for idx in range(12):
            self.make_question(f"分页问题{idx:02d}")
        data = self.client.get("/api/qa/search/", {"v": 2, "q": "分页问题"}).json()["data"]
        self.assertEqual(data["keyword_total"], 12)
        self.assertEqual(data["total_pages"], 2)
        self.assertEqual(data["type"], "qa")
        item = data["items"][0]
        for key in ("id", "title", "hit", "author", "tag_l1", "tag_l1_id",
                    "tag_l2", "tag_l2_id", "created_at", "snippet", "answer_id"):
            self.assertIn(key, item)
        data2 = self.client.get(
            "/api/qa/search/", {"v": 2, "q": "分页问题", "page": 2}).json()["data"]
        self.assertEqual(len(data2["items"]), 2)
        ids = [i["id"] for i in data["items"]] + [i["id"] for i in data2["items"]]
        self.assertEqual(len(ids), len(set(ids)))

    def test_injection_style_keywords(self):
        self.make_question("引号\"与反斜线\\问题", content="<p>正文中含 (regex.*)[符号]</p>")
        payloads = [
            "<script>alert(1)</script>",
            "' OR 1=1 --",
            '" onmouseover="alert(1)',
            "a%b_c\\d",
            "(.*)[{'\"\\\\",
        ]
        for payload in payloads:
            resp = self.client.get("/api/qa/search/", {"v": 2, "q": payload})
            self.assertEqual(resp.status_code, 200, payload)
            resp = self.client.get(
                "/api/search/", {"v": 2, "type": "course", "q": payload})
            self.assertEqual(resp.status_code, 200, payload)
            resp = self.client.get(
                "/api/search/", {"v": 2, "type": "material", "q": payload})
            self.assertEqual(resp.status_code, 200, payload)


class SearchV2PerformanceTest(SearchV2Base):
    """查询数量不随结果行线性增长（固定拓扑，1 条 vs 40 条结果）。"""

    def _course_query_count(self, keyword):
        with CaptureQueriesContext(connection) as ctx:
            reset_queries()
            self.client.get(
                "/api/search/", {"v": 2, "type": "course", "q": keyword})
            return len(ctx.captured_queries)

    def test_course_queries_constant(self):
        course = self.make_course("V2PERF001", "性能基准课", self.college)
        self.make_tree(["专业课", "搜索学院", "专业一", course.name], course=course)
        small = self._course_query_count("性能基准")
        for idx in range(39):
            extra = self.make_course(f"V2PERF{idx:03d}", f"性能基准课{idx:02d}", self.college)
            CourseCategory.objects.create(
                name=extra.name,
                parent=CourseCategory.objects.get(name="专业一"), course=extra)
        big = self._course_query_count("性能基准")
        self.assertLessEqual(big, small + 2,
                             f"课程搜索查询数不应随结果行增长（{small} → {big}）")

    def test_material_queries_constant(self):
        course = self.make_course("V2PERFM1", "性能资料课", self.college)
        self.make_tree(["专业课", "搜索学院", "专业一", course.name], course=course)
        self.make_material(course, "性能资料基准")
        with CaptureQueriesContext(connection) as ctx:
            reset_queries()
            self.client.get(
                "/api/search/", {"v": 2, "type": "material", "q": "性能资料"})
            small = len(ctx.captured_queries)
        for idx in range(39):
            self.make_material(course, f"性能资料基准{idx:02d}")
        with CaptureQueriesContext(connection) as ctx:
            reset_queries()
            self.client.get(
                "/api/search/", {"v": 2, "type": "material", "q": "性能资料"})
            big = len(ctx.captured_queries)
        self.assertLessEqual(big, small + 2,
                             f"资料搜索查询数不应随结果行增长（{small} → {big}）")

    def test_qa_queries_constant(self):
        author = create_user(SYNTHETIC + "perf_qa", first_name="性能作者")
        q = QaQuestion.objects.create(
            title="性能问题基准", content="正文", author=author,
            tag_l1=self.tag_l1 if hasattr(self, "tag_l1") else QaTag.objects.create(name="性能一级", level=1),
            tag_l2=self.tag_l2 if hasattr(self, "tag_l2") else QaTag.objects.create(name="性能二级", level=2))
        with CaptureQueriesContext(connection) as ctx:
            reset_queries()
            self.client.get("/api/qa/search/", {"v": 2, "q": "性能问题"})
            small = len(ctx.captured_queries)
        for idx in range(39):
            QaQuestion.objects.create(
                title=f"性能问题基准{idx:02d}", content="正文", author=author,
                tag_l1=q.tag_l1, tag_l2=q.tag_l2)
        with CaptureQueriesContext(connection) as ctx:
            reset_queries()
            self.client.get("/api/qa/search/", {"v": 2, "q": "性能问题"})
            big = len(ctx.captured_queries)
        self.assertLessEqual(big, small + 2,
                             f"问答搜索查询数不应随结果行增长（{small} → {big}）")
