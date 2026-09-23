"""
审核路由 / 辖区 / 自动托管 修复测试（v=165 评审修复）

覆盖：
  D1  pending 列表只清非管理员指派（版主/小版主指派保留）
  D3  reassign 目标限版主/小版主 + 通知新指派人
  D4  _check_auto_approve 版主分支补 moderated_sections 口径
  D5  approve 原子条件更新 + 审核后重置指派 + 重复审核拦截
  D6  batch-approve 通知上传者
  D7/D8 超管授权 + 版主自开自动托管
  D9  不能审核自己上传的资料
  D10 删除记录可见性补「自己删除的」
  D11 未批准资料详情仅上传者/辖区管理员可见
  D15 set_role 无效 M2M id 不 500
  D16 无效 material_type_id 返回 400
"""

import tempfile
from datetime import timedelta

from django.test.utils import override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from .helpers import (
    BnuTestCase, create_user, create_college, create_course,
    create_category, create_material,
)
from ..models import (
    UserProfile, CourseType, Notification, DeletionRecord, Material,
)


class PendingAssignmentCleanupTest(BnuTestCase):
    """D1：pending 列表加载只清非管理员指派"""

    def setUp(self):
        super().setUp()
        self.college = create_college("数学科学学院", "math")
        self.major_course = create_course(
            code="MATH101", name="数学分析",
            college=self.college, course_type="major",
        )
        self.cat_math = create_category(name="数学类")
        self.cat_math.course = self.major_course
        self.cat_math.save()

    def test_pending_keeps_moderator_assignment(self):
        """指派给版主的 pending 资料，列表加载后指派保留"""
        self.mod.profile.managed_majors.add(self.college)
        material = create_material(
            self.major_course, self.user,
            review_status="pending", assigned_moderator=self.mod,
        )
        self.client.set_token(self.admin)
        self.client.get_json("/api/moderation/pending/")
        material.refresh_from_db()
        self.assertEqual(material.assigned_moderator, self.mod)

    def test_pending_keeps_submod_assignment(self):
        """指派给小版主的 pending 资料，列表加载后指派保留"""
        self.sub_mod.profile.moderated_sections.add(self.cat_math)
        material = create_material(
            self.major_course, self.user,
            review_status="pending", assigned_moderator=self.sub_mod,
        )
        self.client.set_token(self.admin)
        self.client.get_json("/api/moderation/pending/")
        material.refresh_from_db()
        self.assertEqual(material.assigned_moderator, self.sub_mod)

    def test_pending_clears_plain_user_assignment(self):
        """指派给普通用户的失效指派（历史上误 reassign 造成），列表加载后被清"""
        material = create_material(
            self.major_course, self.user,
            review_status="pending", assigned_moderator=self.user,
        )
        self.client.set_token(self.admin)
        self.client.get_json("/api/moderation/pending/")
        material.refresh_from_db()
        self.assertIsNone(material.assigned_moderator)


class ReassignValidationTest(BnuTestCase):
    """D3：reassign 目标限版主/小版主 + 通知"""

    def setUp(self):
        super().setUp()
        self.college = create_college("数学科学学院", "math")
        self.major_course = create_course(
            code="MATH101", name="数学分析",
            college=self.college, course_type="major",
        )

    def test_reassign_rejects_plain_user(self):
        material = create_material(self.major_course, self.user, review_status="pending")
        self.client.set_token(self.admin)
        resp = self.client.post_json(
            f"/api/moderation/{material.id}/reassign/",
            {"assigned_moderator": self.user.id},
        )
        self.assertEqual(resp.status_code, 400)

    def test_reassign_accepts_moderator_and_notifies(self):
        material = create_material(self.major_course, self.user, review_status="pending")
        self.client.set_token(self.admin)
        resp = self.client.post_json(
            f"/api/moderation/{material.id}/reassign/",
            {"assigned_moderator": self.mod.id},
        )
        self.assertEqual(resp.status_code, 200)
        material.refresh_from_db()
        self.assertEqual(material.assigned_moderator, self.mod)
        self.assertTrue(Notification.objects.filter(
            recipient=self.mod, type=Notification.Type.OPERATION,
        ).exists())

    def test_reassign_accepts_submod(self):
        material = create_material(self.major_course, self.user, review_status="pending")
        self.client.set_token(self.admin)
        resp = self.client.post_json(
            f"/api/moderation/{material.id}/reassign/",
            {"assigned_moderator": self.sub_mod.id},
        )
        self.assertEqual(resp.status_code, 200)
        material.refresh_from_db()
        self.assertEqual(material.assigned_moderator, self.sub_mod)


class AutoApproveScopeAlignmentTest(BnuTestCase):
    """D4：_check_auto_approve 版主分支补 moderated_sections 口径"""

    def setUp(self):
        super().setUp()
        self.gen_course = create_course(
            code="GEN0001", name="通识英语",
            college=None, course_type="general",
        )

    def test_mod_auto_approve_via_moderated_sections(self):
        """版主仅靠 moderated_sections 挂 GEN 板块 + auto_approve → 命中代审"""
        cat_gen = create_category(name="通识英语类", course_text="GEN0001")
        self.mod.profile.moderated_sections.add(cat_gen)
        self.mod.profile.auto_approve = True
        self.mod.profile.save()

        from ..views import _check_auto_approve
        self.assertEqual(_check_auto_approve(self.gen_course), self.mod)

    @override_settings(MEDIA_ROOT=tempfile.mkdtemp())
    def test_upload_general_auto_approved_by_section_moderator(self):
        """普通用户上传 GEN 课 → 命中「仅靠板块」的版主自动托管 → 直接 approved"""
        cat_gen = create_category(name="通识英语类", course_text="GEN0001")
        self.mod.profile.moderated_sections.add(cat_gen)
        self.mod.profile.auto_approve = True
        self.mod.profile.save()

        self.client.set_token(self.user)
        fake_file = SimpleUploadedFile("t.pdf", b"%PDF-1.4 content", content_type="application/pdf")
        resp = self.client.post("/api/files/upload/", {
            "course_code": "GEN0001", "title": "英语笔记",
            "teacher": "王老师", "file": fake_file,
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["data"]["review_status"], "approved")


class ApproveAtomicityTest(BnuTestCase):
    """D5：approve 原子条件更新 + 重置指派 + 重复审核拦截；D9 自审拦截"""

    def setUp(self):
        super().setUp()
        self.college = create_college("数学科学学院", "math")
        self.major_course = create_course(
            code="MATH101", name="数学分析",
            college=self.college, course_type="major",
        )
        self.mod.profile.managed_majors.add(self.college)

    def test_approve_clears_assignment_and_blocks_repeat(self):
        material = create_material(
            self.major_course, self.user,
            review_status="pending", assigned_moderator=self.mod,
        )
        self.client.set_token(self.mod)
        r1 = self.client.post_json(f"/api/moderation/{material.id}/approve/")
        self.assertEqual(r1.status_code, 200)
        material.refresh_from_db()
        self.assertEqual(material.review_status, "approved")
        self.assertIsNone(material.assigned_moderator, "审核后应清空指派字段")

        r2 = self.client.post_json(f"/api/moderation/{material.id}/approve/")
        self.assertEqual(r2.status_code, 400)

    def test_reject_clears_assignment(self):
        material = create_material(
            self.major_course, self.user,
            review_status="pending", assigned_moderator=self.mod,
        )
        self.client.set_token(self.mod)
        resp = self.client.post_json(
            f"/api/moderation/{material.id}/reject/", {"notes": "重复"}
        )
        self.assertEqual(resp.status_code, 200)
        material.refresh_from_db()
        self.assertEqual(material.review_status, "rejected")
        self.assertIsNone(material.assigned_moderator)

    def test_cannot_approve_own_upload(self):
        """D9：上传者本人不可审核自己的上传（课程申请随附文件路径）"""
        material = create_material(self.major_course, self.mod, review_status="pending")
        self.client.set_token(self.mod)
        resp = self.client.post_json(f"/api/moderation/{material.id}/approve/")
        self.assertEqual(resp.status_code, 400)


class BatchApproveNotificationTest(BnuTestCase):
    """D6：batch-approve 通知上传者"""

    def setUp(self):
        super().setUp()
        self.college = create_college("数学科学学院", "math")
        self.major_course = create_course(
            code="MATH101", name="数学分析",
            college=self.college, course_type="major",
        )
        self.mod.profile.managed_majors.add(self.college)

    def test_batch_approve_notifies_uploader(self):
        create_material(self.major_course, self.user, review_status="pending")
        create_material(self.major_course, self.user, review_status="pending")
        self.client.set_token(self.mod)
        resp = self.client.post_json("/api/moderation/batch-approve/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["data"]["approved_count"], 2)
        notif = Notification.objects.filter(
            recipient=self.user, type=Notification.Type.APPROVED,
        ).first()
        self.assertIsNotNone(notif)
        # v175.2：update 前取数，聚合通知显示真实份数而非「0 份」
        self.assertIn("2 份", notif.message)


class BackfillNotificationWindowTest(BnuTestCase):
    """v175.2：courses.py 浏览时补发「已通过审核」通知仅限 48h 内批准的近期资料

    根因：老种子资料（入库直置 approved、从未走过审批流）被版主一键过审后
    reviewed_by 被写入，补发逻辑在总管理浏览课程页时补发通知；而「清空通知」
    是真删除，守卫失效后每次浏览都再补一遍。时间窗限定后老资料永不补发。
    """

    def setUp(self):
        super().setUp()
        self.college = create_college("经济与工商管理学院", "econ")
        self.major_course = create_course(
            code="ECON101", name="经济学原理",
            college=self.college, course_type="major",
        )

    def _make_material(self, reviewed_at, reviewed_by=None):
        """上传者为 self.user，审核人为 reviewed_by（默认 self.mod）"""
        m = create_material(self.major_course, self.user, review_status="approved")
        # update 覆盖 created_at/reviewed_at（绕过 auto_now_add）
        Material.objects.filter(pk=m.pk).update(
            created_at=reviewed_at - timedelta(hours=1),
            reviewed_by=reviewed_by or self.mod,
            reviewed_at=reviewed_at,
        )
        return Material.objects.get(pk=m.pk)

    def _browse_files(self):
        self.client.set_token(self.user)
        return self.client.get(f"/api/courses/{self.major_course.code}/files/")

    def test_old_approval_no_backfill(self):
        """一个多月前批准的种子资料：浏览课程页不补发通知（核心回归）"""
        m = self._make_material(timezone.now() - timedelta(days=30))
        resp = self._browse_files()
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(Notification.objects.filter(
            recipient=self.user, material=m, type=Notification.Type.APPROVED,
        ).exists())

    def test_recent_approval_gets_backfill(self):
        """48h 内被他人批准的近期资料：浏览课程页补发一次通知"""
        m = self._make_material(timezone.now() - timedelta(hours=1))
        resp = self._browse_files()
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(Notification.objects.filter(
            recipient=self.user, material=m, type=Notification.Type.APPROVED,
        ).exists())

    def test_backfill_only_once_per_material(self):
        """同一材料同用户只补发一次（存在通知即不再补）"""
        m = self._make_material(timezone.now() - timedelta(hours=1))
        self._browse_files()
        self._browse_files()
        self.assertEqual(Notification.objects.filter(
            recipient=self.user, material=m, type=Notification.Type.APPROVED,
        ).count(), 1)

    def test_self_review_never_backfills(self):
        """审核人=上传者本人：永不补发（种子自审场景）"""
        m = self._make_material(timezone.now() - timedelta(hours=1), reviewed_by=self.user)
        self._browse_files()
        self.assertFalse(Notification.objects.filter(
            recipient=self.user, material=m, type=Notification.Type.APPROVED,
        ).exists())


class AutoApproveGateTest(BnuTestCase):
    """D7/D8：超管授权 + 版主自开自动托管"""

    def test_admin_grant_can_auto_approve(self):
        self.client.set_token(self.admin)
        resp = self.client.post_json(
            f"/api/admin/users/{self.mod.id}/auto-approve/",
            {"can_auto_approve": True},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["data"]["can_auto_approve"])
        self.mod.profile.refresh_from_db()
        self.assertTrue(self.mod.profile.can_auto_approve)

    def test_admin_revoke_forces_auto_approve_off(self):
        self.mod.profile.can_auto_approve = True
        self.mod.profile.auto_approve = True
        self.mod.profile.save()
        self.client.set_token(self.admin)
        resp = self.client.post_json(
            f"/api/admin/users/{self.mod.id}/auto-approve/",
            {"can_auto_approve": False},
        )
        self.assertEqual(resp.status_code, 200)
        self.mod.profile.refresh_from_db()
        self.assertFalse(self.mod.profile.can_auto_approve)
        self.assertFalse(self.mod.profile.auto_approve, "回收授权应强制关闭自动托管")

    def test_self_toggle_requires_grant(self):
        self.client.set_token(self.mod)
        resp = self.client.post_json("/api/moderation/auto-approve/")
        self.assertEqual(resp.status_code, 403)

    def test_self_toggle_after_grant(self):
        self.mod.profile.can_auto_approve = True
        self.mod.profile.save()
        self.client.set_token(self.mod)
        resp = self.client.post_json("/api/moderation/auto-approve/")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["data"]["auto_approve"])
        self.mod.profile.refresh_from_db()
        self.assertTrue(self.mod.profile.auto_approve)

    def test_plain_user_cannot_self_toggle(self):
        self.client.set_token(self.user)
        resp = self.client.post_json("/api/moderation/auto-approve/")
        self.assertEqual(resp.status_code, 400)


class ObjectionWindowTest(BnuTestCase):
    """v=182：异议窗口 24h→48h（can_object 边界）

    用户拍板只放宽窗口、不加后端 POST 校验：can_object 在 48h 内为 true（前端显示
    「异议」可提出），超过 48h 为 false（前端显示「查看异议」只读）。
    """

    def setUp(self):
        super().setUp()
        self.college = create_college("数学科学学院", "math")
        self.major_course = create_course(
            code="MATH102", name="数学分析",
            college=self.college, course_type="major",
        )

    def _approved_by_mod(self, reviewed_at):
        m = create_material(self.major_course, self.user, review_status="approved")
        # update 覆盖 reviewed_at/reviewed_by（绕过 auto_now_add）
        Material.objects.filter(pk=m.pk).update(
            reviewed_by=self.mod,
            reviewed_at=reviewed_at,
        )
        return m

    def _can_object(self, material):
        self.client.set_token(self.admin)
        resp = self.client.get_json("/api/moderation/history/")
        self.assertEqual(resp.status_code, 200)
        items = resp.json()["data"]["items"]
        item = next((x for x in items if x["id"] == material.id), None)
        self.assertIsNotNone(item, "审核历史应包含该资料")
        return item["can_object"]

    def test_can_object_true_within_48h(self):
        """48h 内其他管理员审核通过的记录 → 可异议"""
        m = self._approved_by_mod(timezone.now() - timedelta(hours=25))
        self.assertTrue(self._can_object(m))

    def test_can_object_false_beyond_48h(self):
        """超过 48h（49h 前审核）→ 不可异议"""
        m = self._approved_by_mod(timezone.now() - timedelta(hours=49))
        self.assertFalse(self._can_object(m))



class DeletionVisibilityTest(BnuTestCase):
    """D10：删除记录可见性补「自己删除的」"""

    def test_submod_sees_own_deletion_record(self):
        DeletionRecord.objects.create(
            material_id=999, title="记录", file_name="f.pdf", file_size=1,
            course_code="UNKNOWN", course_name="未知课程",
            uploader_name="某学生", deleted_by=self.sub_mod,
        )
        self.client.set_token(self.sub_mod)
        resp = self.client.get_json("/api/moderation/deletions/")
        self.assertEqual(resp.status_code, 200)
        ids = [r["material_id"] for r in resp.json()["data"]["items"]]
        self.assertIn(999, ids)


class FileDetailGateTest(BnuTestCase):
    """D11：未批准资料详情仅上传者/辖区管理员可见"""

    def setUp(self):
        super().setUp()
        self.college = create_college("数学科学学院", "math")
        self.major_course = create_course(
            code="MATH101", name="数学分析",
            college=self.college, course_type="major",
        )

    def test_pending_detail_hidden_from_others(self):
        material = create_material(self.major_course, self.user, review_status="pending")
        other = create_user("other1", role="user", first_name="路人")
        self.client.set_token(other)
        resp = self.client.get_json(f"/api/files/{material.id}/")
        self.assertEqual(resp.status_code, 404)

    def test_pending_detail_visible_to_uploader(self):
        material = create_material(self.major_course, self.user, review_status="pending")
        self.client.set_token(self.user)
        resp = self.client.get_json(f"/api/files/{material.id}/")
        self.assertEqual(resp.status_code, 200)


class RobustnessTest(BnuTestCase):
    """D15/D16：无效 M2M id 与无效资料类型不 500"""

    def setUp(self):
        super().setUp()
        self.college = create_college("数学科学学院", "math")
        self.major_course = create_course(
            code="MATH101", name="数学分析",
            college=self.college, course_type="major",
        )

    def test_set_role_invalid_m2m_ids_no_500(self):
        self.client.set_token(self.admin)
        resp = self.client.post_json(
            f"/api/admin/users/{self.mod.id}/role/",
            {"role": "moderator", "managed_majors": [999999], "moderated_sections": []},
        )
        self.assertEqual(resp.status_code, 200)
        self.mod.profile.refresh_from_db()
        self.assertEqual(list(self.mod.profile.managed_majors.all()), [])

    @override_settings(MEDIA_ROOT=tempfile.mkdtemp())
    def test_upload_invalid_material_type_returns_400(self):
        self.client.set_token(self.user)
        fake_file = SimpleUploadedFile("t.pdf", b"%PDF-1.4 content", content_type="application/pdf")
        resp = self.client.post("/api/files/upload/", {
            "course_code": "MATH101", "title": "笔记",
            "teacher": "王老师", "material_type_id": "999999",
            "file": fake_file,
        })
        self.assertEqual(resp.status_code, 400)
