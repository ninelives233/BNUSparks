"""校内文件加速站（仅下载镜像）：票据、内部授权、任务与队列回归。"""

import hashlib
import json
import tempfile
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone

from .helpers import BnuTestCase, create_category, create_college, create_course, create_material
from ..models import Course, DownloadRecord, Material, MaterialSyncTask, UserProfile
from ..services import accelerator as accel
from ..services.course_codes import adopt_course_code


ACCEL_SETTINGS = dict(
    ACCELERATOR_BASE_URL="https://bnu.jort.top",
    ACCELERATOR_INTERNAL_SECRET="test-accelerator-secret",
    ACCELERATOR_TICKET_TTL=600,
)


class AcceleratorTestBase(BnuTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.college = create_college("文学院", "wen")
        self.course = create_course(
            "CHI22008", "中国古典文献学", college=self.college, course_type="major",
        )
        self.root = create_category("专业课")
        self.college_node = create_category("文学院", parent=self.root)
        self.leaf = create_category("汉语言文学", parent=self.college_node, course=self.course)
        self.client.set_token(self.user)

    def _material(self, status="approved"):
        material = create_material(self.course, self.user, review_status=status)
        path = Path(settings.MEDIA_ROOT) / material.file_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"%PDF-1.4 accelerator test")
        material.file_size = path.stat().st_size
        material.save(update_fields=["file_size"])
        return material

    def _internal_headers(self):
        return {
            "HTTP_X_ACCELERATOR_SECRET": "test-accelerator-secret",
            "HTTP_AUTHORIZATION": f"Bearer {self._token()}",
        }

    def _token(self):
        from .helpers import _make_jwt
        return _make_jwt(self.user.id)

    def _internal_post(self, path, payload, token=None):
        return self.client.post(
            path,
            data=json.dumps(payload),
            content_type="application/json",
            HTTP_X_ACCELERATOR_SECRET="test-accelerator-secret",
            HTTP_AUTHORIZATION=f"Bearer {token or self._token()}",
        )


@override_settings(**ACCEL_SETTINGS)
class AcceleratorTicketTest(AcceleratorTestBase):
    def test_config_reports_enabled(self):
        resp = self.client.get("/api/accelerator/config/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()["data"]
        self.assertTrue(data["enabled"])
        self.assertEqual(data["base_url"], "https://bnu.jort.top")

    def test_ticket_respects_review_and_uploader(self):
        from .helpers import create_user

        pending = self._material("pending")
        # 上传者本人可取得待审资料票据（校内可下载自己的文件）。
        resp = self.client.post(f"/api/files/{pending.id}/accelerate-ticket/")
        self.assertEqual(resp.status_code, 200, resp.content)

        other = create_user("other_accel", role="user", first_name="其他用户")
        self.client.set_token(other)
        resp = self.client.post(f"/api/files/{pending.id}/accelerate-ticket/")
        self.assertEqual(resp.status_code, 403)

        self.client.set_token(self.user)
        approved = self._material("approved")
        resp = self.client.post(f"/api/files/{approved.id}/accelerate-ticket/")
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()["data"]
        self.assertTrue(data["url"].startswith("https://bnu.jort.top/f/"))
        self.assertIn("file_on_campus", data)
        # 预览已收敛到主站，票据不再携带 preview_url。
        self.assertNotIn("preview_url", data)
        self.assertNotIn("preview", data)

    def test_ticket_requires_existing_public_file(self):
        material = create_material(self.course, self.user, review_status="approved")
        path = Path(settings.MEDIA_ROOT) / material.file_path
        if path.exists():
            path.unlink()
        resp = self.client.post(f"/api/files/{material.id}/accelerate-ticket/")
        self.assertEqual(resp.status_code, 409)

    def test_internal_authorize_counts_once_and_rejects_bad_secret(self):
        mat = self._material("approved")
        ticket = self.client.post(
            f"/api/files/{mat.id}/accelerate-ticket/",
        ).json()["data"]["ticket"]

        bad = self.client.get(
            "/api/internal/accelerator/authorize/",
            {"ticket": ticket},
            HTTP_X_ACCELERATOR_SECRET="wrong",
        )
        self.assertEqual(bad.status_code, 404)

        first = self.client.get(
            "/api/internal/accelerator/authorize/",
            {"ticket": ticket},
            HTTP_X_ACCELERATOR_SECRET="test-accelerator-secret",
        )
        self.assertEqual(first.status_code, 204, first.content)
        self.assertEqual(first["X-Accel-File-Id"], str(mat.id))
        self.assertTrue(first["X-Accel-Content-Disposition"].startswith("attachment;"))
        self.assertEqual(first["X-Accel-Storage-Name"], f"{mat.id}.pdf")
        self.assertEqual(
            DownloadRecord.objects.filter(user=self.user, material=mat).count(), 1,
        )
        UserProfile.objects.get(user=self.user).refresh_from_db()
        self.assertEqual(UserProfile.objects.get(user=self.user).daily_download_count, 1)

        # 同一票据重试/Range 请求不重复计数。
        second = self.client.get(
            "/api/internal/accelerator/authorize/",
            {"ticket": ticket},
            HTTP_X_ACCELERATOR_SECRET="test-accelerator-secret",
        )
        self.assertEqual(second.status_code, 204)
        self.assertEqual(
            DownloadRecord.objects.filter(user=self.user, material=mat).count(), 1,
        )
        self.assertEqual(UserProfile.objects.get(user=self.user).daily_download_count, 1)

    def test_ticket_revoked_by_token_version(self):
        mat = self._material("approved")
        ticket = self.client.post(
            f"/api/files/{mat.id}/accelerate-ticket/",
        ).json()["data"]["ticket"]
        profile = UserProfile.objects.get(user=self.user)
        profile.token_version += 1
        profile.save(update_fields=["token_version"])

        resp = self.client.get(
            "/api/internal/accelerator/authorize/",
            {"ticket": ticket},
            HTTP_X_ACCELERATOR_SECRET="test-accelerator-secret",
        )
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(
            DownloadRecord.objects.filter(user=self.user, material=mat).count(), 0,
        )

    def test_public_aticket_download_fallback(self):
        mat = self._material("approved")
        ticket = self.client.post(
            f"/api/files/{mat.id}/accelerate-ticket/",
        ).json()["data"]["ticket"]

        resp = self.client.get(f"/api/files/{mat.id}/download/", {"aticket": ticket})
        self.assertEqual(resp.status_code, 200)
        self.assertGreater(len(b"".join(resp.streaming_content)), 0)
        self.assertEqual(
            DownloadRecord.objects.filter(user=self.user, material=mat).count(), 1,
        )

    def test_internal_source_download(self):
        mat = self._material("approved")
        resp = self.client.get(
            f"/api/internal/accelerator/files/{mat.id}/source/",
            HTTP_X_ACCELERATOR_SECRET="test-accelerator-secret",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            b"".join(resp.streaming_content),
            (Path(settings.MEDIA_ROOT) / mat.file_path).read_bytes(),
        )


@override_settings(**ACCEL_SETTINGS)
class AcceleratorTaskTest(AcceleratorTestBase):
    def _headers(self):
        return {"HTTP_X_ACCELERATOR_SECRET": "test-accelerator-secret"}

    def _queued_task(self):
        mat = self._material("approved")
        task = accel.queue_public_to_campus(mat)
        self.assertIsNotNone(task)
        return mat, task

    def test_task_lifecycle_marks_synced(self):
        mat, task = self._queued_task()
        digest = hashlib.sha256((Path(settings.MEDIA_ROOT) / mat.file_path).read_bytes()).hexdigest()

        listed = self.client.get("/api/internal/accelerator/tasks/", **self._headers())
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()["data"]["tasks"]), 1)

        started = self.client.post(
            f"/api/internal/accelerator/tasks/{task.id}/start/", data="{}",
            content_type="application/json", **self._headers(),
        )
        self.assertEqual(started.status_code, 200, started.content)
        progress = self.client.post(
            f"/api/internal/accelerator/tasks/{task.id}/progress/",
            data=json.dumps({"bytes_done": 4}), content_type="application/json",
            **self._headers(),
        )
        self.assertEqual(progress.status_code, 200)

        done = self.client.post(
            f"/api/internal/accelerator/tasks/{task.id}/complete/",
            data=json.dumps({"success": True, "sha256": digest}),
            content_type="application/json", **self._headers(),
        )
        self.assertEqual(done.status_code, 200, done.content)
        task.refresh_from_db()
        mat.refresh_from_db()
        self.assertEqual(task.status, MaterialSyncTask.Status.SYNCED)
        self.assertEqual(mat.file_sync_status, Material.FileSyncStatus.SYNCED)
        self.assertEqual(mat.file_sha256, digest)

    def test_complete_rejects_wrong_hash(self):
        mat, task = self._queued_task()
        self.client.post(
            f"/api/internal/accelerator/tasks/{task.id}/start/", data="{}",
            content_type="application/json", **self._headers(),
        )
        done = self.client.post(
            f"/api/internal/accelerator/tasks/{task.id}/complete/",
            data=json.dumps({"success": True, "sha256": "0" * 64}),
            content_type="application/json", **self._headers(),
        )
        self.assertEqual(done.status_code, 409)
        task.refresh_from_db()
        self.assertEqual(task.status, MaterialSyncTask.Status.ERROR)

    def test_expired_lease_requeues(self):
        _, task = self._queued_task()
        MaterialSyncTask.objects.filter(pk=task.pk).update(
            status=MaterialSyncTask.Status.TRANSFERRING,
            lease_expires_at=timezone.now() - timedelta(minutes=1),
        )
        resp = self.client.get("/api/internal/accelerator/tasks/", **self._headers())
        self.assertEqual(resp.status_code, 200)
        ids = [item["id"] for item in resp.json()["data"]["tasks"]]
        self.assertIn(task.id, ids)
        task.refresh_from_db()
        self.assertEqual(task.status, MaterialSyncTask.Status.PENDING)

    def test_error_backoff_and_revive(self):
        _, task = self._queued_task()
        accel.mark_task_started(task)
        task.refresh_from_db()
        accel.mark_task_error(task, "boom")
        task.refresh_from_db()
        self.assertEqual(task.status, MaterialSyncTask.Status.ERROR)
        self.assertIsNotNone(task.next_retry_at)
        # 未到退避时间不复活。
        self.assertEqual(accel.revive_retryable_tasks(), 0)
        MaterialSyncTask.objects.filter(pk=task.pk).update(
            next_retry_at=timezone.now() - timedelta(seconds=1),
        )
        self.assertEqual(accel.revive_retryable_tasks(), 1)
        task.refresh_from_db()
        self.assertEqual(task.status, MaterialSyncTask.Status.PENDING)

        # 达到最大尝试次数后不再自动重试。
        MaterialSyncTask.objects.filter(pk=task.pk).update(
            attempts=MaterialSyncTask.MAX_ATTEMPTS,
            status=MaterialSyncTask.Status.ERROR,
        )
        task.refresh_from_db()
        accel.mark_task_error(task, "still failing")
        task.refresh_from_db()
        self.assertIsNone(task.next_retry_at)
        self.assertEqual(accel.revive_retryable_tasks(), 0)

    def test_manifest_contains_sync_state(self):
        mat = self._material("approved")
        mat.file_sync_direction = Material.FileSyncDirection.PUBLIC_TO_CAMPUS
        mat.file_sync_status = Material.FileSyncStatus.PENDING
        mat.save(update_fields=["file_sync_direction", "file_sync_status"])
        resp = self.client.get("/api/internal/accelerator/manifest/", **self._headers())
        self.assertEqual(resp.status_code, 200)
        row = next(item for item in resp.json()["rows"] if item["id"] == mat.id)
        self.assertFalse(row["file_on_campus"])
        self.assertNotIn("file_on_public", row)


@override_settings(**ACCEL_SETTINGS)
class AcceleratorQueueTest(AcceleratorTestBase):
    def test_queue_only_for_approved(self):
        pending = self._material("pending")
        self.assertIsNone(accel.queue_public_to_campus(pending))
        self.assertFalse(MaterialSyncTask.objects.filter(material=pending).exists())

        approved = self._material("approved")
        task = accel.queue_public_to_campus(approved)
        self.assertIsNotNone(task)
        self.assertEqual(task.direction, MaterialSyncTask.Direction.PUBLIC_TO_CAMPUS)
        approved.refresh_from_db()
        self.assertEqual(approved.file_sync_direction, Material.FileSyncDirection.PUBLIC_TO_CAMPUS)
        self.assertEqual(approved.file_sync_status, Material.FileSyncStatus.PENDING)

    def test_pending_upload_not_queued_until_approved(self):
        payload = {
            "course_code": self.course.code,
            "category_id": self.leaf.id,
            "title": "文字同步测试",
            "content": "同步内容",
            "teacher": "李老师",
            "material_type_id": self.type_pdf.id,
        }
        resp = self.client.post_json("/api/files/upload-text/", payload)
        self.assertEqual(resp.status_code, 200, resp.content)
        material = Material.objects.get(id=resp.json()["data"]["id"])
        self.assertEqual(material.review_status, "pending")
        self.assertFalse(MaterialSyncTask.objects.filter(material=material).exists())

        # 审核通过后才镜像。
        self.client.set_token(self.admin)
        approved = self.client.post_json(f"/api/moderation/{material.id}/approve/")
        self.assertEqual(approved.status_code, 200, approved.content)
        self.assertTrue(
            MaterialSyncTask.objects.filter(
                material=material,
                direction=MaterialSyncTask.Direction.PUBLIC_TO_CAMPUS,
            ).exists()
        )

    def test_adopt_course_code_does_not_queue(self):
        Course.objects.filter(pk=self.course.pk).update(code="BNUX" + "0" * 32)
        self.course.refresh_from_db()
        material = self._material("approved")
        adopt_course_code(self.course, "CHI99999")
        self.assertFalse(MaterialSyncTask.objects.filter(material=material).exists())

    def test_restore_requeues_mirror(self):
        from ..models import DeletionRecord

        with override_settings(MEDIA_ROOT=tempfile.mkdtemp()):
            material = self._material("approved")
            self.client.set_token(self.admin)
            self.client.delete_json(f"/api/files/{material.id}/delete/")
            record = DeletionRecord.objects.filter(material_id=material.id).first()
            self.assertIsNotNone(record)

            self.client.set_token(self.admin)
            with self.captureOnCommitCallbacks(execute=True):
                resp = self.client.post_json(f"/api/moderation/deletions/{record.id}/restore/")
            self.assertEqual(resp.status_code, 200, resp.content)
            restored = Material.objects.filter(title=material.title).order_by("-id").first()
            self.assertEqual(restored.review_status, "approved")
            self.assertTrue(
                MaterialSyncTask.objects.filter(
                    material=restored,
                    direction=MaterialSyncTask.Direction.PUBLIC_TO_CAMPUS,
                ).exists()
            )


@override_settings(ACCELERATOR_BASE_URL="", ACCELERATOR_INTERNAL_SECRET="")
class AcceleratorDisabledTest(AcceleratorTestBase):
    def test_config_disabled_by_default(self):
        resp = self.client.get("/api/accelerator/config/")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()["data"]["enabled"])

    def test_queue_keeps_single_node_behavior(self):
        material = self._material("approved")
        self.assertIsNone(accel.queue_public_to_campus(material))
        material.refresh_from_db()
        self.assertEqual(material.file_sync_direction, Material.FileSyncDirection.NONE)
        self.assertEqual(material.file_sync_status, Material.FileSyncStatus.SYNCED)
