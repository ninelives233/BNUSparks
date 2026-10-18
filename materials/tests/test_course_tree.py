"""
课程树构建测试

覆盖：
  - CourseCategory 自引用树形结构递归完整
  - 直接关联 course 的叶子节点
  - code_wildcard 通配符匹配到正确的 Course 集合
  - 分隔线节点标记
"""

from .helpers import (
    BnuTestCase, create_college, create_course, create_category,
    create_material,
)

from ..models import (
    CourseCategory, Course, CourseFavorite, Favorite, Material, Report,
)


class CourseTreeTest(BnuTestCase):
    """课程导航树测试"""

    def setUp(self):
        super().setUp()
        self.college = create_college("数学科学学院", "sxkx")
        # 创建树结构：
        # 通识课
        #   ├─ 语言类：GEN01*** → 大学英语、大学语文
        #   └─ 计通类：GEN02*** → 计算机基础
        # 专业课
        #   └─ 数学：MATH101, MATH102

        self.cat_root_gen = create_category(name="通识课")
        self.cat_root_major = create_category(name="专业课")

        self.cat_lang = create_category(name="语言类", parent=self.cat_root_gen, course_text="GEN01")
        self.cat_comp = create_category(name="计通类", parent=self.cat_root_gen, course_text="GEN02")
        self.cat_math = create_category(name="数学类", parent=self.cat_root_major)

        self.course_english = create_course("GEN0101", "大学英语")
        self.course_chinese = create_course("GEN0102", "大学语文")
        self.course_cs = create_course("GEN0201", "计算机基础")
        self.course_math1 = create_course("MATH101", "数学分析", college=self.college, course_type="major")
        self.course_math2 = create_course("MATH102", "高等代数", college=self.college, course_type="major")

        # 叶子节点直接关联课程
        cat_math_analysis = create_category(name="数学分析", parent=self.cat_math,
            course=self.course_math1)
        cat_math_algebra = create_category(name="高等代数", parent=self.cat_math,
            course=self.course_math2)

        # 分隔线
        self.divider = create_category(name="─── 分隔线 ───", parent=self.cat_root_major)
        self.divider.is_divider = True
        self.divider.save()

    def test_tree_direct_course(self):
        """直接关联的 course 节点应能通过 _get_courses_in_category 找到"""
        from ..views import _get_courses_in_category

        courses_math = _get_courses_in_category(self.cat_math)
        self.assertIn(self.course_math1, courses_math)
        self.assertIn(self.course_math2, courses_math)
        self.assertNotIn(self.course_english, courses_math)

    def test_tree_wildcard(self):
        """通配符 code_wildcard 匹配课程"""
        from ..views import _get_courses_in_category

        courses_lang = _get_courses_in_category(self.cat_lang)
        self.assertIn(self.course_english, courses_lang)
        self.assertIn(self.course_chinese, courses_lang)
        self.assertNotIn(self.course_cs, courses_lang)

    def test_tree_recursion(self):
        """递归获取父分类下所有课程（含子节点）"""
        from ..views import _get_courses_in_category

        # 通识课根节点下应包含语言类 + 计通类全部课程
        all_gen = _get_courses_in_category(self.cat_root_gen)
        self.assertIn(self.course_english, all_gen)
        self.assertIn(self.course_chinese, all_gen)
        self.assertIn(self.course_cs, all_gen)
        self.assertNotIn(self.course_math1, all_gen)

    def test_divider_excluded_from_courses(self):
        """分隔线节点不应产生课程"""
        from ..views import _get_courses_in_category

        divider_courses = _get_courses_in_category(self.divider)
        self.assertEqual(len(divider_courses), 0)

    def test_tree_third_row_marker(self):
        """is_third_row 卡片（国际视野/数学类/实用文件）应在树 JSON 携带 thirdRow 标记"""
        third = create_category(name="国际视野与文明对话", parent=self.cat_root_gen)
        third.is_third_row = True
        third.save()

        self.client.set_token(self.user)
        resp = self.client.get("/api/courses/tree/")
        self.assertEqual(resp.status_code, 200)
        tree = resp.json()["data"]

        def find(nodes, name):
            for n in nodes:
                if n.get("name") == name:
                    return n
                if n.get("children"):
                    hit = find(n["children"], name)
                    if hit:
                        return hit
            return None

        node = find(tree["通识课"]["children"], "国际视野与文明对话")
        self.assertIsNotNone(node, "国际视野与文明对话 应出现在课程树中")
        self.assertTrue(node["thirdRow"], "thirdRow 卡片应带 thirdRow: true 标记")
        self.assertNotIn("thirdRow", find(tree["通识课"]["children"], "语言类"))

    def test_api_tree_returns_valid_structure(self):
        """GET /api/courses/tree/ 返回有效的树形结构"""
        self.client.set_token(self.user)
        resp = self.client.get("/api/courses/tree/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["ok"])

        tree = data["data"]
        # 至少有一个根节点
        self.assertGreater(len(tree), 0)

    def test_tree_file_count_refreshes_on_material_change(self):
        """新增已通过资料后，课程树 fileCount 即时更新（Material 信号失效树缓存）"""
        from .helpers import create_material

        self.client.set_token(self.user)

        def find_course(nodes, code):
            for n in nodes:
                if n.get("courseId") == code:
                    return n
                if n.get("children"):
                    hit = find_course(n["children"], code)
                    if hit:
                        return hit
            return None

        def file_count(tree, code):
            for root in tree.values():
                n = find_course(root.get("children") or [], code)
                if n is not None:
                    return n.get("fileCount", 0)
            return None

        # 首次拉取 → fileCount = 0（空课程）
        r1 = self.client.get("/api/courses/tree/")
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(file_count(r1.json()["data"], "MATH101"), 0)

        # 新增一份已通过资料（触发 Material post_save 信号清缓存）
        create_material(self.course_math1, self.user, review_status="approved")

        # 再次拉取 → fileCount 应立即为 1，无需等 TTL/硬刷新
        r2 = self.client.get("/api/courses/tree/")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(file_count(r2.json()["data"], "MATH101"), 1)

    def test_timetable_summary_returns_requested_counts_only(self):
        """课表摘要接口只返回请求代码，并统计已审核资料。"""
        from .helpers import create_material

        self.client.set_token(self.user)
        create_material(self.course_math1, self.user, review_status="approved")

        response = self.client.get(
            "/api/courses/timetable-summary/?codes=MATH101,MATH102,NO_SUCH,MATH101"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]

        self.assertEqual(data["MATH101"], {
            "exists": True,
            "course_type": "major",
            "file_count": 1,
        })
        self.assertEqual(data["MATH102"]["file_count"], 0)
        self.assertFalse(data["NO_SUCH"]["exists"])
        self.assertEqual(set(data), {"MATH101", "MATH102", "NO_SUCH"})

    def test_tree_nodes_pruned_fields(self):
        """v=134 瘦身：树节点不含前端未使用的 parentId/customBuilt，必要字段仍在"""
        self.client.set_token(self.user)
        resp = self.client.get("/api/courses/tree/")
        self.assertEqual(resp.status_code, 200)
        tree = resp.json()["data"]

        def walk(nodes, path):
            for n in nodes:
                self.assertNotIn("parentId", n, f"节点 {path} 不应含 parentId")
                self.assertNotIn("customBuilt", n, f"节点 {path} 不应含 customBuilt")
                if n.get("divider"):
                    continue  # 分隔线节点只有 {divider: true}
                self.assertIn("id", n, f"节点 {path} 必须含 id")
                if n.get("children"):
                    walk(n["children"], path + [n.get("name") or n.get("id")])

        for root_name, root in tree.items():
            walk(root.get("children") or [], [root_name])


class CourseDisplayNameContractTest(BnuTestCase):
    """课程名展示契约：所有展示端课程名以导航树叶子名为准。

    管理模式重命名只改 CourseCategory.name，不同步 Course.name；
    任何课程名展示位不得直接读 Course.name（或写入时的快照）而不做树名解析。
    """

    def setUp(self):
        super().setUp()
        self.course = create_course(code="DISP001", name="旧课程名")
        self.material = create_material(self.course, self.user, review_status="approved")
        Material.objects.filter(id=self.material.id).update(title="树名契约资料")
        self.material.refresh_from_db()
        # 树：根 → 叶子（改名后的目录名）
        root = create_category(name="根")
        self.leaf = create_category(name="新目录名", parent=root, course=self.course)

    def _get(self, path, user=None):
        if user is not None:
            self.client.set_token(user)
        resp = self.client.get_json(path)
        self.assertEqual(resp.status_code, 200, path)
        return resp.json()["data"]

    def test_courses_list_and_search_follow_tree_name(self):
        courses = self._get("/api/courses/")
        row = next(c for c in courses if c["code"] == "DISP001")
        self.assertEqual(row["name"], "新目录名")

        search = self.client.get_json(
            "/api/search/", data={"q": "DISP001", "type": "course"})
        self.assertEqual(search.status_code, 200)
        course_hit = next(
            c for c in search.json()["data"]["courses"] if c["code"] == "DISP001"
        )
        self.assertEqual(course_hit["name"], "新目录名")

        search = self.client.get_json("/api/search/", data={"q": "树名契约", "type": "material"})
        self.assertEqual(search.status_code, 200)
        material_hit = next(
            m for m in search.json()["data"]["materials"] if m["id"] == self.material.id
        )
        self.assertEqual(material_hit["course_name"], "新目录名")

    def test_course_files_and_file_detail_follow_tree_name(self):
        files = self._get("/api/courses/DISP001/files/")
        self.assertTrue(files)
        self.assertEqual(files[0]["course_name"], "新目录名")

        detail = self._get(f"/api/files/{self.material.id}/", self.user)
        self.assertEqual(detail["course_name"], "新目录名")

    def test_favorites_and_uploads_follow_tree_name(self):
        Favorite.objects.create(user=self.user, material=self.material)
        CourseFavorite.objects.create(user=self.user, course=self.course)
        Material.objects.create(
            course=self.course, title="我的待审上传", teacher="张老师",
            file_name="b.pdf", file_path="DISP001/b.pdf", file_size=1,
            uploader=self.user, uploader_name=self.user.first_name,
            review_status="pending",
        )

        favs = self._get("/api/user/favorites/", self.user)
        self.assertEqual(favs["items"][0]["course_name"], "新目录名")

        course_favs = self._get("/api/user/course-favorites/", self.user)
        self.assertEqual(course_favs["items"][0]["course_name"], "新目录名")

        uploads = self._get("/api/user/uploads/", self.user)
        names = {row["title"]: row["course_name"] for row in uploads}
        self.assertEqual(names["树名契约资料"], "新目录名")
        self.assertEqual(names["我的待审上传"], "新目录名")

        public_page = self._get(f"/api/user/public/{self.user.id}/")
        self.assertEqual(public_page["materials"][0]["course_name"], "新目录名")

    def test_moderation_queues_follow_tree_name(self):
        Material.objects.create(
            course=self.course, title="待审核资料", teacher="张老师",
            file_name="c.pdf", file_path="DISP001/c.pdf", file_size=1,
            uploader=self.user, uploader_name=self.user.first_name,
            review_status="pending",
        )

        pending = self._get("/api/moderation/pending/", self.admin)
        pending_names = {row["title"]: row["course_name"] for row in pending}
        self.assertEqual(pending_names["待审核资料"], "新目录名")

        Material.objects.filter(id=self.material.id).update(review_status="approved")
        history = self._get("/api/moderation/history/", self.admin)
        history_names = {row["title"]: row["course_name"] for row in history["items"]}
        self.assertEqual(history_names["树名契约资料"], "新目录名")

    def test_report_displays_follow_tree_name_with_code_guard(self):
        """举报行显示树名；快照代码与当前课程不一致时保留原快照名。"""
        other_course = create_course(code="DISP002", name="另一门课")
        other_material = create_material(other_course, self.user, review_status="approved")
        Report.objects.create(
            kind=Report.Kind.MATERIAL, material=self.material,
            material_pk=self.material.id, reporter=self.user,
            reporter_name=self.user.first_name, reasons=["spam"],
            course_code=self.course.code, course_name="旧课程名",
        )
        Report.objects.create(
            kind=Report.Kind.MATERIAL, material=other_material,
            material_pk=other_material.id, reporter=self.user,
            reporter_name=self.user.first_name, reasons=["spam"],
            course_code="HIST999", course_name="历史快照名",
        )

        pending = self._get("/api/moderation/reports/pending/", self.admin)
        pending_names = {
            g["course_code"]: g["course_name"]
            for g in pending["material_groups"]
        }
        self.assertEqual(pending_names["DISP001"], "新目录名")
        self.assertEqual(pending_names["HIST999"], "历史快照名")

        history = self._get("/api/moderation/reports/history/", self.admin)
        history_names = {
            r["course_code"]: r["course_name"] for r in history["items"]
        }
        self.assertEqual(history_names["DISP001"], "新目录名")
        self.assertEqual(history_names["HIST999"], "历史快照名")

    def test_course_outside_tree_falls_back_to_course_name(self):
        """未挂树或叶子无名的课程仍显示 Course.name。"""
        orphan = create_course(code="DISP003", name="孤儿课程")
        orphan_material = create_material(orphan, self.user, review_status="approved")
        Material.objects.filter(id=orphan_material.id).update(title="孤儿资料")
        orphan_material.refresh_from_db()

        detail = self._get(f"/api/files/{orphan_material.id}/", self.user)
        self.assertEqual(detail["course_name"], "孤儿课程")

        search = self.client.get_json("/api/search/", data={"q": "孤儿资料", "type": "material"})
        material_hit = next(
            m for m in search.json()["data"]["materials"] if m["id"] == orphan_material.id
        )
        self.assertEqual(material_hit["course_name"], "孤儿课程")
