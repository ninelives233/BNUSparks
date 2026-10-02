"""2026-08-29 审计修复回归：XSS、上传、限流、配额、文件事务与前端契约。"""

import tempfile
from datetime import date
from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError
from django.test import SimpleTestCase, override_settings

from .helpers import (
    BnuTestCase, create_category, create_college, create_course, create_material,
)
from ..models import (
    Course, CourseCategory, CourseCreationRequest, DeletionRecord,
    DownloadQuotaReservation, Material, Notification, QaAnswer,
    QaDeleteRequest, QaQuestion, QaTag, UserProfile,
)


class QaSanitizerHardeningTest(SimpleTestCase):
    def test_entities_attributes_and_obfuscated_protocols_are_safe(self):
        from ..views.qa_helpers import _sanitize_html

        dirty = (
            '<p>1 &lt; 2 &amp; 3</p>'
            '<a href="java&#x0a;script:alert(1)" '
            'title="&quot; onmouseover=&quot;alert(2)">链接</a>'
            '<img src="https://example.test/a.png&quot; onerror=&quot;alert(3)">'
            '<svg><script>alert(4)</script></svg>'
        )
        clean = _sanitize_html(dirty)
        self.assertIn("1 &lt; 2 &amp; 3", clean)
        self.assertNotIn("javascript:", clean.lower())
        self.assertNotIn("<svg", clean.lower())
        self.assertNotIn("<script", clean.lower())
        self.assertNotIn(' onmouseover="alert', clean.lower())
        self.assertNotIn(' onerror="alert', clean.lower())
        self.assertIn("&quot; onmouseover=&quot;", clean)


class TemporaryMediaMixin:
    def setUp(self):
        super().setUp()
        self._media_tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._media_tmp.cleanup)
        self._media_override = override_settings(MEDIA_ROOT=self._media_tmp.name)
        self._media_override.enable()
        self.addCleanup(self._media_override.disable)


class UploadHardLimitTest(TemporaryMediaMixin, BnuTestCase):
    def setUp(self):
        super().setUp()
        self.college = create_college("上传学院", "upload")
        self.course = create_course("UPL001", "上传测试", self.college, "major")
        self.client.set_token(self.user)

    @override_settings(MAX_UPLOAD_FILE_SIZE=4)
    def test_binary_upload_over_limit_leaves_no_file_or_row(self):
        response = self.client.post("/api/files/upload/", {
            "course_code": self.course.code,
            "teacher": "教师",
            "file": SimpleUploadedFile("large.pdf", b"12345", "application/pdf"),
        })
        self.assertEqual(response.status_code, 413)
        self.assertFalse(Material.objects.filter(course=self.course).exists())
        self.assertEqual([p for p in Path(settings.MEDIA_ROOT).rglob("*") if p.is_file()], [])

    @override_settings(MAX_UPLOAD_FILE_SIZE=4)
    def test_text_upload_over_limit_leaves_no_file_or_row(self):
        response = self.client.post_json("/api/files/upload-text/", {
            "course_code": self.course.code,
            "teacher": "教师",
            "title": "过大文本",
            "content": "12345",
        })
        self.assertEqual(response.status_code, 413)
        self.assertFalse(Material.objects.filter(course=self.course).exists())
        self.assertEqual([p for p in Path(settings.MEDIA_ROOT).rglob("*") if p.is_file()], [])

    def test_database_failure_removes_completed_upload(self):
        with patch("materials.views.files_upload.Material.objects.create", side_effect=RuntimeError("db")):
            response = self.client.post("/api/files/upload/", {
                "course_code": self.course.code,
                "teacher": "教师",
                "file": SimpleUploadedFile("ok.pdf", b"1234", "application/pdf"),
            })
        self.assertEqual(response.status_code, 500)
        self.assertEqual([p for p in Path(settings.MEDIA_ROOT).rglob("*") if p.is_file()], [])


class AuthRateLimitTest(BnuTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.addCleanup(cache.clear)

    def test_login_is_limited_by_account(self):
        from ..views.auth import AUTH_RATE_LIMITS
        limits = {"login_ip": (99, 300), "login_account": (1, 300)}
        with patch.dict(AUTH_RATE_LIMITS, limits):
            first = self.client.post_json("/api/auth/login/", {
                "username": self.user.username, "password": "wrong",
            })
            second = self.client.post_json("/api/auth/login/", {
                "username": self.user.username, "password": "wrong",
            })
        self.assertEqual(first.status_code, 400)
        self.assertEqual(second.status_code, 429)
        self.assertIn("Retry-After", second)

    def test_register_and_forgot_password_are_limited(self):
        from ..views.auth import AUTH_RATE_LIMITS
        with patch.dict(AUTH_RATE_LIMITS, {
            "register_ip": (1, 3600), "register_account": (99, 3600),
        }):
            body = {
                "email": "new1@mail.bnu.edu.cn",
                "nickname": "n1",
                "password": "password123",
                "education": "本科",
                "college": "其他",
                "major": "其他",
            }
            self.client.post_json("/api/auth/register/", body)
            body["email"] = "new2@mail.bnu.edu.cn"
            limited = self.client.post_json("/api/auth/register/", body)
        self.assertEqual(limited.status_code, 429)

        cache.clear()
        with patch.dict(AUTH_RATE_LIMITS, {
            "forgot_ip": (99, 3600), "forgot_account": (1, 3600),
        }):
            body = {"email": "missing@mail.bnu.edu.cn"}
            self.client.post_json("/api/auth/forgot-password/", body)
            limited = self.client.post_json("/api/auth/forgot-password/", body)
        self.assertEqual(limited.status_code, 429)


class DownloadQuotaReservationTest(BnuTestCase):
    def test_reservation_deduplicates_before_download_record_is_written(self):
        from ..views import _check_download_quota

        course = create_course("QUOTA01", "配额测试")
        material = create_material(course, self.user)
        first = _check_download_quota(self.user, material)
        second = _check_download_quota(self.user, material)

        self.assertEqual(first[:2], (True, 14))
        self.assertEqual(second[:2], (True, 14))
        profile = UserProfile.objects.get(user=self.user)
        self.assertEqual(profile.daily_download_count, 1)
        self.assertEqual(
            DownloadQuotaReservation.objects.filter(
                user=self.user, material=material, quota_date=date.today(),
            ).count(),
            1,
        )

    def test_denied_download_does_not_leave_reservation(self):
        from ..views import _check_download_quota

        course = create_course("QUOTA02", "配额已满")
        material = create_material(course, self.user)
        self.user.profile.daily_download_count = 15
        self.user.profile.last_download_date = date.today()
        self.user.profile.save(update_fields=["daily_download_count", "last_download_date"])

        allowed, remaining, _ = _check_download_quota(self.user, material)
        self.assertFalse(allowed)
        self.assertEqual(remaining, 0)
        self.assertFalse(DownloadQuotaReservation.objects.filter(material=material).exists())


class DeleteFilesystemConsistencyTest(TemporaryMediaMixin, BnuTestCase):
    def setUp(self):
        super().setUp()
        self.college = create_college("删除学院", "delete")
        self.course = create_course("DEL001", "删除测试", self.college, "major")
        self.mod.profile.managed_majors.add(self.college)

    def _material_with_file(self):
        material = create_material(self.course, self.user, review_status="approved")
        path = Path(settings.MEDIA_ROOT) / material.file_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"content")
        return material, path

    def test_stage_failure_keeps_database_and_original_file(self):
        material, path = self._material_with_file()
        self.client.set_token(self.mod)
        with patch("materials.views.utils_trash.shutil.move", side_effect=OSError("disk")):
            response = self.client.delete_json(f"/api/files/{material.id}/delete/")
        self.assertEqual(response.status_code, 500)
        self.assertTrue(Material.objects.filter(id=material.id).exists())
        self.assertTrue(path.is_file())
        self.assertFalse(DeletionRecord.objects.filter(material_id=material.id).exists())

    def test_database_failure_restores_staged_file(self):
        material, path = self._material_with_file()
        self.client.set_token(self.mod)
        with patch.object(Material, "delete", side_effect=RuntimeError("db")):
            response = self.client.delete_json(f"/api/files/{material.id}/delete/")
        self.assertEqual(response.status_code, 500)
        self.assertTrue(Material.objects.filter(id=material.id).exists())
        self.assertTrue(path.is_file())
        self.assertFalse(DeletionRecord.objects.filter(material_id=material.id).exists())

    def test_restore_database_failure_returns_file_to_trash(self):
        material, _path = self._material_with_file()
        self.client.set_token(self.mod)
        deleted = self.client.delete_json(f"/api/files/{material.id}/delete/")
        self.assertEqual(deleted.status_code, 200)
        record = DeletionRecord.objects.get(material_id=material.id)
        staged = Path(settings.MEDIA_ROOT) / record.trash_path
        self.assertTrue(staged.is_file())

        self.client.set_token(self.admin)
        with patch("materials.views.operations_records.Material.objects.create", side_effect=RuntimeError("db")):
            restored = self.client.post_json(f"/api/moderation/deletions/{record.id}/restore/")
        self.assertEqual(restored.status_code, 500)
        record.refresh_from_db()
        self.assertFalse(record.is_restored)
        self.assertTrue(staged.is_file())
        self.assertFalse(Material.objects.filter(id=material.id).exists())

    def test_batch_delete_notifies_from_predelete_snapshot(self):
        material, _path = self._material_with_file()
        self.client.set_token(self.admin)
        response = self.client.post_json("/api/files/batch-delete/", {
            "file_ids": [material.id], "reason": "重复资料",
        })
        self.assertEqual(response.status_code, 200)
        self.assertTrue(Notification.objects.filter(
            recipient=self.user,
            type=Notification.Type.FILE_DELETED,
            title="你的资料被管理员批量删除",
        ).exists())


class CourseFileMigrationConsistencyTest(TemporaryMediaMixin, BnuTestCase):
    def test_request_approval_move_failure_rolls_back_everything(self):
        root = create_category("通识课")
        parent = create_category("外语", parent=root)
        self.mod.profile.can_moderate_general = True
        self.mod.profile.save(update_fields=["can_moderate_general"])

        self.client.set_token(self.user)
        created = self.client.post_json("/api/courses/request/", {
            "course_type": "general", "course_name": "迁移测试",
            "course_code": "MOV001", "general_category_id": parent.id,
        })
        request_id = created.json()["data"]["id"]
        uploaded = self.client.post(
            f"/api/courses/request/{request_id}/files/",
            {"file": SimpleUploadedFile("notes.pdf", b"notes", "application/pdf")},
            **self.client.defaults,
        )
        material = Material.objects.get(id=uploaded.json()["data"]["id"])
        original = Path(settings.MEDIA_ROOT) / material.file_path
        self.assertTrue(original.is_file())

        self.client.set_token(self.mod)
        with patch("materials.views.course_requests.shutil.move", side_effect=OSError("disk")):
            response = self.client.post_json(
                f"/api/moderation/course-requests/{request_id}/approve/"
            )
        self.assertEqual(response.status_code, 500)
        request_row = CourseCreationRequest.objects.get(id=request_id)
        material.refresh_from_db()
        self.assertEqual(request_row.status, CourseCreationRequest.Status.PENDING)
        self.assertIsNone(material.course_id)
        self.assertTrue(original.is_file())
        self.assertFalse(Course.objects.filter(code="MOV001").exists())
        self.assertFalse(CourseCategory.objects.filter(parent=parent, name="迁移测试").exists())

    def test_course_merge_renames_conflicting_files_without_aliasing(self):
        college = create_college("合并学院", "merge")
        old = create_course("OLD001", "旧课程", college, "major")
        target = create_course("TGT001", "目标课程", college, "major")
        root = create_category("专业课")
        college_node = create_category("合并学院", parent=root)
        major = create_category("专业", parent=college_node)
        category = create_category("旧课程", parent=major, course=old)
        self.mod.profile.managed_majors.add(college)

        old_material = create_material(old, self.user, review_status="approved")
        target_material = create_material(target, self.user, review_status="approved")
        old_path = Path(settings.MEDIA_ROOT) / old_material.file_path
        target_path = Path(settings.MEDIA_ROOT) / target_material.file_path
        old_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        old_path.write_bytes(b"old")
        target_path.write_bytes(b"target")

        self.client.set_token(self.mod)
        response = self.client.post_json(f"/api/folders/{category.id}/set-course/", {
            "course_code": target.code,
            "action_id": "merge",
            "target_course_id": target.id,
        })
        self.assertEqual(response.status_code, 200, response.content)
        old_material.refresh_from_db()
        target_material.refresh_from_db()
        self.assertEqual(old_material.course_id, target.id)
        self.assertNotEqual(old_material.file_path, target_material.file_path)
        self.assertEqual((Path(settings.MEDIA_ROOT) / old_material.file_path).read_bytes(), b"old")
        self.assertEqual((Path(settings.MEDIA_ROOT) / target_material.file_path).read_bytes(), b"target")


class ConcurrencyInvariantTest(BnuTestCase):
    def setUp(self):
        super().setUp()
        self.tag_l1 = QaTag.objects.create(name="并发一级", level=1)
        self.tag_l2 = QaTag.objects.create(name="并发二级", level=2)
        self.question = QaQuestion.objects.create(
            title="并发问题", content="<p>x</p>", author=self.user,
            tag_l1=self.tag_l1, tag_l2=self.tag_l2,
        )

    def test_database_rejects_two_accepted_answers_for_one_question(self):
        QaAnswer.objects.create(
            question=self.question, author=self.admin, content="<p>甲</p>", is_accepted=True,
        )
        with self.assertRaises(IntegrityError):
            QaAnswer.objects.create(
                question=self.question, author=self.mod, content="<p>乙</p>", is_accepted=True,
            )

    def test_delete_request_unique_race_returns_duplicate_instead_of_500(self):
        from ..views.qa_user import _record_delete_request

        with patch(
            "materials.views.qa_user.QaDeleteRequest.objects.create",
            side_effect=IntegrityError("concurrent insert"),
        ):
            row, created = _record_delete_request(
                "question", self.question.id, self.user, "理由",
                auto_approved=False, approved_immediately=False,
            )
        self.assertIsNone(row)
        self.assertFalse(created)
        self.assertFalse(QaDeleteRequest.objects.exists())


class DeploymentHardeningContractTest(SimpleTestCase):
    def test_tracked_deployment_helpers_fail_closed_without_printing_secrets(self):
        root = Path(settings.BASE_DIR)
        template = (root / "deploy.sh.template").read_text(encoding="utf-8")
        verify = (root / "scripts/deploy_verify.sh").read_text(encoding="utf-8")
        audit = (root / "scripts/security-audit.sh").read_text(encoding="utf-8")

        self.assertIn("set -Eeuo pipefail", verify)
        self.assertIn("set -Eeuo pipefail", audit)
        self.assertIn("StrictHostKeyChecking=yes", audit)
        self.assertNotIn("StrictHostKeyChecking=no", audit)
        self.assertNotIn("eval ", verify)
        self.assertNotIn('BASE_URL="${1:-', verify)
        self.assertIn("example.invalid", verify)
        self.assertNotIn("sshpass -p", template)
        self.assertNotRegex(audit, r"\bcat\s+[^\n]*\.env")
        self.assertNotRegex(audit, r"\bcat\s+[^\n]*authorized_keys")


class FrontendAuditContractTest(SimpleTestCase):
    def test_auth_route_and_accessibility_contracts_present(self):
        root = Path(settings.BASE_DIR)
        utils = (root / "public/js/utils.js").read_text(encoding="utf-8")
        auth = (root / "public/js/auth.js").read_text(encoding="utf-8")
        app = (root / "public/js/app.js").read_text(encoding="utf-8")
        html = (root / "public/index.html").read_text(encoding="utf-8")
        css = (root / "public/css/components.css").read_text(encoding="utf-8")

        self.assertIn("function clearAuthToken()", utils)
        self.assertIn("clearAuthToken();", auth)
        self.assertIn("Object.assign({ _bnusparks: true }, route)", app)
        # S01：回答编辑路径 id=aid，回答创建路径 id=所属问题 qid
        self.assertIn("cm[segs[3] === 'edit' ? 'aid' : 'qid']", utils)
        # F05：问题详情独立地址 /qa/questions/{id}
        self.assertIn("'/qa/questions/' + state.qaId", utils)
        self.assertIn('role="dialog" aria-modal="true"', html)
        self.assertIn('class="skip-link"', html)
        self.assertIn(":focus-visible", css)

    def test_qa_visual_redesign_contracts_present(self):
        """2026-10-02 问答区视觉重构的结构契约（docs/问答区视觉重构设计规范-2026-10-02.md）"""
        root = Path(settings.BASE_DIR)
        qa = (root / "public/js/qa.js").read_text(encoding="utf-8")
        css = (root / "public/css/qa.css").read_text(encoding="utf-8")
        editor = (root / "public/js/qa-editor.js").read_text(encoding="utf-8")
        html = (root / "public/index.html").read_text(encoding="utf-8")

        # §5 工具栏：接口可靠总数展示 + 文字式排序（aria-pressed）+ 独立筛选面板
        self.assertIn('id="qaToolbarTotal"', qa)
        self.assertIn("'latest', '最新提问'", qa)
        self.assertIn('id="qaFilterPanel"', qa)
        self.assertNotIn('id="qaFilterBtn"', html)  # 筛选按钮移入工具栏，页头只留提问入口
        self.assertIn("课程、选课与校园生活中的问题", html)

        # §6 列表：共享容器条目 + 统计列，日期到日，不再整卡可点
        self.assertIn("qa-item-stats", qa)
        self.assertIn("_qaFormatDay", qa)
        self.assertNotIn('class="qa-card"', qa)

        # §7 精选问答：紧凑标题区，默认两项，其余可展开/收起（aria-expanded）
        self.assertIn("toggleQaPinned", qa)
        self.assertIn("展开其余 ", qa)

        # §8/§9 详情：单张阅读底板，回答全部展开——折叠开关、inert 同步、固定裁切高度必须移除
        self.assertIn("qa-detail-mode", qa)
        self.assertNotIn("qa-answer-toggle", qa)
        self.assertNotIn("function qaToggleAnswer(", qa)
        self.assertNotIn("_qaSyncAnswerCollapse", qa)
        self.assertNotIn(".qa-answer-toggle", css)
        self.assertNotIn("7.4em", css)
        # §12：回答锚点避开固定顶栏
        self.assertIn("scroll-margin-top", css)

        # §10：展示层合并连续纯空白段落（不含图片/链接的空 <p>）
        self.assertIn("纯空白段落", editor)
