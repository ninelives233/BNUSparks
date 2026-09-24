"""新建课程申请 API 测试：创建/路由/批准/驳回/卡片消失规则/分段批量"""
import json
from django.core.files.uploadedfile import SimpleUploadedFile

from .helpers import (
    BnuTestCase, create_user, create_college, create_course,
    create_category, create_material,
)
from ..models import (
    Course, CourseCategory, CourseCreationRequest, FolderOperation, Material,
)


def _build_general_tree():
    """通识课 → 大学外语类 → 通用英语进阶"""
    root = create_category(name="通识课")
    gen = create_category(name="大学外语类", parent=root)
    leaf = create_category(name="通用英语进阶", parent=gen,
                           course=create_course(code="GEN02122", name="通用英语进阶", course_type="general"))
    return root, gen, leaf


def _build_major_tree():
    """专业课 → 学院 → 专业 → 专业必修课"""
    college = create_college("物理学", "wlx")
    root = create_category(name="专业课")
    col_node = create_category(name="物理学", parent=root)
    major = create_category(name="物理学专业", parent=col_node)
    req_cat = create_category(name="专业必修课", parent=major)
    return college, root, col_node, major, req_cat


class CourseRequestCreateTest(BnuTestCase):
    def test_general_request_routes_to_general_moderator(self):
        root, gen, leaf = _build_general_tree()
        self.mod.profile.can_moderate_general = True
        self.mod.profile.save()

        self.client.set_token(self.user)
        resp = self.client.post_json("/api/courses/request/", {
            "course_type": "general",
            "course_name": "学术英语写作",
            "course_code": "GEN02199",
            "general_category_id": gen.id,
        })
        self.assertEqual(resp.status_code, 200)
        req = CourseCreationRequest.objects.get(id=resp.json()["data"]["id"])
        self.assertEqual(req.assigned_moderator_id, self.mod.id)
        self.assertEqual(req.status, "pending")

    def test_major_request_routes_to_sub_moderator(self):
        college, root, col_node, major, req_cat = _build_major_tree()
        self.sub_mod.profile.moderated_sections.add(req_cat)
        self.mod.profile.managed_majors.add(college)

        self.client.set_token(self.user)
        resp = self.client.post_json("/api/courses/request/", {
            "course_type": "major",
            "course_name": "理论力学",
            "course_code": "PHY210",
            "college_id": college.id,
            "target_category_id": req_cat.id,
        })
        self.assertEqual(resp.status_code, 200)
        req = CourseCreationRequest.objects.get(id=resp.json()["data"]["id"])
        self.assertEqual(req.assigned_moderator_id, self.sub_mod.id)

    def test_validation(self):
        self.client.set_token(self.user)
        # 缺课程名称
        resp = self.client.post_json("/api/courses/request/", {
            "course_type": "general", "course_name": "", "course_code": "G1",
            "general_category_id": 1,
        })
        self.assertEqual(resp.status_code, 400)
        # 专业课缺目标层级
        resp = self.client.post_json("/api/courses/request/", {
            "course_type": "major", "course_name": "力学", "course_code": "PHY1",
        })
        self.assertEqual(resp.status_code, 400)
        # 代码中 * / - 被剥离后存储
        root, gen, leaf = _build_general_tree()
        resp = self.client.post_json("/api/courses/request/", {
            "course_type": "general", "course_name": "x", "course_code": "GEN02***",
            "general_category_id": gen.id,
        })
        self.assertEqual(resp.status_code, 200)
        req = CourseCreationRequest.objects.get(id=resp.json()["data"]["id"])
        self.assertEqual(req.course_code, "GEN02")


class CourseRequestStatusResolutionTest(BnuTestCase):
    """驳回申请后管理员手动建课：用户端应收敛为已建立，不再要求重申。"""

    def setUp(self):
        super().setUp()
        self.root, self.gen, self.leaf = _build_general_tree()
        self.mod.profile.can_moderate_general = True
        self.mod.profile.save()

    def _reject_request(self, code="GEN02999"):
        self.client.set_token(self.user)
        resp = self.client.post_json("/api/courses/request/", {
            "course_type": "general",
            "course_name": "自动收敛测试课",
            "course_code": code,
            "general_category_id": self.gen.id,
        })
        request_id = resp.json()["data"]["id"]
        self.client.set_token(self.mod)
        self.client.post_json(
            f"/api/moderation/course-requests/{request_id}/reject/",
            {"notes": "请调整到正确位置"},
        )
        return request_id

    def test_rejected_request_resolves_after_manual_course_folder_create(self):
        request_id = self._reject_request("GEN02-999")

        # 模拟总管理员在正确的通识分类下手动建立课程，且故意使用小写代码。
        self.client.set_token(self.admin)
        resp = self.client.post_json("/api/folders/create/", {
            "folder_type": "course",
            "parent_id": self.gen.id,
            "name": "自动收敛测试课",
            "course_code": "gen02999",
            "course_name": "自动收敛测试课",
        })
        self.assertEqual(resp.status_code, 200, resp.content)

        self.client.set_token(self.user)
        status = self.client.get_json(
            "/api/courses/request/status/?codes=GEN02999"
        )
        self.assertEqual(status.status_code, 200)
        item = status.json()["data"]["items"]["GEN02999"]
        self.assertEqual(item["status"], "resolved")
        self.assertEqual(item["request_status"], "rejected")
        self.assertTrue(item["resolved"])
        self.assertEqual(item["review_notes"], "")
        self.assertEqual(item["file_count"], 0)

        # 历史审核记录保留，只有用户端有效状态自动收敛，不篡改驳回审计信息。
        request_row = CourseCreationRequest.objects.get(id=request_id)
        self.assertEqual(request_row.status, CourseCreationRequest.Status.REJECTED)
        self.assertEqual(request_row.review_notes, "请调整到正确位置")

    def test_course_without_tree_entry_does_not_resolve_rejected_request(self):
        self._reject_request("GEN02998")
        Course.objects.create(
            code="GEN02998", name="孤立课程", course_type="general"
        )

        self.client.set_token(self.user)
        status = self.client.get_json(
            "/api/courses/request/status/?codes=GEN02998"
        )
        item = status.json()["data"]["items"]["GEN02998"]
        self.assertEqual(item["status"], CourseCreationRequest.Status.REJECTED)
        self.assertEqual(item["review_notes"], "请调整到正确位置")


class CourseRequestApproveTest(BnuTestCase):
    def setUp(self):
        super().setUp()
        self.root, self.gen, self.leaf = _build_general_tree()
        self.mod.profile.can_moderate_general = True
        self.mod.profile.save()

    def _create_request(self, **kw):
        data = {
            "course_type": "general",
            "course_name": "学术英语写作",
            "course_code": "GEN02199",
            "general_category_id": self.gen.id,
        }
        data.update(kw)
        self.client.set_token(self.user)
        resp = self.client.post_json("/api/courses/request/", data)
        return resp.json()["data"]["id"]

    def test_non_gen_code_as_general_deep_category(self):
        """非 GEN 编码的公共选修课按通识课申请：通识树深层分类可直接作为归入位置
        （课表导入「学院→通识课」手动归位的后端契约）"""
        deeper = create_category(name="公共选修课", parent=self.gen)
        req_id = self._create_request(
            course_name="书法鉴赏", course_code="ART12003",
            general_category_id=deeper.id,
        )
        req = CourseCreationRequest.objects.get(id=req_id)
        self.assertEqual(req.assigned_moderator_id, self.mod.id)  # 仍路由通识版主

        self.client.set_token(self.mod)
        resp = self.client.post_json(f"/api/moderation/course-requests/{req_id}/approve/")
        self.assertEqual(resp.status_code, 200)
        new_leaf = CourseCategory.objects.get(name="书法鉴赏", parent=deeper)
        self.assertEqual(new_leaf.course.code, "ART12003")
        self.assertEqual(new_leaf.course.course_type, "general")

    def test_approve_creates_course_category_and_operation(self):
        req_id = self._create_request()
        req = CourseCreationRequest.objects.get(id=req_id)

        self.client.set_token(self.mod)
        resp = self.client.post_json(f"/api/moderation/course-requests/{req_id}/approve/")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["ok"])

        req.refresh_from_db()
        self.assertEqual(req.status, "approved")
        # 课程创建
        course = Course.objects.get(code="GEN02199")
        self.assertEqual(course.course_type, "general")
        # 叶子节点创建（order = max+1，parent = 通识分类）
        leaf = CourseCategory.objects.get(parent=self.gen, course=course)
        self.assertEqual(leaf.name, "学术英语写作")
        # 操作记录写入（进操作记录而非审核记录）
        op = FolderOperation.objects.filter(category_id=leaf.id, action="create").first()
        self.assertIsNotNone(op)
        self.assertEqual(op.reason, "新建课程申请")

    def test_approve_reuses_existing_code(self):
        create_course(code="GEN02199", name="已存在", course_type="general")
        req_id = self._create_request()

        self.client.set_token(self.mod)
        self.client.post_json(f"/api/moderation/course-requests/{req_id}/approve/")
        self.assertEqual(Course.objects.filter(code="GEN02199").count(), 1)

    def test_approve_prefix_code_does_not_reuse(self):
        """v=147：申请代码是已有课程的前缀时不再复用该课程（testfix 事故回归）。

        已有 GEN02199，申请 GEN0219 → 必须新建 GEN0219，而不是共享 GEN02199。
        """
        create_course(code="GEN02199", name="已存在", course_type="general")
        req_id = self._create_request(course_code="GEN0219")

        self.client.set_token(self.mod)
        resp = self.client.post_json(f"/api/moderation/course-requests/{req_id}/approve/")
        self.assertEqual(resp.status_code, 200)

        created = Course.objects.filter(code="GEN0219")
        self.assertEqual(created.count(), 1, "前缀代码必须新建独立 Course，不得复用 GEN02199")
        # 原课程不被复用
        leaf = CourseCategory.objects.filter(course=created.first()).first()
        self.assertIsNotNone(leaf)
        self.assertNotEqual(created.first().id, Course.objects.get(code="GEN02199").id)

    def test_request_delete_cancels_pending(self):
        """v=147：上传失败清理半成品申请——DELETE 取消自己未审核的申请并删随附文件"""
        req_id = self._create_request()
        self.client.set_token(self.user)
        file = SimpleUploadedFile("del.pdf", b"x", content_type="application/pdf")
        resp = self.client.post(
            f"/api/courses/request/{req_id}/files/",
            {"file": file, "title": "要取消的文件"},
            **self.client.defaults,
        )
        mat_id = resp.json()["data"]["id"]

        # 他人无权删除
        self.client.set_token(self.mod)
        resp = self.client.delete_json(f"/api/courses/request/{req_id}/")
        self.assertEqual(resp.status_code, 404)

        # 本人可删
        self.client.set_token(self.user)
        resp = self.client.delete_json(f"/api/courses/request/{req_id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(CourseCreationRequest.objects.filter(id=req_id).exists())
        self.assertFalse(Material.objects.filter(id=mat_id).exists())

        # 已处理（批准过）的申请不可取消
        req_id2 = self._create_request()
        self.client.set_token(self.mod)
        self.client.post_json(f"/api/moderation/course-requests/{req_id2}/approve/")
        self.client.set_token(self.user)
        resp = self.client.delete_json(f"/api/courses/request/{req_id2}/")
        self.assertEqual(resp.status_code, 400)

    def test_approve_converges_multiple_same_code(self):
        """v=165：多行同码（含均有已通过资料）不再 400「不明确」，确定性收敛复用最早一条。"""
        c1 = create_course(code="GEN0199", name="a", course_type="major")
        c2 = create_course(code="GEN0199", name="b", course_type="major")
        create_material(c1, self.user, review_status="approved")
        create_material(c2, self.user, review_status="approved")
        req_id = self._create_request(course_code="GEN0199")

        self.client.set_token(self.mod)
        resp = self.client.post_json(f"/api/moderation/course-requests/{req_id}/approve/")
        self.assertEqual(resp.status_code, 200)
        # 收敛到最早一条（有资料者中 id 升序第一），不再新建 Course
        self.assertEqual(Course.objects.filter(code="GEN0199").count(), 2)
        req = CourseCreationRequest.objects.get(id=req_id)
        leaf = CourseCategory.objects.get(parent=self.gen, course=c1)
        self.assertEqual(leaf.course_id, c1.id)

    def test_attached_file_flow(self):
        req_id = self._create_request()
        # 上传随附文件
        self.client.set_token(self.user)
        file = SimpleUploadedFile("notes.pdf", b"pdf-content", content_type="application/pdf")
        resp = self.client.post(
            f"/api/courses/request/{req_id}/files/",
            {"file": file, "title": "随附笔记", "teacher": "张老师"},
            **self.client.defaults,
        )
        self.assertEqual(resp.status_code, 200)
        mat_id = resp.json()["data"]["id"]

        mat = Material.objects.get(id=mat_id)
        self.assertIsNone(mat.course_id)
        self.assertEqual(mat.creation_request_id, req_id)
        self.assertEqual(mat.assigned_moderator_id, self.mod.id)
        self.assertEqual(mat.review_status, "pending")

        # 批准申请 → 随附材料归位到课程
        self.client.set_token(self.mod)
        self.client.post_json(f"/api/moderation/course-requests/{req_id}/approve/")
        mat.refresh_from_db()
        self.assertEqual(mat.course.code, "GEN02199")
        self.assertTrue(mat.file_path.startswith("GEN02199/"))
        self.assertEqual(mat.review_status, "pending", "文件仍待审，需单独批准")

        # v=147：随附文件不再出现在「文件上传」待审核队列（只在课程卡片内审核），
        # 避免被单独批准成无文件夹的野鬼文件
        resp = self.client.get_json("/api/moderation/pending/")
        self.assertTrue(not any(m["id"] == mat_id for m in resp.json()["data"]))

        # 但批准申请后，随附文件已带 course，可从卡片内正常批准
        self.client.post_json(f"/api/moderation/{mat_id}/approve/")
        mat.refresh_from_db()
        self.assertEqual(mat.review_status, "approved")

    def test_attached_file_access_matrix(self):
        """未指派版主不可经通用作用域触碰 null-course 随附文件"""
        req_id = self._create_request()
        self.client.set_token(self.user)
        file = SimpleUploadedFile("a.pdf", b"x", content_type="application/pdf")
        resp = self.client.post(
            f"/api/courses/request/{req_id}/files/",
            {"file": file, "title": "t"},
            **self.client.defaults,
        )
        mat_id = resp.json()["data"]["id"]

        # 另一个 can_moderate_general 版主不得访问（_check_moderator_access 守卫）
        other_mod = create_user("mod2", role="moderator", first_name="版主乙")
        other_mod.profile.can_moderate_general = True
        other_mod.profile.save()
        self.client.set_token(other_mod)
        resp = self.client.post_json(f"/api/moderation/{mat_id}/approve/")
        self.assertEqual(resp.status_code, 404)

    def test_reject_cascades(self):
        req_id = self._create_request()
        self.client.set_token(self.user)
        file = SimpleUploadedFile("b.pdf", b"y", content_type="application/pdf")
        resp = self.client.post(
            f"/api/courses/request/{req_id}/files/",
            {"file": file, "title": "t2"},
            **self.client.defaults,
        )
        mat_id = resp.json()["data"]["id"]

        self.client.set_token(self.mod)
        resp = self.client.post_json(f"/api/moderation/course-requests/{req_id}/reject/", {"notes": "代码重复"})
        self.assertEqual(resp.status_code, 200)
        req = CourseCreationRequest.objects.get(id=req_id)
        self.assertEqual(req.status, "rejected")
        self.assertEqual(req.review_notes, "代码重复")
        mat = Material.objects.get(id=mat_id)
        self.assertEqual(mat.review_status, "rejected")
        self.assertFalse(mat.is_approved)

    def test_file_approve_blocked_until_request_approved(self):
        """v=147：申请批准前随附文件（course 为 NULL）禁止单独批准，防止野鬼文件。

        必须先批准课程创建申请 → 文件夹与 course 建立 → 随附文件才能过审。
        """
        req_id = self._create_request()
        self.client.set_token(self.user)
        file = SimpleUploadedFile("early.pdf", b"e", content_type="application/pdf")
        resp = self.client.post(
            f"/api/courses/request/{req_id}/files/",
            {"file": file, "title": "先批准的文件"},
            **self.client.defaults,
        )
        mat_id = resp.json()["data"]["id"]
        mat = Material.objects.get(id=mat_id)
        self.assertIsNone(mat.course_id)

        # 指派版主在申请批准前尝试单独批准随附文件 → 400 拦截
        self.client.set_token(self.mod)
        resp = self.client.post_json(f"/api/moderation/{mat_id}/approve/")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("请先批准该课程创建申请", resp.json()["error"])
        mat.refresh_from_db()
        self.assertEqual(mat.review_status, "pending")

        # 批准申请 → 文件归位到课程
        self.client.post_json(f"/api/moderation/course-requests/{req_id}/approve/")
        mat.refresh_from_db()
        self.assertEqual(mat.course.code, "GEN02199")
        self.assertTrue(mat.file_path.startswith("GEN02199/"))
        self.assertEqual(mat.review_status, "pending")

        # 申请批准后随附文件可正常过审
        resp = self.client.post_json(f"/api/moderation/{mat_id}/approve/")
        self.assertEqual(resp.status_code, 200)
        mat.refresh_from_db()
        self.assertEqual(mat.review_status, "approved")

    def test_card_disappears_after_files_resolved(self):
        req_id = self._create_request()
        self.client.set_token(self.user)
        file = SimpleUploadedFile("c.pdf", b"z", content_type="application/pdf")
        self.client.post(
            f"/api/courses/request/{req_id}/files/",
            {"file": file, "title": "t3"},
            **self.client.defaults,
        )

        self.client.set_token(self.mod)
        # 批准申请后卡片仍在（等待文件）
        self.client.post_json(f"/api/moderation/course-requests/{req_id}/approve/")
        resp = self.client.get_json("/api/moderation/course-requests/")
        items = resp.json()["data"]
        self.assertTrue(any(i["id"] == req_id for i in items))
        req_item = [i for i in items if i["id"] == req_id][0]
        self.assertTrue(req_item["is_waiting_files"])

        # 批准随附文件 → 卡片消失
        mat = Material.objects.get(creation_request_id=req_id, review_status="pending")
        self.client.post_json(f"/api/moderation/{mat.id}/approve/")
        resp = self.client.get_json("/api/moderation/course-requests/")
        self.assertFalse(any(i["id"] == req_id for i in resp.json()["data"]))

    def test_approved_no_files_disappears_immediately(self):
        req_id = self._create_request()
        self.client.set_token(self.mod)
        self.client.post_json(f"/api/moderation/course-requests/{req_id}/approve/")
        resp = self.client.get_json("/api/moderation/course-requests/")
        self.assertFalse(any(i["id"] == req_id for i in resp.json()["data"]))

    def test_unassigned_visible_only_to_super_admin(self):
        # 无 can_moderate_general 版主 → 申请未指派
        self.mod.profile.can_moderate_general = False
        self.mod.profile.save()
        req_id = self._create_request()
        req = CourseCreationRequest.objects.get(id=req_id)
        self.assertIsNone(req.assigned_moderator_id)

        # 普通版主看不到
        self.client.set_token(self.mod)
        resp = self.client.get_json("/api/moderation/course-requests/")
        self.assertFalse(any(i["id"] == req_id for i in resp.json()["data"]))

        # 总管理员看得到
        self.client.set_token(self.admin)
        resp = self.client.get_json("/api/moderation/course-requests/")
        self.assertTrue(any(i["id"] == req_id for i in resp.json()["data"]))

    def test_batch_approve_scoping(self):
        req_id_1 = self._create_request(course_name="甲课", course_code="GEN02901")
        req_id_2 = self._create_request(course_name="乙课", course_code="GEN02902")
        # 驳回一个，让它不进批量
        self.client.set_token(self.mod)
        self.client.post_json(f"/api/moderation/course-requests/{req_id_1}/reject/", {"notes": "x"})

        resp = self.client.post_json("/api/moderation/course-requests/batch-approve/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["data"]["approved_count"], 1)
        self.assertEqual(
            CourseCreationRequest.objects.get(id=req_id_2).status, "approved"
        )
        self.assertEqual(
            CourseCreationRequest.objects.get(id=req_id_1).status, "rejected"
        )
