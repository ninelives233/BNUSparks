"""
v168 补强 + v171 广播式：审核路由候选集 + 版主向下指派

路由（_review_candidates，v171）：
  多个小版主/版主覆盖同一课程时，返回全部候选（候选集广播）——
  不再「第一个命中拍板」垄断，也不按待审量挑人；多候选同时通知，先审先得。

版主向下指派（api_moderation_reassign / api_moderation_assignable）：
  - 版主可把辖区内的 pending 下派给覆盖该课程的小版主
  - 目标必须是小版主且覆盖该课程；超管不变（任意版主/小版主）
  - 小版主无向下指派权
"""

from .helpers import (
    BnuTestCase, create_user, create_college, create_course,
    create_category, create_material,
)
from ..models import Notification


class RoutingFairnessTest(BnuTestCase):
    """_review_candidates 候选集广播（v171：不挑人、不按待审量）"""

    def setUp(self):
        super().setUp()
        self.college = create_college("数学科学学院", "math")
        self.major_course = create_course(
            "MATH101", "数学分析", college=self.college, course_type="major",
        )
        self.cat_math = create_category("数学类")
        self.cat_math.course = self.major_course
        self.cat_math.save()
        self.sub_mod_2 = create_user("submod2", role="sub_moderator", first_name="小版主乙")

    def _candidates(self, material):
        from ..views import _review_candidates
        return _review_candidates(material, self.cat_math)

    def test_both_covering_sub_mods_broadcast(self):
        """两个小版主覆盖同一课程 → 全部候选（不挑待审量最少、不按建号顺序）"""
        self.sub_mod.profile.moderated_sections.add(self.cat_math)
        self.sub_mod_2.profile.moderated_sections.add(self.cat_math)
        # 小版主甲已有 2 份待审指派，小版主乙 0 份 —— load 不参与，两候选都入选
        create_material(self.major_course, self.user, assigned_moderator=self.sub_mod)
        create_material(self.major_course, self.user, assigned_moderator=self.sub_mod)
        material = create_material(self.major_course, self.user)

        self.assertEqual(
            set(self._candidates(material)),
            {self.sub_mod, self.sub_mod_2},
        )

    def test_both_mods_broadcast(self):
        """无小版主 → 版主间也全部候选（不挑待审量最少）"""
        self.mod.profile.managed_majors.add(self.college)
        mod_2 = create_user("mod2", role="moderator", first_name="版主乙")
        mod_2.profile.managed_majors.add(self.college)
        create_material(self.major_course, self.user, assigned_moderator=self.mod)
        material = create_material(self.major_course, self.user)

        self.assertEqual(
            set(self._candidates(material)),
            {self.mod, mod_2},
        )

    def test_single_sub_mod_still_picked(self):
        """仅一个小版主覆盖 → 照常候选（回归）"""
        self.sub_mod.profile.moderated_sections.add(self.cat_math)
        material = create_material(self.major_course, self.user)

        self.assertEqual(self._candidates(material), [self.sub_mod])


class ReassignDownAssignTest(BnuTestCase):
    """版主向下指派 api_moderation_reassign / api_moderation_assignable"""

    def setUp(self):
        super().setUp()
        self.college = create_college("数学科学学院", "math")
        self.major_course = create_course(
            "MATH101", "数学分析", college=self.college, course_type="major",
        )
        self.cat_math = create_category("数学类")
        self.cat_math.course = self.major_course
        self.cat_math.save()
        self.sub_mod.profile.moderated_sections.add(self.cat_math)
        self.mod.profile.managed_majors.add(self.college)
        self.sub_mod_2 = create_user("submod2", role="sub_moderator", first_name="小版主乙")
        self.mod_2 = create_user("mod2", role="moderator", first_name="版主乙")

    def _pending_for_mod(self):
        """小版主甲管辖分类下的待审资料，指派给版主甲（版主在其辖区可下派）"""
        return create_material(self.major_course, self.user, assigned_moderator=self.mod)

    def test_mod_down_assign_to_covering_sub_mod(self):
        """版主 → 下派给覆盖该课程的小版主 → 200 + 通知"""
        material = self._pending_for_mod()
        self.client.set_token(self.mod)
        resp = self.client.post_json(
            f"/api/moderation/{material.id}/reassign/",
            {"assigned_moderator": self.sub_mod.id},
        )
        self.assertEqual(resp.status_code, 200)
        material.refresh_from_db()
        self.assertEqual(material.assigned_moderator_id, self.sub_mod.id)
        self.assertEqual(
            Notification.objects.filter(
                recipient=self.sub_mod, type=Notification.Type.OPERATION,
            ).count(), 1,
        )

    def test_mod_reassign_to_non_covering_sub_mod(self):
        """版主 → 下派给不覆盖该课程的小版主 → 400"""
        material = self._pending_for_mod()
        self.client.set_token(self.mod)
        resp = self.client.post_json(
            f"/api/moderation/{material.id}/reassign/",
            {"assigned_moderator": self.sub_mod_2.id},
        )
        self.assertEqual(resp.status_code, 400)

    def test_mod_reassign_to_moderator_rejected(self):
        """版主 → 横向指派给另一位版主 → 400（只能向下）"""
        material = self._pending_for_mod()
        self.client.set_token(self.mod)
        resp = self.client.post_json(
            f"/api/moderation/{material.id}/reassign/",
            {"assigned_moderator": self.mod_2.id},
        )
        self.assertEqual(resp.status_code, 400)

    def test_mod_reassign_outside_scope_rejected(self):
        """版主 → 指派辖区外的资料 → 403"""
        other_college = create_college("文学院", "wen")
        other_course = create_course(
            "LIT101", "古代汉语", college=other_college, course_type="major",
        )
        material = create_material(other_course, self.user)  # 无指派、无辖区覆盖
        self.client.set_token(self.mod)
        resp = self.client.post_json(
            f"/api/moderation/{material.id}/reassign/",
            {"assigned_moderator": self.sub_mod.id},
        )
        self.assertEqual(resp.status_code, 403)

    def test_sub_mod_cannot_reassign(self):
        """小版主调用 reassign → 403（无向下指派权）"""
        material = self._pending_for_mod()
        self.client.set_token(self.sub_mod)
        resp = self.client.post_json(
            f"/api/moderation/{material.id}/reassign/",
            {"assigned_moderator": self.sub_mod_2.id},
        )
        self.assertEqual(resp.status_code, 403)

    def test_super_admin_reassign_any_admin(self):
        """超管 → 指派给任意版主/小版主 → 200（维持原行为）"""
        material = create_material(self.major_course, self.user)
        self.client.set_token(self.admin)
        resp = self.client.post_json(
            f"/api/moderation/{material.id}/reassign/",
            {"assigned_moderator": self.mod_2.id},
        )
        self.assertEqual(resp.status_code, 200)
        material.refresh_from_db()
        self.assertEqual(material.assigned_moderator_id, self.mod_2.id)

    def test_assignable_mod_sees_only_covering_sub_mods(self):
        """assignable：版主只看到覆盖该课程的小版主（不含其他版主）"""
        material = self._pending_for_mod()
        self.client.set_token(self.mod)
        resp = self.client.get_json(f"/api/moderation/{material.id}/assignable/")
        self.assertEqual(resp.status_code, 200)
        ids = [u["id"] for u in resp.json()["data"]["users"]]
        self.assertIn(self.sub_mod.id, ids)
        self.assertNotIn(self.sub_mod_2.id, ids)  # 不覆盖 → 不出现
        self.assertNotIn(self.mod_2.id, ids)      # 版主不能指派给版主

    def test_assignable_super_sees_all_admins(self):
        """assignable：超管看到全部版主 + 小版主"""
        material = create_material(self.major_course, self.user)
        self.client.set_token(self.admin)
        resp = self.client.get_json(f"/api/moderation/{material.id}/assignable/")
        self.assertEqual(resp.status_code, 200)
        ids = [u["id"] for u in resp.json()["data"]["users"]]
        self.assertIn(self.sub_mod.id, ids)
        self.assertIn(self.mod.id, ids)
        self.assertIn(self.mod_2.id, ids)
