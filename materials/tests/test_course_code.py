"""
同名课程测试（对应历史上 Course.code 重复导致的 MultipleObjectsReturned）

场景：
  - 两个 College 各有同名课程 "高等数学"，code 不同但 name 相同
  - 上传到各自课程时路由到正确的 Course
  - 查询文件列表不会串

相关记忆: [[course-code-nonunique.md]], [[split-mechanism.md]]
"""

from .helpers import BnuTestCase, create_user, create_college, create_course, create_material


class SameNameCourseTest(BnuTestCase):
    """同名课程隔离测试"""

    def setUp(self):
        super().setUp()
        # 两个学院各有一个 "高等数学"
        self.college_a = create_college("数学科学学院", "sxkx")
        self.college_b = create_college("物理学系", "wlx")

        self.course_a = create_course(
            code="MATH001", name="高等数学",
            college=self.college_a, course_type="major",
        )
        self.course_b = create_course(
            code="MATH002", name="高等数学",
            college=self.college_b, course_type="major",
        )

    def test_find_course_by_unique_code(self):
        """每门课有唯一 code，用 code 查询不应 MultipleObjectsReturned"""
        from django.core.exceptions import MultipleObjectsReturned
        try:
            ca = type(self.course_a).objects.get(code="MATH001")
            cb = type(self.course_a).objects.get(code="MATH002")
        except MultipleObjectsReturned:
            self.fail("同名课程 code 不同，通过 code 查询不应该 MultipleObjectsReturned")

        self.assertEqual(ca.id, self.course_a.id)
        self.assertEqual(cb.id, self.course_b.id)
        self.assertNotEqual(ca.id, cb.id)

    def test_upload_to_each_course_is_isolated(self):
        """上传到 course_a 的文件只挂在 course_a 下"""
        ma = create_material(self.course_a, self.user, review_status="approved")
        mb = create_material(self.course_b, self.user, review_status="approved")

        files_a = list(self.course_a.materials.all())
        files_b = list(self.course_b.materials.all())

        self.assertIn(ma, files_a)
        self.assertNotIn(ma, files_b)
        self.assertIn(mb, files_b)
        self.assertNotIn(mb, files_a)

    def test_course_files_api_returns_correct(self):
        """GET /api/courses/{code}/files/ 返回该课程的准确文件"""
        create_material(self.course_a, self.user, review_status="approved")
        create_material(self.course_b, self.user, review_status="approved")

        self.client.set_token(self.user)
        resp = self.client.get(f"/api/courses/{self.course_a.code}/files/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["ok"])
        # 所有返回的文件都应属于 course_a
        for f in data["data"]:
            self.assertEqual(f["course_code"], self.course_a.code)

    def test_upload_with_duplicate_code_fallback(self):
        """upload 接口的 MultipleObjectsReturned fallback 逻辑"""
        # 给 course_a 文件使其成为"有文件的课程"
        create_material(self.course_a, self.user, review_status="approved")

        # 模拟两个同名 code 的情况（API 传入的 course_code 重复）
        # 给 course_b 也设相同 code（极端情况）
        self.course_b.code = "MATH001"
        self.course_b.save()

        self.client.set_token(self.user)
        # POST 需要 multipart/form-data，用普通 upload 模拟
        response = self.client.post_json("/api/files/upload/", {
            "course_code": "MATH001",
            "title": "测试",
            "teacher": "张老师",
        })
        # 如果能走到错误的课程提示，说明 fallback 逻辑触发了
        # 这个请求正文格式不对（缺文件），但会先经过课程查询阶段
        # 如果 MultipleObjectsReturned 没处理，会是 500
        self.assertNotEqual(response.status_code, 500)
