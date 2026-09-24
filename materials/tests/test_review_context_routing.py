"""
v171 审核路由「广播式」(L1→L4 链，先审先得)

一门课（一个 Course 行 / 一个存储目录）可挂在多棵树的多个节点下：
  A 学院 ─ A1 专业（叶子 FK 挂课）
         ─ A2 专业（course_text 前缀命中同一课程）
  B 学院 ─ BCD 专业（course_text 前缀命中同一课程）

上传携带 category_id（我进的是哪个节点）：
  L1 上下文节点本身的小版主（A2/BCD 完全无关，节点精确命中不展开祖先）
  L2 同学院内所有含此课的节点的小版主（A1 无 → A2 有 → A2）
  L3 版主兜底（限定学院子树，BCD 版主不入选）
  L4 全部超管兜底
无上下文 / 伪造节点 → 跳过 L1/L2 直落版主 → 超管

广播语义（v171）：同一优先层级返回全部候选，不按待审量挑人——
多候选同时收到通知，先审先得（审核动作原子归主，不指派 assigned_moderator）。
"""

import tempfile

from django.test import override_settings

from .helpers import (
    BnuTestCase, create_user, create_college, create_course,
    create_category, create_material,
)
from ..models import Material, Notification


class ReviewContextRoutingTest(BnuTestCase):
    """L1→L4 路由链按上传上下文定专业，候选集广播"""

    def setUp(self):
        super().setUp()
        self.college_a = create_college("数学科学学院", "math")
        self.college_b = create_college("文学院", "wen")
        self.course = create_course(
            "MATH101", "数学分析", college=self.college_a, course_type="major",
        )

        # 专业课树：根 → 学院节点 → 专业节点
        self.root = create_category("专业课")
        self.cat_a = create_category("数学科学学院", parent=self.root)
        self.cat_b = create_category("文学院", parent=self.root)
        self.a1 = create_category("数学类", parent=self.cat_a, course=self.course)
        self.a2 = create_category("统计类", parent=self.cat_a, course_text="MATH101***")
        self.bcd = create_category("文学类", parent=self.cat_b, course_text="MATH101***")

        self.sub_mod_a1 = create_user("suba1", role="sub_moderator", first_name="A1小版主")
        self.sub_mod_a2 = create_user("suba2", role="sub_moderator", first_name="A2小版主")
        self.sub_mod_bcd = create_user("subbcd", role="sub_moderator", first_name="BCD小版主")

    def _assign(self, user, node):
        user.profile.moderated_sections.add(node)

    def _candidates(self, material, ctx):
        from ..views import _review_candidates
        return _review_candidates(material, ctx)

    # ── L1：上下文节点的小版主，A2/BCD 完全无关 ──

    def test_l1_context_node_submod_wins_over_peers(self):
        """A1/A2/BCD 各挂小版主，上下文=A1 → 仅 A1 候选"""
        self._assign(self.sub_mod_a1, self.a1)
        self._assign(self.sub_mod_a2, self.a2)
        self._assign(self.sub_mod_bcd, self.bcd)
        material = create_material(self.course, self.user)

        self.assertEqual(self._candidates(material, self.a1), [self.sub_mod_a1])

    def test_l1_context_node_wins_even_if_loaded(self):
        """A1 小版主待审量更高也不被 A2/BCD 抢（L1 只看上下文节点、不看 load）"""
        self._assign(self.sub_mod_a1, self.a1)
        self._assign(self.sub_mod_a2, self.a2)
        self._assign(self.sub_mod_bcd, self.bcd)
        # 给 A1 小版主灌 2 份待审，A2/BCD 为 0 —— 广播式下 load 完全不参与
        create_material(self.course, self.user, assigned_moderator=self.sub_mod_a1)
        create_material(self.course, self.user, assigned_moderator=self.sub_mod_a1)
        material = create_material(self.course, self.user)

        self.assertEqual(self._candidates(material, self.a1), [self.sub_mod_a1])

    def test_l1_multi_submod_broadcast(self):
        """同一上下文节点挂两个小版主 → 两候选都入选（不挑人）"""
        self._assign(self.sub_mod_a1, self.a1)
        sub_mod_a1b = create_user("suba1b", role="sub_moderator", first_name="A1小版主乙")
        sub_mod_a1b.profile.moderated_sections.add(self.a1)
        material = create_material(self.course, self.user)

        self.assertEqual(
            set(self._candidates(material, self.a1)),
            {self.sub_mod_a1, sub_mod_a1b},
        )

    # ── L2：同学院回退 ──

    def test_l2_same_college_submod_fallback(self):
        """A1 无小版主、A2 有（同树同码）→ 派 A2；BCD 不进"""
        self._assign(self.sub_mod_a2, self.a2)
        self._assign(self.sub_mod_bcd, self.bcd)
        material = create_material(self.course, self.user)

        self.assertEqual(self._candidates(material, self.a1), [self.sub_mod_a2])

    def test_l2_cross_college_submod_excluded(self):
        """A1/A2 无小版主、仅 BCD 有小版主 → 不派 BCD，落 A 版主"""
        self._assign(self.sub_mod_bcd, self.bcd)
        self.mod.profile.managed_majors.add(self.college_a)
        material = create_material(self.course, self.user)

        self.assertEqual(self._candidates(material, self.a1), [self.mod])

    # ── L3：版主兜底（限定学院子树）──

    def test_l3_a_college_mod_fallback(self):
        """A 学院含此课节点全无小版主 → A 版主（managed_majors）"""
        self.mod.profile.managed_majors.add(self.college_a)
        material = create_material(self.course, self.user)

        self.assertEqual(self._candidates(material, self.a1), [self.mod])

    def test_l3_bcd_mod_excluded_by_scope(self):
        """A 版主 + BCD 版主（仅靠 BCD 板块挂课）→ 只派 A 版主，BCD 不入选"""
        self.mod.profile.managed_majors.add(self.college_a)
        mod_bcd = create_user("modbcd", role="moderator", first_name="BCD版主")
        mod_bcd.profile.moderated_sections.add(self.bcd)
        material = create_material(self.course, self.user)

        self.assertEqual(self._candidates(material, self.a1), [self.mod])

    def test_l3_multi_mod_broadcast(self):
        """两个 A 版主都管辖该学院 → 全部候选（不挑待审量最少）"""
        self.mod.profile.managed_majors.add(self.college_a)
        mod2 = create_user("mod2a", role="moderator", first_name="版主乙")
        mod2.profile.managed_majors.add(self.college_a)
        material = create_material(self.course, self.user)

        self.assertEqual(
            set(self._candidates(material, self.a1)),
            {self.mod, mod2},
        )

    # ── L4：超管兜底 ──

    def test_l4_super_admin_fallback(self):
        """无小版主无版主 → 超管兜底"""
        material = create_material(self.course, self.user)

        self.assertEqual(self._candidates(material, self.a1), [self.admin])

    def test_l4_multi_super_admin_broadcast(self):
        """多超管 → 全部兜底（不挑人）"""
        admin2 = create_user("admin2", role="super_admin", first_name="超管乙")
        material = create_material(self.course, self.user)

        self.assertEqual(
            set(self._candidates(material, self.a1)),
            {self.admin, admin2},
        )

    # ── 无上下文 / 伪造节点 ──

    def test_no_context_falls_to_moderator(self):
        """category_id 缺失 → 跳过 L1/L2 直落版主"""
        self._assign(self.sub_mod_a1, self.a1)
        self.mod.profile.managed_majors.add(self.college_a)
        material = create_material(self.course, self.user)

        self.assertEqual(self._candidates(material, None), [self.mod])

    def test_no_context_no_mods_super_admin(self):
        """category_id 缺失且无版主 → 超管"""
        material = create_material(self.course, self.user)

        self.assertEqual(self._candidates(material, None), [self.admin])

    # ── 校验工具 ──

    def test_node_contains_course_helper(self):
        """叶子 FK / course_text 前缀 / 空值"""
        from ..views.utils import _node_contains_course
        self.assertTrue(_node_contains_course(self.a1, self.course))   # 叶子 FK
        self.assertTrue(_node_contains_course(self.a2, self.course))   # 前缀命中
        self.assertTrue(_node_contains_course(self.bcd, self.course))  # 跨学院前缀同样命中
        self.assertFalse(_node_contains_course(self.a1, None))

    # ── 端到端：上传带 category_id 广播 ──

    @override_settings(MEDIA_ROOT=tempfile.mkdtemp())
    def test_upload_e2e_broadcast_notifies_candidates(self):
        """POST /api/files/upload/ 带 category_id → 不指派、仅 L1 候选收到 NEW_PENDING"""
        from django.core.files.uploadedfile import SimpleUploadedFile
        self._assign(self.sub_mod_a1, self.a1)
        self._assign(self.sub_mod_a2, self.a2)
        self.client.set_token(self.user)
        fake_file = SimpleUploadedFile("test.pdf", b"%PDF-1.4 content", content_type="application/pdf")
        resp = self.client.post("/api/files/upload/", {
            "course_code": "MATH101",
            "category_id": str(self.a1.id),
            "title": "数学分析笔记",
            "teacher": "王老师",
            "file": fake_file,
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["ok"])
        material = Material.objects.get(id=data["data"]["id"])
        self.assertEqual(material.review_status, "pending")
        self.assertIsNone(material.assigned_moderator_id)  # 不指派
        # 仅 L1 候选（A1 小版主）收到广播；A2/BCD 不相关
        self.assertEqual(
            Notification.objects.filter(
                recipient=self.sub_mod_a1, type=Notification.Type.NEW_PENDING,
            ).count(), 1,
        )
        self.assertEqual(
            Notification.objects.filter(
                recipient=self.sub_mod_a2, type=Notification.Type.NEW_PENDING,
            ).count(), 0,
        )

    @override_settings(MEDIA_ROOT=tempfile.mkdtemp())
    def test_upload_bogus_category_falls_back_to_mod(self):
        """category_id 指向不含此课的节点 → 当无上下文，落版主并广播"""
        from django.core.files.uploadedfile import SimpleUploadedFile
        self._assign(self.sub_mod_a1, self.a1)
        self.mod.profile.managed_majors.add(self.college_a)
        bogus = create_category("无关节点", parent=self.cat_b, course_text="ZZZ999***")
        self.client.set_token(self.user)
        fake_file = SimpleUploadedFile("test.pdf", b"%PDF-1.4 content", content_type="application/pdf")
        resp = self.client.post("/api/files/upload/", {
            "course_code": "MATH101",
            "category_id": str(bogus.id),
            "title": "数学分析笔记",
            "teacher": "王老师",
            "file": fake_file,
        })
        self.assertEqual(resp.status_code, 200)
        material = Material.objects.get(id=resp.json()["data"]["id"])
        self.assertIsNone(material.assigned_moderator_id)
        self.assertEqual(
            Notification.objects.filter(
                recipient=self.mod, type=Notification.Type.NEW_PENDING,
            ).count(), 1,
        )
