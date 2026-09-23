"""同名同位不同码自动合并显示（v=185）

- 提交端：目标位置存在同名不同码课程 → 自动合并（免审核），新代码登记为主课程别名
- 通报：申请人收 OPERATION 结果通知；辖区小版主/版主 + 总管理员收 MERGE_ALERT 待复核
- 解析：别名代码的文件列表/上传跟随主课程；树叶子合并展示 courseCodes、隐藏重复叶子
- 搜索：按别名代码检索命中主课程（codes 含全部代码），别名行不单独返回
- 回填：merge_same_name_courses 命令 dry-run/apply
"""
from django.core.management import call_command
from io import StringIO

from .helpers import (
    BnuTestCase, create_user, create_college, create_course,
    create_category, create_material,
)
from ..models import (
    Course, CourseCategory, CourseCreationRequest, Notification,
)


def _build_major_tree():
    """专业课 → 物理学 → 物理学专业 → 专业必修课"""
    college = create_college("物理学", "wlx")
    root = create_category(name="专业课")
    col_node = create_category(name="物理学", parent=root)
    major = create_category(name="物理学专业", parent=col_node)
    req_cat = create_category(name="专业必修课", parent=major)
    return college, root, col_node, major, req_cat


class SameNameMergeTest(BnuTestCase):
    def setUp(self):
        super().setUp()
        self.college, self.root, self.col_node, self.major, self.req_cat = _build_major_tree()
        self.sub_mod.profile.moderated_sections.add(self.req_cat)
        self.mod.profile.managed_majors.add(self.college)
        self.primary = create_course(code="PHY210", name="理论力学",
                                     college=self.college, course_type="major")
        self.leaf = create_category(name="理论力学", parent=self.req_cat, course=self.primary)

    def _submit(self, code, name="理论力学", **kw):
        data = {
            "course_type": "major",
            "course_name": name,
            "course_code": code,
            "college_id": self.college.id,
            "target_category_id": self.req_cat.id,
        }
        data.update(kw)
        self.client.set_token(self.user)
        return self.client.post_json("/api/courses/request/", data)

    def test_same_name_different_code_auto_merges(self):
        """同名同位不同码 → 免审核自动合并：别名登记 + 不新建文件夹"""
        resp = self._submit("PHY210B")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()["data"]
        self.assertTrue(data["merged"])
        self.assertEqual(data["merged_into"], "PHY210")
        self.assertTrue(data["auto_approved"])

        req = CourseCreationRequest.objects.get(course_code="PHY210B")
        self.assertEqual(req.status, CourseCreationRequest.Status.APPROVED)
        self.assertTrue(req.auto_approved)
        self.assertIn("PHY210", req.review_notes)

        alias = Course.objects.get(code="PHY210B")
        self.assertEqual(alias.merged_into_id, self.primary.id)

        # 未新建叶子：目标位置下仍只有主课程一个叶子
        self.assertEqual(
            CourseCategory.objects.filter(parent=self.req_cat, course__isnull=False).count(), 1)

    def test_merge_notifies_requester_and_admins(self):
        resp = self._submit("PHY210B")
        self.assertEqual(resp.status_code, 200)

        self.assertTrue(Notification.objects.filter(
            recipient=self.user, type=Notification.Type.OPERATION,
            title="新课程已与同名课程合并显示").exists())
        # 小版主（管辖板块覆盖）+ 版主（管理该学院）+ 总管理员各收待复核通报
        self.assertTrue(Notification.objects.filter(
            recipient=self.sub_mod, type=Notification.Type.MERGE_ALERT).exists())
        self.assertTrue(Notification.objects.filter(
            recipient=self.mod, type=Notification.Type.MERGE_ALERT).exists())
        self.assertTrue(Notification.objects.filter(
            recipient=self.admin, type=Notification.Type.MERGE_ALERT).exists())
        # 申请人不收 MERGE_ALERT
        self.assertFalse(Notification.objects.filter(
            recipient=self.user, type=Notification.Type.MERGE_ALERT).exists())

    def test_merged_alias_resubmit_guides_to_upload(self):
        """合并后再次提交别名代码 → 命中主课程位置，引导直接上传"""
        self._submit("PHY210B")
        resp = self._submit("PHY210B")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("已在", resp.json()["error"])

    def test_alias_code_resolves_primary_files(self):
        """别名代码的文件列表返回主课程资料"""
        self._submit("PHY210B")
        create_material(course=self.primary, uploader=self.user)
        resp = self.client.get("/api/courses/PHY210B/files/")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertEqual(len(body["data"]), 1)
        self.assertEqual(body["data"][0]["course_code"], "PHY210")

    def test_different_name_still_creates_request(self):
        """不同名 → 不触发合并，走正常申请流"""
        resp = self._submit("PHY220", name="电动力学")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()["data"]
        self.assertNotIn("merged", data)
        self.assertFalse(data["auto_approved"])
        req = CourseCreationRequest.objects.get(course_code="PHY220")
        self.assertEqual(req.status, CourseCreationRequest.Status.PENDING)

    def test_same_name_in_other_position_does_not_merge(self):
        """同名课程只在别的位置 → 不合并，允许提交（壳语义）"""
        other_cat = create_category(name="应用物理班", parent=self.col_node)
        create_category(name="理论力学", parent=other_cat, course=None)
        other = create_course(code="PHY999", name="理论力学",
                              college=self.college, course_type="major")
        create_category(name="理论力学", parent=other_cat, course=other)

        resp = self._submit("PHY999")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["data"]["will_link"])
        self.assertNotIn("merged", resp.json()["data"])


class MergeTreeAndSearchTest(BnuTestCase):
    """树展示 courseCodes / 隐藏重复叶子 / 搜索别名命中"""

    def setUp(self):
        super().setUp()
        self.college, self.root, self.col_node, self.major, self.req_cat = _build_major_tree()
        self.primary = create_course(code="PHY210", name="理论力学",
                                     college=self.college, course_type="major")
        self.alias = create_course(code="PHY210B", name="理论力学",
                                   college=self.college, course_type="major")

    def _tree(self):
        self.client.set_token(self.user)
        resp = self.client.get("/api/courses/tree/")
        return resp.json()["data"]

    def test_alias_leaf_hidden_when_primary_sibling(self):
        """主课程叶子在同层 → 别名叶子不出现，主叶子带 courseCodes"""
        create_category(name="理论力学", parent=self.req_cat, course=self.primary)
        create_category(name="理论力学B", parent=self.req_cat, course=self.alias)
        self.alias.merged_into = self.primary
        self.alias.save(update_fields=["merged_into"])

        tree = self._tree()
        major = tree["专业课"]["children"][0]["children"][0]["children"][0]
        leaves = [c for c in major["children"] if not c.get("divider")]
        self.assertEqual(len(leaves), 1)
        self.assertEqual(leaves[0]["courseId"], "PHY210")
        self.assertIn("PHY210B", leaves[0]["courseCodes"])

    def test_alias_leaf_single_code_when_primary_elsewhere(self):
        """主课程叶子不在别名所在层级 → 别名叶子保留但仅单码展示；
        主叶子（v271 起）任何位置都标注全部别名代码"""
        create_category(name="理论力学B", parent=self.req_cat, course=self.alias)
        other_cat = create_category(name="拔尖班", parent=self.major)
        create_category(name="理论力学", parent=other_cat, course=self.primary)
        self.alias.merged_into = self.primary
        self.alias.save(update_fields=["merged_into"])

        tree = self._tree()
        req_node = tree["专业课"]["children"][0]["children"][0]["children"][0]
        req_leaves = [c for c in req_node["children"] if c.get("courseId")]
        self.assertEqual(len(req_leaves), 1)
        # 别名叶子显示自己的代码，不标注双代码；资料归属仍跟随主课程
        self.assertEqual(req_leaves[0]["courseId"], "PHY210B")
        self.assertNotIn("courseCodes", req_leaves[0])
        # 别处的主课程叶子标注全部代码（资料目录全局跟随主课程，标注不会失真）
        other_leaf = tree["专业课"]["children"][0]["children"][0]["children"][1]["children"][0]
        self.assertEqual(other_leaf["courseId"], "PHY210")
        self.assertEqual(other_leaf["courseCodes"], ["PHY210", "PHY210B"])

    def test_primary_leaf_codes_without_alias_leaf(self):
        """v165 自动合并只建别名 Course、不建别名叶子（线上真实场景）→
        主叶子同样标注全部代码，别名不产生独立叶子"""
        create_category(name="理论力学", parent=self.req_cat, course=self.primary)
        self.alias.merged_into = self.primary
        self.alias.save(update_fields=["merged_into"])

        tree = self._tree()
        req_node = tree["专业课"]["children"][0]["children"][0]["children"][0]
        leaves = [c for c in req_node["children"] if not c.get("divider")]
        self.assertEqual(len(leaves), 1)
        self.assertEqual(leaves[0]["courseId"], "PHY210")
        self.assertEqual(leaves[0]["courseCodes"], ["PHY210", "PHY210B"])

    def test_primary_sibling_hides_alias_elsewhere_alias_single(self):
        """别名叶子同层共现的目录 → 主叶子带双代码并隐藏别名叶子；
        同一别名在别的位置的叶子仍单码展示"""
        create_category(name="理论力学", parent=self.req_cat, course=self.primary)
        create_category(name="理论力学B", parent=self.req_cat, course=self.alias)
        elsewhere = create_category(name="拔尖班", parent=self.major)
        create_category(name="理论力学B", parent=elsewhere, course=self.alias)
        self.alias.merged_into = self.primary
        self.alias.save(update_fields=["merged_into"])

        tree = self._tree()
        req_node = tree["专业课"]["children"][0]["children"][0]["children"][0]
        leaves = [c for c in req_node["children"] if c.get("courseId")]
        self.assertEqual(len(leaves), 1)  # 同层别名叶子被隐藏
        self.assertEqual(leaves[0]["courseId"], "PHY210")
        self.assertEqual(leaves[0]["courseCodes"], ["PHY210", "PHY210B"])
        elsewhere_leaf = tree["专业课"]["children"][0]["children"][0]["children"][1]["children"][0]
        self.assertEqual(elsewhere_leaf["courseId"], "PHY210B")
        self.assertNotIn("courseCodes", elsewhere_leaf)

    def test_search_by_alias_code_hits_primary(self):
        """按别名代码搜索命中主课程，codes 列出全部代码，别名行不单独返回"""
        create_category(name="理论力学", parent=self.req_cat, course=self.primary)
        self.alias.merged_into = self.primary
        self.alias.save(update_fields=["merged_into"])

        self.client.set_token(self.user)
        resp = self.client.get("/api/search/?q=PHY210B")
        courses = resp.json()["data"]["courses"]
        self.assertEqual(len(courses), 1)
        self.assertEqual(courses[0]["code"], "PHY210")
        self.assertEqual(courses[0]["codes"], ["PHY210", "PHY210B"])

    def test_find_existing_course_follows_merge(self):
        from ..views.utils import _find_existing_course
        self.alias.merged_into = self.primary
        self.alias.save(update_fields=["merged_into"])
        self.assertEqual(_find_existing_course("PHY210B").code, "PHY210")


class MergeBackfillCommandTest(BnuTestCase):
    """merge_same_name_courses 回填命令"""

    def setUp(self):
        super().setUp()
        self.college, self.root, self.col_node, self.major, self.req_cat = _build_major_tree()
        self.admin.profile.managed_majors.add(self.college)
        self.primary = create_course(code="PHY210", name="量子力学",
                                     college=self.college, course_type="major")
        create_category(name="量子力学", parent=self.req_cat, course=self.primary)
        self.dup = create_course(code="PHY210X", name="量子力学",
                                 college=self.college, course_type="major")
        create_category(name="量子力学", parent=self.req_cat, course=self.dup)

    def test_dry_run_writes_nothing(self):
        out = StringIO()
        call_command("merge_same_name_courses", stdout=out)
        self.assertIn("量子力学", out.getvalue())
        self.dup.refresh_from_db()
        self.assertIsNone(self.dup.merged_into_id)

    def test_apply_merges_and_notifies(self):
        out = StringIO()
        call_command("merge_same_name_courses", "--apply", stdout=out)
        self.dup.refresh_from_db()
        self.assertEqual(self.dup.merged_into_id, self.primary.id)
        # 总管理员收摘要通报
        self.assertTrue(Notification.objects.filter(
            recipient=self.admin, type=Notification.Type.MERGE_ALERT).exists())
        # 幂等：重复执行不再产生新动作
        out2 = StringIO()
        call_command("merge_same_name_courses", "--apply", stdout=out2)
        self.assertIn("未发现", out2.getvalue())
