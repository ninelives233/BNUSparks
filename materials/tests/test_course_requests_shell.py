"""v=165 壳节点语义测试：新建课程撞已存在课程

- 提交端：目标位置已有入口 → 引导直接上传；仅存在于别处 → 允许提交（will_link）
- 批准端：复用既有 Course（壳），父节点已有同课程叶子不再重复创建，节点名用权威名
- 管理模式 api_folder_create：同码收敛复用 + 同位置叶子去重
"""
import json

from django.core.files.uploadedfile import SimpleUploadedFile

from .helpers import (
    BnuTestCase, create_user, create_college, create_course,
    create_category, create_material,
)
from ..models import (
    Course, CourseCategory, CourseCreationRequest, Material, Notification,
)


def _build_major_tree():
    """专业课 → 物理学 → 物理学专业 → 专业必修课"""
    college = create_college("物理学", "wlx")
    root = create_category(name="专业课")
    col_node = create_category(name="物理学", parent=root)
    major = create_category(name="物理学专业", parent=col_node)
    req_cat = create_category(name="专业必修课", parent=major)
    return college, root, col_node, major, req_cat


class ShellGuideTest(BnuTestCase):
    """提交端 + 批准端壳语义（申请流）"""

    def setUp(self):
        super().setUp()
        self.college, self.root, self.col_node, self.major, self.req_cat = _build_major_tree()
        self.sub_mod.profile.moderated_sections.add(self.req_cat)
        self.mod.profile.managed_majors.add(self.college)

    def _submit(self, code, **kw):
        data = {
            "course_type": "major",
            "course_name": "理论力学",
            "course_code": code,
            "college_id": self.college.id,
            "target_category_id": self.req_cat.id,
        }
        data.update(kw)
        self.client.set_token(self.user)
        return self.client.post_json("/api/courses/request/", data)

    def test_in_target_guides_to_upload(self):
        """本专业树已有该课程入口 → 提交被引导拦截，不创建申请"""
        existing = create_course(code="PHY210", name="理论力学", college=self.college, course_type="major")
        create_category(name="理论力学", parent=self.req_cat, course=existing)

        resp = self._submit("PHY210")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("已在本专业课程树", resp.json()["error"])
        self.assertFalse(CourseCreationRequest.objects.filter(course_code="PHY210").exists())

    def test_exists_elsewhere_creates_shell(self):
        """仅存在于别的专业树 → 允许提交（will_link），批准后为壳节点，复用既有 Course"""
        existing = create_course(code="PHY210", name="理论力学", college=self.college, course_type="major")
        # 入口在 col_node 下（别的层级），不在 req_cat 下
        create_category(name="理论力学", parent=self.col_node, course=existing)

        resp = self._submit("PHY210")
        self.assertEqual(resp.status_code, 200)
        req_id = resp.json()["data"]["id"]
        self.assertTrue(resp.json()["data"]["will_link"])

        # 随附文件
        self.client.set_token(self.user)
        file = SimpleUploadedFile("n.pdf", b"x", content_type="application/pdf")
        r = self.client.post(
            f"/api/courses/request/{req_id}/files/",
            {"file": file, "title": "笔记"},
            **self.client.defaults,
        )
        mat_id = r.json()["data"]["id"]

        # 批准 → 壳语义
        self.client.set_token(self.sub_mod)
        resp = self.client.post_json(f"/api/moderation/course-requests/{req_id}/approve/")
        self.assertEqual(resp.status_code, 200)

        # Course 不新增、叶子指向既有 Course、随附文件归入既有 Course
        self.assertEqual(Course.objects.filter(code="PHY210").count(), 1)
        leaf = CourseCategory.objects.get(parent=self.req_cat, course=existing)
        self.assertIsNotNone(leaf)
        mat = Material.objects.get(id=mat_id)
        self.assertEqual(mat.course_id, existing.id)

    def test_approve_dedups_leaf_same_parent(self):
        """同 code 同目标的两个申请先后批准 → 父节点下仅一个叶子"""
        existing = create_course(code="PHY210", name="理论力学", college=self.college, course_type="major")
        create_category(name="理论力学", parent=self.col_node, course=existing)

        req1 = self._submit("PHY210").json()["data"]["id"]
        req2 = self._submit("PHY210").json()["data"]["id"]

        self.client.set_token(self.sub_mod)
        self.client.post_json(f"/api/moderation/course-requests/{req1}/approve/")
        self.client.post_json(f"/api/moderation/course-requests/{req2}/approve/")
        self.assertEqual(
            CourseCategory.objects.filter(parent=self.req_cat, course=existing).count(),
            1,
        )

    def test_node_name_uses_canonical_course_name(self):
        """复用场景叶子名用权威 Course.name，而非提交名"""
        existing = create_course(code="PHY210", name="理论力学A", college=self.college, course_type="major")
        create_category(name="理论力学A", parent=self.col_node, course=existing)

        req_id = self._submit("PHY210", course_name="理论力学").json()["data"]["id"]
        self.client.set_token(self.sub_mod)
        self.client.post_json(f"/api/moderation/course-requests/{req_id}/approve/")
        leaf = CourseCategory.objects.get(parent=self.req_cat, course=existing)
        self.assertEqual(leaf.name, "理论力学A")

    def test_resolve_prefers_matching_college(self):
        """同码两学院各一条 → 收敛到学院匹配者（而非最早）"""
        other_college = create_college("化学", "hx")
        # 先建「化学」的（id 更小），再建「物理」的 → 学院匹配仍应选物理
        c_chem = create_course(code="PHY220", name="高数", college=other_college, course_type="major")
        c_phys = create_course(code="PHY220", name="高数", college=self.college, course_type="major")

        req_id = self._submit("PHY220").json()["data"]["id"]
        self.client.set_token(self.sub_mod)
        resp = self.client.post_json(f"/api/moderation/course-requests/{req_id}/approve/")
        self.assertEqual(resp.status_code, 200)
        leaf = CourseCategory.objects.get(parent=self.req_cat)
        self.assertEqual(leaf.course_id, c_phys.id)

    def test_linked_notification(self):
        """linked 场景通知标题/文案含「已链接既有课程」「未新建独立文件夹」"""
        existing = create_course(code="PHY210", name="理论力学", college=self.college, course_type="major")
        create_category(name="理论力学", parent=self.col_node, course=existing)

        req_id = self._submit("PHY210").json()["data"]["id"]
        self.client.set_token(self.sub_mod)
        self.client.post_json(f"/api/moderation/course-requests/{req_id}/approve/")

        notif = Notification.objects.filter(
            recipient=self.user, type="operation"
        ).order_by("-id").first()
        self.assertIsNotNone(notif)
        self.assertIn("已链接", notif.title)
        self.assertIn("未新建独立文件夹", notif.message)

    def test_check_endpoint_reports_locations(self):
        """GET /api/courses/request/check/ 返回 exists/in_target/locations"""
        existing = create_course(code="PHY210", name="理论力学", college=self.college, course_type="major")
        create_category(name="理论力学", parent=self.col_node, course=existing)

        self.client.set_token(self.user)
        # 不在目标下 → in_target False
        resp = self.client.get_json("/api/courses/request/check/", {
            "course_code": "PHY210",
            "target_category_id": self.req_cat.id,
        })
        d = resp.json()["data"]
        self.assertTrue(d["exists"])
        self.assertFalse(d["in_target"])
        self.assertTrue(any("理论力学" in p for p in d["locations"]))

        # 已有入口在目标下 → in_target True
        create_category(name="理论力学", parent=self.req_cat, course=existing)
        resp = self.client.get_json("/api/courses/request/check/", {
            "course_code": "PHY210",
            "target_category_id": self.req_cat.id,
        })
        self.assertTrue(resp.json()["data"]["in_target"])

    def test_will_link_badge_in_moderation_list(self):
        """审核列表 pending 请求带 will_link + existing_course_name"""
        existing = create_course(code="PHY210", name="理论力学", college=self.college, course_type="major")
        create_category(name="理论力学", parent=self.col_node, course=existing)
        req_id = self._submit("PHY210").json()["data"]["id"]

        self.client.set_token(self.sub_mod)
        resp = self.client.get_json("/api/moderation/course-requests/")
        item = [i for i in resp.json()["data"] if i["id"] == req_id][0]
        self.assertTrue(item["will_link"])
        self.assertEqual(item["existing_course_name"], "理论力学")


class ManagementCreateShellTest(BnuTestCase):
    """管理模式 api_folder_create 纳入壳语义"""

    def setUp(self):
        super().setUp()
        self.college, self.root, self.col_node, self.major, self.req_cat = _build_major_tree()

    def _create(self, code, parent_id=None, name="理论力学", course_name="理论力学"):
        self.client.set_token(self.admin)
        return self.client.post_json("/api/folders/create/", {
            "folder_type": "course",
            "parent_id": parent_id or self.req_cat.id,
            "name": name,
            "course_code": code,
            "course_name": course_name,
        })

    def test_management_create_reuses_unique_existing(self):
        """管理模式建课：代码唯一既有 → 复用既有 Course（壳），不新增"""
        existing = create_course(code="PHY300", name="电动力学", college=self.college, course_type="major")
        resp = self._create("PHY300")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(Course.objects.filter(code="PHY300").count(), 1)
        leaf = CourseCategory.objects.get(parent=self.req_cat)
        self.assertEqual(leaf.course_id, existing.id)
        self.assertTrue(resp.json()["data"]["reused"])

    def test_management_create_converges_multiple(self):
        """管理模式建课：同 code 多行 → 不硬报错，收敛到最早一条"""
        c1 = create_course(code="PHY310", name="a", college=self.college, course_type="major")
        create_course(code="PHY310", name="b", college=self.college, course_type="major")
        resp = self._create("PHY310")
        self.assertEqual(resp.status_code, 200, resp.content)
        leaf = CourseCategory.objects.get(parent=self.req_cat)
        self.assertEqual(leaf.course_id, c1.id)

    def test_management_create_dedups_leaf_same_parent(self):
        """管理模式建课：同 code 同位置建两次 → 第二次不重复创建节点"""
        existing = create_course(code="PHY320", name="量子力学", college=self.college, course_type="major")
        resp1 = self._create("PHY320")
        self.assertEqual(resp1.status_code, 200)
        resp2 = self._create("PHY320")
        self.assertEqual(resp2.status_code, 200)
        self.assertIn("已在此位置存在", resp2.json()["data"]["message"])
        self.assertEqual(
            CourseCategory.objects.filter(parent=self.req_cat, course=existing).count(),
            1,
        )
