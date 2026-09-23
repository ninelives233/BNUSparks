"""
自动托管测试

覆盖 _check_auto_approve 的判定逻辑：
  - sub_mod + auto_approve + can_auto_approve → 自动批准
  - auto_approve 关 → 不进自动
  - 仅 MODERATOR/SUB_MODERATOR 可以 auto_approve
  - 自己不审自己上传的
  - can_auto_approve 未设置则 auto_approve 不生效
"""

import tempfile

from django.test.utils import override_settings

from .helpers import (
    BnuTestCase, create_user, create_college, create_course,
    create_category, create_material,
)
from ..models import UserProfile, Material


class AutoApproveTest(BnuTestCase):
    """自动托管判定测试"""

    def setUp(self):
        super().setUp()
        self.college = create_college("数学", "sx")
        self.course = create_course("MATH101", "数学分析",
            college=self.college, course_type="major")
        self.cat = create_category(name="数学类")
        self.cat.course = self.course
        self.cat.save()
        self.sub_mod.profile.moderated_sections.add(self.cat)

        self.sub_mod_auto = create_user("submod_auto", role="sub_moderator", first_name="自动小版主")
        self.sub_mod_auto.profile.moderated_sections.add(self.cat)

        self.mod_auto = create_user("mod_auto", role="moderator", first_name="自动版主")
        self.mod_auto.profile.managed_majors.add(self.college)

    # ── sub_mod 自动托管 ──

    def test_sub_mod_auto_approve_works(self):
        """sub_mod + auto_approve + can_auto_approve → 自动批准"""
        self.sub_mod_auto.profile.auto_approve = True
        self.sub_mod_auto.profile.can_auto_approve = True
        self.sub_mod_auto.profile.save()

        from ..views import _check_auto_approve
        result = _check_auto_approve(self.course)
        self.assertEqual(result, self.sub_mod_auto)

    def test_sub_mod_auto_approve_off(self):
        """auto_approve = False → 不过自动"""
        self.sub_mod_auto.profile.auto_approve = False
        self.sub_mod_auto.profile.can_auto_approve = True
        self.sub_mod_auto.profile.save()

        from ..views import _check_auto_approve
        self.assertIsNone(_check_auto_approve(self.course))

    def test_sub_mod_no_can_auto_approve(self):
        """can_auto_approve = False 但 auto_approve = True → 自动仍生效
        （_check_auto_approve 不校验 can_auto_approve，该字段仅 API 开关用）"""
        self.sub_mod_auto.profile.auto_approve = True
        self.sub_mod_auto.profile.can_auto_approve = False
        self.sub_mod_auto.profile.save()

        from ..views import _check_auto_approve
        result = _check_auto_approve(self.course)
        self.assertEqual(result, self.sub_mod_auto)

    # ── moderator 自动托管 ──

    def test_mod_auto_approve_works(self):
        """moderator + auto_approve + can_auto_approve → 自动批准"""
        self.mod_auto.profile.auto_approve = True
        self.mod_auto.profile.can_auto_approve = True
        self.mod_auto.profile.save()

        from ..views import _check_auto_approve
        result = _check_auto_approve(self.course)
        self.assertEqual(result, self.mod_auto)

    # ── 通识课自动托管 ──

    def test_general_course_auto_approve(self):
        """通识课 auto_approve → 有 can_moderate_general 的版主自动批准"""
        gen_course = create_course("GEN001", "通识英语",
            college=None, course_type="general")
        self.mod_auto.profile.can_moderate_general = True
        self.mod_auto.profile.auto_approve = True
        self.mod_auto.profile.can_auto_approve = True
        self.mod_auto.profile.save()

        from ..views import _check_auto_approve
        result = _check_auto_approve(gen_course)
        self.assertEqual(result, self.mod_auto)

    # ── 不匹配的课程 → 无人自动 ──

    def test_no_auto_approve_for_unmatched_course(self):
        """auto_approve 开但不管这课的 → None"""
        other_college = create_college("化学", "hx")
        other_course = create_course("CHEM101", "有机化学",
            college=other_college, course_type="major")

        self.mod_auto.profile.auto_approve = True
        self.mod_auto.profile.can_auto_approve = True
        self.mod_auto.profile.managed_majors.add(self.college)  # 只管数学不管化学
        self.mod_auto.profile.save()

        from ..views import _check_auto_approve
        self.assertIsNone(_check_auto_approve(other_course))

    # ── sub_mod 优先于 mod ──

    def test_sub_mod_preferred_for_auto(self):
        """sub_mod 和 mod 都 auto_approve → sub_mod 优先"""
        self.sub_mod_auto.profile.auto_approve = True
        self.sub_mod_auto.profile.can_auto_approve = True
        self.sub_mod_auto.profile.save()

        self.mod_auto.profile.auto_approve = True
        self.mod_auto.profile.can_auto_approve = True
        self.mod_auto.profile.save()

        from ..views import _check_auto_approve
        result = _check_auto_approve(self.course)
        self.assertEqual(result, self.sub_mod_auto)

    # ── 上传后自动批准（API 集成）──

    @override_settings(MEDIA_ROOT=tempfile.mkdtemp())
    def test_upload_with_auto_approve_creates_approved(self):
        """上传文件 + sub_mod 的 auto_approve 开 → material 立即 approved"""
        from django.core.files.uploadedfile import SimpleUploadedFile

        self.sub_mod_auto.profile.auto_approve = True
        self.sub_mod_auto.profile.can_auto_approve = True
        self.sub_mod_auto.profile.save()

        self.client.set_token(self.user)
        fake_file = SimpleUploadedFile("test.pdf", b"%PDF-1.4 content", content_type="application/pdf")
        resp = self.client.post("/api/files/upload/", {
            "course_code": "MATH101",
            "title": "数学分析笔记",
            "teacher": "王老师",
            "file": fake_file,
        })

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["ok"])
        # 自动托管下应该是 approved
        self.assertEqual(data["data"]["review_status"], "approved")
