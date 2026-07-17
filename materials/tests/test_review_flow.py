"""
审核闭环测试

覆盖正向流程和反向流程：
  上传 → 分配 → 批准 → 可下载
  上传 → 分配 → 驳回 → 不可下载
  上传 → 异议 → 回复
"""

import os
import tempfile
from pathlib import Path
from unittest.mock import patch, mock_open

from django.test.utils import override_settings

from .helpers import BnuTestCase, create_user, create_college, create_course, create_category, create_material
from ..models import Material, ReviewComment, Notification


class ReviewFlowTest(BnuTestCase):
    """审核全流程测试"""

    def setUp(self):
        super().setUp()
        self.college = create_college("物理学", "wlx")
        self.course = create_course(
            code="PHY101", name="大学物理",
            college=self.college, course_type="major",
        )
        self.cat = create_category(name="物理类")
        self.cat.course = self.course
        self.cat.save()

        self.sub_mod.profile.moderated_sections.add(self.cat)
        self.mod.profile.managed_majors.add(self.college)

    # ── 正向流程：upload → pending → approve → download ──

    def test_approve_flow(self):
        """正向：上传待审 → 小版主批准 → review_status=approved → 可下载"""
        mat = create_material(self.course, self.user, review_status="pending")

        # 小版主批准
        self.client.set_token(self.sub_mod)
        resp = self.client.post_json(f"/api/moderation/{mat.id}/approve/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["ok"])

        # 验证状态
        mat.refresh_from_db()
        self.assertEqual(mat.review_status, "approved")
        self.assertTrue(mat.is_approved)
        self.assertEqual(mat.reviewed_by, self.sub_mod)

        # 验证通知已创建
        notif = Notification.objects.filter(
            recipient=self.user, type="approved",
        ).first()
        self.assertIsNotNone(notif)

    def test_reject_flow(self):
        """反向：上传待审 → 版主驳回 → review_status=rejected → 不可下载"""
        mat = create_material(self.course, self.user, review_status="pending")

        # 版主驳回
        self.client.set_token(self.mod)
        resp = self.client.post_json(f"/api/moderation/{mat.id}/reject/", {
            "notes": "缺少教材封面信息",
        })
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["ok"])

        # 验证状态
        mat.refresh_from_db()
        self.assertEqual(mat.review_status, "rejected")
        self.assertFalse(mat.is_approved)
        self.assertEqual(mat.review_notes, "缺少教材封面信息")

        # 验证通知已创建
        notif = Notification.objects.filter(
            recipient=self.user, type="rejected",
        ).exists()
        self.assertTrue(notif)

    @patch('pathlib.Path.exists', return_value=True)
    @patch('builtins.open', new_callable=lambda: mock_open(read_data=b"dummy"))
    def test_download_rejected_fails(self, mock_open, mock_exists):
        """已驳回的资料 → 普通用户下载 → 403"""
        mat = create_material(self.course, self.user, review_status="rejected")
        self.client.set_token(self.user)
        resp = self.client.get(f"/api/files/{mat.id}/download/")
        self.assertEqual(resp.status_code, 403)

    @patch('pathlib.Path.exists', return_value=True)
    @patch('builtins.open', new_callable=lambda: mock_open(read_data=b"dummy"))
    def test_download_approved_succeeds(self, mock_open, mock_exists):
        """已通过的资料 → 用户下载 → 200"""
        mat = create_material(self.course, self.user, review_status="approved")
        self.client.set_token(self.user)
        resp = self.client.get(f"/api/files/{mat.id}/download/")
        self.assertEqual(resp.status_code, 200)

    # ── 重复审核 ──

    def test_duplicate_approve_rejected(self):
        """已批准的不可重复批准"""
        mat = create_material(self.course, self.user, review_status="approved")
        self.client.set_token(self.mod)
        resp = self.client.post_json(f"/api/moderation/{mat.id}/approve/")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("已审核", resp.json().get("error", ""))

    # ── 审核异议 ──

    def test_review_comment_flow(self):
        """审核通过 → 版主提异议 → 另一版主回复"""
        mat = create_material(self.course, self.user, review_status="approved",
                              assigned_moderator=self.sub_mod)
        mat.reviewed_by = self.mod
        mat.save()

        # 另一个版主提异议
        self.client.set_token(self.sub_mod)
        resp = self.client.post_json(f"/api/moderation/{mat.id}/comments/", {
            "content": "这个资料需要重新评估。",
        })
        self.assertEqual(resp.status_code, 200)

        # 原审核者回复
        comment = ReviewComment.objects.filter(material=mat).first()
        self.assertIsNotNone(comment)

        self.client.set_token(self.mod)
        resp = self.client.post_json(f"/api/moderation/{mat.id}/comments/", {
            "content": "内容完整，格式规范，已通过。",
            "parent_id": comment.id,
        })
        self.assertEqual(resp.status_code, 200)

        # 验证两个评论都存在
        resp = self.client.get_json(f"/api/moderation/{mat.id}/comments/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["data"]["count"], 2)
