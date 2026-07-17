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
)

from ..models import CourseCategory, Course


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
