"""
审核路由分配测试（对应历史上 scope-assignment 四层根因）

覆盖 _calculate_review_assignment 的全矩阵：

  专业课 ─→ 有小版主？→ 小版主
          → 无小版主？→ 版主
          → 无任何版主？→ None（不指派）

  通识课 ─→ 有版主（can_moderate_general）？→ 版主
          → 无相应版主？→ None

测试 6 种组合。
"""

from .helpers import (
    BnuTestCase, create_user, create_college, create_course,
    create_category, create_material,
)
from ..models import UserProfile, CourseType


class ReviewAssignmentTest(BnuTestCase):
    """审核路由全矩阵测试"""

    def setUp(self):
        super().setUp()
        self.college = create_college("数学科学学院", "math")
        self.general_course = create_course(
            code="GEN0001", name="通识英语",
            college=None, course_type="general",
        )
        self.major_course = create_course(
            code="MATH101", name="数学分析",
            college=self.college, course_type="major",
        )

        # 创建课程导航节点
        self.cat_math = create_category(name="数学类")
        self.cat_math.course = self.major_course
        self.cat_math.save()

        self.sub_mod_2 = create_user("submod2", role="sub_moderator", first_name="小版主乙")
        self.mod_2 = create_user("mod2", role="moderator", first_name="版主乙")

    # ── 专业课 ──

    def test_major_course_assigned_to_sub_mod(self):
        """专业课 → 有小版主管辖该分类 → 推给小版主"""
        self.sub_mod.profile.moderated_sections.add(self.cat_math)
        material = create_material(self.major_course, self.user)

        from ..views import _calculate_review_assignment
        assigned = _calculate_review_assignment(material)
        self.assertEqual(assigned, self.sub_mod)

    def test_major_course_falls_to_moderator(self):
        """专业课 → 无小版主 → 推给管辖该学院的版主"""
        self.mod.profile.managed_majors.add(self.college)
        material = create_material(self.major_course, self.user)

        from ..views import _calculate_review_assignment
        assigned = _calculate_review_assignment(material)
        self.assertEqual(assigned, self.mod)

    def test_major_course_no_one(self):
        """专业课 → 无任何管理员 → 返回 None"""
        material = create_material(self.major_course, self.user)
        from ..views import _calculate_review_assignment
        self.assertIsNone(_calculate_review_assignment(material))

    # ── 通识课 ──

    def test_general_assigned_to_mod_with_general_perm(self):
        """通识课 → 有版主且 can_moderate_general=True → 推给版主"""
        self.mod.profile.can_moderate_general = True
        self.mod.profile.save()
        material = create_material(self.general_course, self.user)

        from ..views import _calculate_review_assignment
        assigned = _calculate_review_assignment(material)
        self.assertEqual(assigned, self.mod)

    def test_general_assigned_to_cat_moderator(self):
        """通识课 → 通过 moderated_sections 匹配版主"""
        cat_gen = create_category(name="通识英语类", course_text="GEN0001")
        self.mod.profile.moderated_sections.add(cat_gen)
        material = create_material(self.general_course, self.user)

        from ..views import _calculate_review_assignment
        assigned = _calculate_review_assignment(material)
        self.assertEqual(assigned, self.mod)

    def test_general_no_moderator(self):
        """通识课 → 无对应版主 → None"""
        material = create_material(self.general_course, self.user)
        from ..views import _calculate_review_assignment
        self.assertIsNone(_calculate_review_assignment(material))

    # ── 优先级（sub_mod 优先于 mod）──

    def test_sub_mod_preferred_over_mod(self):
        """同一课程既有小版主又有版主 → 优先给版主"""
        self.sub_mod.profile.moderated_sections.add(self.cat_math)
        self.mod.profile.managed_majors.add(self.college)
        material = create_material(self.major_course, self.user)

        from ..views import _calculate_review_assignment
        assigned = _calculate_review_assignment(material)
        self.assertEqual(assigned, self.sub_mod)

    # ── 多候选人取第一个 ──

    def test_first_moderator_picked(self):
        """多个版主都能审 → 返回第一个（当前按 QuerySet 顺序）"""
        self.mod.profile.managed_majors.add(self.college)
        self.mod_2.profile.managed_majors.add(self.college)

        material = create_material(self.major_course, self.user)
        from ..views import _calculate_review_assignment
        assigned = _calculate_review_assignment(material)
        self.assertIn(assigned, [self.mod, self.mod_2])
