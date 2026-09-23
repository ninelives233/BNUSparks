"""文件夹操作测试（v=147）：删除后搜索残留、空文件夹撤销创建、有资料文件夹撤销拒绝"""

from datetime import timedelta

from django.utils import timezone

from .helpers import (
    BnuTestCase, create_user, create_college, create_course,
    create_category, create_material,
)
from ..models import Course, CourseCategory, FolderOperation, Material


class FolderDeleteSearchTest(BnuTestCase):
    """删除文件夹后：孤儿 Course 不应再出现在 /api/search/ 与 /api/courses/"""

    def setUp(self):
        super().setUp()
        self.college = create_college("物理", "wlx")
        self.course = create_course("PHY201", "理论力学",
            college=self.college, course_type="major")
        # 专业课 → 学院 → 专业 → 必修课（叶子绑课程，树深处可被版主管辖）
        root = create_category(name="专业课")
        col_node = create_category(name="物理学院", parent=root)
        major = create_category(name="物理专业", parent=col_node)
        self.cat = create_category(name="物理专业必修课", parent=major, course=self.course)
        self.mod.profile.managed_majors.add(self.college)

    def _search(self, q):
        self.client.set_token(self.user)
        return self.client.get_json("/api/search/", {"q": q})

    def test_orphan_course_hidden_from_search(self):
        # 删除文件夹 → CourseCategory 删掉，Course 保留（孤儿）
        self.client.set_token(self.mod)
        resp = self.client.delete_json(f"/api/folders/{self.cat.id}/delete/")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(CourseCategory.objects.filter(id=self.cat.id).exists())
        self.assertTrue(Course.objects.filter(id=self.course.id).exists())

        # 搜索不再返回该孤儿课程
        resp = self._search("PHY201")
        self.assertEqual(resp.status_code, 200)
        codes = [c["code"] for c in resp.json()["data"]["courses"]]
        self.assertNotIn("PHY201", codes)

    def test_course_list_excludes_orphan(self):
        self.client.set_token(self.mod)
        self.client.delete_json(f"/api/folders/{self.cat.id}/delete/")

        self.client.set_token(self.user)
        resp = self.client.get_json("/api/courses/")
        self.assertEqual(resp.status_code, 200)
        codes = [c["code"] for c in resp.json()["data"]]
        self.assertNotIn("PHY201", codes)

    def test_valid_course_still_searchable(self):
        # 未删除的课程照常出现在搜索里
        resp = self._search("PHY201")
        self.assertEqual(resp.status_code, 200)
        codes = [c["code"] for c in resp.json()["data"]["courses"]]
        self.assertIn("PHY201", codes)


class FolderRestoreTest(BnuTestCase):
    """撤销「创建」操作：空文件夹可撤销（连带删孤儿 Course）；有资料则拒绝"""

    def setUp(self):
        super().setUp()
        self.college = create_college("数学", "sx")
        self.course = create_course("MATH301", "实变函数",
            college=self.college, course_type="major")
        root = create_category(name="专业课")
        col_node = create_category(name="数学学院", parent=root)
        major = create_category(name="数学专业", parent=col_node)
        self.cat = create_category(name="数学专业必修课", parent=major, course=self.course)
        self.mod.profile.managed_majors.add(self.college)

    def _create_op(self, user=None):
        return FolderOperation.objects.create(
            user=user or self.mod, action=FolderOperation.Action.CREATE,
            category_id=self.cat.id, category_name=self.cat.name,
            parent_path="", folder_type="course",
            reason="新建课程申请",
        )

    def test_restore_empty_folder_deletes_category_and_course(self):
        op = self._create_op()
        self.client.set_token(self.admin)
        resp = self.client.post_json(f"/api/operations/{op.id}/restore/")
        self.assertEqual(resp.status_code, 200)

        # 空文件夹：分类与孤儿 Course 一并删除，搜索不再残留
        self.assertFalse(CourseCategory.objects.filter(id=self.cat.id).exists())
        self.assertFalse(Course.objects.filter(id=self.course.id).exists())
        op.refresh_from_db()
        self.assertTrue(op.is_restored)

    def test_restore_folder_with_materials_rejected(self):
        create_material(self.course, self.user, review_status="approved")
        op = self._create_op()
        self.client.set_token(self.admin)
        resp = self.client.post_json(f"/api/operations/{op.id}/restore/")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("已有资料", resp.json()["error"])
        # 分类与资料都还在
        self.assertTrue(CourseCategory.objects.filter(id=self.cat.id).exists())

    def test_restore_already_deleted_folder_only_marks_restored(self):
        """文件夹此前被手动删除：撤销标记成功，不报错（残留由搜索过滤兜底）"""
        op = self._create_op()
        self.cat.delete()   # 模拟之前已删除
        self.client.set_token(self.admin)
        resp = self.client.post_json(f"/api/operations/{op.id}/restore/")
        self.assertEqual(resp.status_code, 200)
        op.refresh_from_db()
        self.assertTrue(op.is_restored)

    def test_restore_requires_super_admin_or_operator(self):
        op = self._create_op(user=self.mod)
        # 无关的小版主无权撤销
        self.client.set_token(self.sub_mod)
        resp = self.client.post_json(f"/api/operations/{op.id}/restore/")
        self.assertEqual(resp.status_code, 403)

    def test_restore_expired_48h_rejected(self):
        op = self._create_op()
        op.created_at = timezone.now() - timedelta(hours=50)
        op.save(update_fields=["created_at"])
        self.client.set_token(self.admin)
        resp = self.client.post_json(f"/api/operations/{op.id}/restore/")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("48", resp.json()["error"])


class SetCourseTest(BnuTestCase):
    """修改课程代码（v=158）：rename_self 重命名+迁移文件路径；merge 合并到已有课程；link 指向已有课程"""

    def setUp(self):
        super().setUp()
        self.college = create_college("统计", "tj")
        root = create_category(name="专业课")
        col_node = create_category(name="统计学院", parent=root)
        major = create_category(name="统计学专业", parent=col_node)
        self.cat = create_category(name="统计学导论A", parent=major)
        self.course = create_course("STA01801", "统计学导论A",
            college=self.college, course_type="major")
        self.cat.course = self.course
        self.cat.save(update_fields=["course"])
        self.mod.profile.managed_majors.add(self.college)

    def _query(self, code):
        """阶段1：只查情况，不执行"""
        self.client.set_token(self.mod)
        return self.client.post_json(
            f"/api/folders/{self.cat.id}/set-course/", {"course_code": code})

    def _exec(self, code, action_id, target_course_id=None):
        body = {"course_code": code, "action_id": action_id}
        if target_course_id:
            body["target_course_id"] = target_course_id
        self.client.set_token(self.mod)
        return self.client.post_json(f"/api/folders/{self.cat.id}/set-course/", body)

    def test_phase1_new_code(self):
        resp = self._query("NEW10001")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["data"]["situation"], "new_code")

    def test_rename_self_persists_code_and_migrates_file_path(self):
        m = create_material(self.course, self.user, review_status="approved")
        self.assertEqual(m.file_path, "STA01801/test.pdf")

        resp = self._exec("NEW10001", "rename_self")
        self.assertEqual(resp.status_code, 200)

        # 落库断言：Course.code 已改、分类仍指向它、material.file_path 前缀已迁移
        self.course.refresh_from_db()
        self.assertEqual(self.course.code, "NEW10001")
        self.cat.refresh_from_db()
        self.assertEqual(self.cat.course_id, self.course.id)
        m.refresh_from_db()
        self.assertEqual(m.file_path, "NEW10001/test.pdf")

    def test_merge_persists_to_existing_course(self):
        target = create_course("TGT001", "统计学导论B",
            college=self.college, course_type="major")
        m = create_material(self.course, self.user, review_status="approved")

        # 阶段1：exists_single 且提供 merge 选项
        resp = self._query("TGT001")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()["data"]
        self.assertEqual(data["situation"], "exists_single")
        self.assertTrue([o for o in data["options"] if o["id"] == "merge"])

        # 阶段2：merge
        resp2 = self._exec("TGT001", "merge", target.id)
        self.assertEqual(resp2.status_code, 200)

        # 落库断言：material 迁移到 target、file_path 前缀已改、旧课程已删、分类指向 target
        m.refresh_from_db()
        self.assertEqual(m.course_id, target.id)
        self.assertEqual(m.file_path, "TGT001/test.pdf")
        self.assertFalse(Course.objects.filter(id=self.course.id).exists())
        self.cat.refresh_from_db()
        self.assertEqual(self.cat.course_id, target.id)

    def test_merge_rejects_same_course(self):
        resp = self._exec("STA01801", "merge", self.course.id)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("自身", resp.json()["error"])

    def test_link_persists_without_deleting_old_course(self):
        target = create_course("TGT002", "其他课",
            college=self.college, course_type="major")
        resp = self._exec("TGT002", "link", target.id)
        self.assertEqual(resp.status_code, 200)
        self.cat.refresh_from_db()
        self.assertEqual(self.cat.course_id, target.id)
        # link 不删除旧课程
        self.assertTrue(Course.objects.filter(id=self.course.id).exists())

    def test_non_alphanumeric_code_rejected(self):
        resp = self._query("BAD-CODE!")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("字母和数字", resp.json()["error"])

    def test_folder_create_rejects_non_alphanumeric_code(self):
        self.client.set_token(self.mod)
        resp = self.client.post_json("/api/folders/create/", {
            "name": "测试课", "parent_id": self.cat.parent_id,
            "folder_type": "course", "course_code": "PHY-01!",
            "course_name": "测试课",
        })
        self.assertEqual(resp.status_code, 400)
        self.assertIn("字母和数字", resp.json()["error"])

    def test_folder_create_accepts_alphanumeric_code(self):
        self.client.set_token(self.mod)
        resp = self.client.post_json("/api/folders/create/", {
            "name": "测试课", "parent_id": self.cat.parent_id,
            "folder_type": "course", "course_code": "PHY01234",
            "course_name": "测试课",
        })
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(CourseCategory.objects.filter(name="测试课").exists())
