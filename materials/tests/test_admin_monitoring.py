"""总管理员用户监测、下载流水与单用户下载追溯。"""

from datetime import timedelta
from unittest.mock import patch

from django.utils import timezone

from .helpers import AuthClient, create_course, create_material, create_user
from django.test import TestCase
from ..models import (
    CourseCreationRequest,
    DownloadRecord,
    Report,
    TimetableImportRecord,
    UserProfile,
    UserTimetable,
)


class AdminMonitoringTest(TestCase):
    def setUp(self):
        self.client = AuthClient()
        self.admin = create_user("monitor_admin", role=UserProfile.Role.SUPER_ADMIN, first_name="监测管理员")
        self.user = create_user("monitor_user", role=UserProfile.Role.USER, first_name="下载同学")
        self.user.profile.identity_education = "本科"
        self.user.profile.identity_college = "文学院"
        self.user.profile.identity_major = "汉语言文学"
        self.user.profile.save(update_fields=["identity_education", "identity_college", "identity_major"])
        self.course = create_course(code="MON001", name="监测课程")
        self.material = create_material(self.course, self.user, review_status="approved")
        self.record_old = DownloadRecord.objects.create(
            user=self.user, material=self.material, course_code=self.course.code,
            course_name=self.course.name, material_title="较早资料", file_name="old.pdf",
        )
        self.record_new = DownloadRecord.objects.create(
            user=self.user, material=self.material, course_code=self.course.code,
            course_name=self.course.name, material_title="最新资料", file_name="new.pdf",
        )
        DownloadRecord.objects.filter(id=self.record_old.id).update(created_at=timezone.now() - timedelta(hours=2))

    def _get(self, path, user=None):
        self.client.set_token(user or self.admin)
        return self.client.get_json(path)

    def test_only_super_admin_can_view_monitoring(self):
        denied = self._get("/api/admin/monitoring/?section=trend", self.user)
        self.assertEqual(denied.status_code, 403)
        denied_trace = self._get(f"/api/admin/users/{self.user.id}/downloads/", self.user)
        self.assertEqual(denied_trace.status_code, 403)
        allowed = self._get("/api/admin/monitoring/?section=trend")
        self.assertEqual(allowed.status_code, 200)

    def test_trend_has_complete_24_hour_buckets(self):
        response = self._get("/api/admin/monitoring/?section=trend&period=day")
        data = response.json()["data"]
        self.assertEqual(len(data["labels"]), 24)
        self.assertEqual(len(data["uploads"]), 24)
        self.assertEqual(sum(data["downloads"]), 2)
        self.assertEqual(data["summary"]["unique_downloaders"], 1)

    def test_identity_distribution_uses_profile_tags(self):
        response = self._get("/api/admin/monitoring/?section=identity")
        data = response.json()["data"]
        level = next(row for row in data["education_levels"] if row["name"] == "本科")
        self.assertEqual(level["count"], 1)
        self.assertEqual(data["tagged_users"], 1)
        college = next(row for row in data["colleges"] if row["name"] == "文学院")
        self.assertEqual(college["count"], 1)
        self.assertEqual(college["majors"][0]["name"], "汉语言文学")

    def test_identity_distribution_hides_other_fallback_values(self):
        other = create_user("monitor_other", role=UserProfile.Role.USER, first_name="未细分同学")
        other.profile.identity_education = "其他"
        other.profile.identity_college = "其他"
        other.profile.identity_major = "其他"
        other.profile.save(update_fields=["identity_education", "identity_college", "identity_major"])
        data = self._get("/api/admin/monitoring/?section=identity").json()["data"]
        names = [row["name"] for row in data["education_levels"] + data["colleges"]]
        major_names = [major["name"] for college in data["colleges"] for major in college["majors"]]
        self.assertNotIn("其他", names)
        self.assertNotIn("其它", names)
        self.assertNotIn("其他", major_names)
        self.assertNotIn("其它", major_names)

    def test_identity_distribution_filters_by_education(self):
        grad = create_user("monitor_grad", role=UserProfile.Role.USER, first_name="研究生同学")
        grad.profile.identity_education = "硕士"
        grad.profile.identity_college = "教育学院"
        grad.profile.identity_major = "教育学"
        grad.profile.save(update_fields=["identity_education", "identity_college", "identity_major"])
        data = self._get("/api/admin/monitoring/?section=identity&education=硕士").json()["data"]
        # 层次卡片保持全局口径，学院/专业/覆盖只统计所选层次
        self.assertEqual([row["name"] for row in data["education_levels"]], ["本科", "硕士"])
        self.assertEqual(data["education_filter"], "硕士")
        self.assertEqual([row["name"] for row in data["colleges"]], ["教育学院"])
        self.assertEqual(data["colleges"][0]["majors"][0]["name"], "教育学")
        self.assertEqual(data["tagged_users"], 1)
        self.assertEqual(data["total_users"], 3)

    def test_timetable_import_monitoring_reports_users_and_trend(self):
        TimetableImportRecord.objects.create(
            user=self.user, event_id="tti-monitor-1", course_count=12,
        )
        TimetableImportRecord.objects.create(
            user=self.user, event_id="tti-monitor-2", course_count=13,
        )
        data = self._get("/api/admin/monitoring/?section=timetable&period=week").json()["data"]
        self.assertEqual(data["summary"]["import_count"], 2)
        self.assertEqual(data["summary"]["unique_users"], 1)
        self.assertEqual(len(data["imports"]), 7)
        self.assertEqual(len(data["import_users"]), 1)
        self.assertEqual(data["import_users"][0]["import_count"], 2)
        self.assertEqual(len(data["import_users"][0]["records"]), 2)

    def test_super_admin_can_view_user_timetable_but_regular_user_cannot(self):
        UserTimetable.objects.create(user=self.user, data={"courses": [{"name": "监测课程"}]})
        payload = self._get(f"/api/admin/users/{self.user.id}/timetable/").json()["data"]
        self.assertEqual(payload["user"]["nickname"], "下载同学")
        self.assertEqual(payload["data"]["courses"][0]["name"], "监测课程")
        denied = self._get(f"/api/admin/users/{self.user.id}/timetable/", self.user)
        self.assertEqual(denied.status_code, 403)

    def test_identity_includes_user_count_trend(self):
        response = self._get("/api/admin/monitoring/?section=identity&period=week")
        data = response.json()["data"]
        trend = data["user_trend"]
        self.assertEqual(len(trend["labels"]), 7)
        self.assertEqual(len(trend["new_users"]), 7)
        self.assertEqual(len(trend["total_users"]), 7)
        self.assertGreaterEqual(sum(trend["new_users"]), 2)
        self.assertGreaterEqual(trend["total_users"][-1], trend["total_users"][0])

    def test_download_stream_and_user_trace_are_newest_first(self):
        stream = self._get("/api/admin/monitoring/?section=downloads").json()["data"]
        self.assertEqual(stream["items"][0]["material_title"], "最新资料")
        traced = self._get(f"/api/admin/users/{self.user.id}/downloads/").json()["data"]
        self.assertEqual(traced["total"], 2)
        self.assertEqual(traced["items"][0]["nickname"], "下载同学")

    def test_activity_filter_separates_preview_from_formal_downloads(self):
        DownloadRecord.objects.create(
            user=self.user, material=self.material, course_code=self.course.code,
            course_name=self.course.name, material_title="预览资料", file_name="preview.pdf",
            activity_type=DownloadRecord.ActivityType.PREVIEW,
        )
        preview = self._get("/api/admin/monitoring/?section=downloads&activity=preview").json()["data"]
        self.assertEqual(preview["total"], 1)
        self.assertEqual(preview["items"][0]["activity_label"], "预览了")
        trend = self._get("/api/admin/monitoring/?section=trend&period=day").json()["data"]
        self.assertEqual(sum(trend["downloads"]), 2)
        self.assertEqual(trend["summary"]["preview_count"], 1)

    def test_download_record_survives_material_deletion(self):
        self.material.delete()
        self.record_new.refresh_from_db()
        self.assertIsNone(self.record_new.material_id)
        traced = self._get(f"/api/admin/users/{self.user.id}/downloads/").json()["data"]
        self.assertEqual(traced["total"], 2)
        self.assertFalse(traced["items"][0]["can_open"])

    def test_health_payload_is_live_and_structured(self):
        response = self._get("/api/admin/monitoring/?section=health")
        data = response.json()["data"]
        self.assertIn(data["overall"], {"healthy", "warning", "critical"})
        self.assertTrue(data["database"]["ok"])
        self.assertIn("free_bytes", data["storage"])

    def test_health_payload_aggregates_existing_activity_and_backlog(self):
        create_material(self.course, self.user, review_status="pending")
        Report.objects.create(
            kind=Report.Kind.MATERIAL,
            material=self.material,
            material_pk=self.material.id,
            reporter=self.user,
            reporter_name=self.user.first_name,
            material_title=self.material.title,
        )
        CourseCreationRequest.objects.create(
            user=self.user,
            course_type=CourseCreationRequest.Type.GENERAL,
            course_name="待审课程申请",
        )
        TimetableImportRecord.objects.create(
            user=self.user,
            event_id="tti-health-1",
            course_count=8,
        )

        data = self._get("/api/admin/monitoring/?section=health&period=week").json()["data"]

        self.assertEqual(data["period"], "week")
        self.assertEqual(len(data["trend"]["previews"]), 7)
        self.assertEqual(data["trend"]["summary"]["download_count"], 2)
        self.assertEqual(data["activity"]["recorded_users"], 1)
        self.assertEqual(data["activity"]["recorded_users_status"], "available")
        self.assertEqual(data["timetable"]["summary"]["import_count"], 1)
        self.assertEqual(data["backlog"]["pending_materials"], 1)
        self.assertEqual(data["backlog"]["pending_reports"], 1)
        self.assertEqual(data["backlog"]["pending_course_requests"], 1)
        self.assertIsNotNone(data["backlog"]["oldest_pending_at"])
        self.assertGreaterEqual(data["backlog"]["oldest_pending_seconds"], 0)

    def test_health_all_time_counts_users_with_only_old_timetable_imports(self):
        timetable_only = create_user("monitor_timetable_only", first_name="只导入课表")
        record = TimetableImportRecord.objects.create(
            user=timetable_only,
            event_id="tti-health-old",
            course_count=4,
        )
        TimetableImportRecord.objects.filter(id=record.id).update(
            created_at=timezone.now() - timedelta(days=90),
        )

        data = self._get("/api/admin/monitoring/?section=health&period=all").json()["data"]

        self.assertEqual(data["period"], "all")
        self.assertEqual(data["activity"]["recorded_users"], 2)

    def test_health_recorded_users_only_counts_active_accounts(self):
        inactive = create_user("monitor_inactive", first_name="已停用同学")
        inactive.is_active = False
        inactive.save(update_fields=["is_active"])
        create_material(self.course, inactive, review_status="approved")
        DownloadRecord.objects.create(
            user=inactive,
            material=self.material,
            course_code=self.course.code,
            course_name=self.course.name,
            material_title="停用用户访问",
            file_name="inactive.pdf",
        )
        TimetableImportRecord.objects.create(
            user=inactive,
            event_id="tti-health-inactive",
            course_count=2,
        )

        data = self._get("/api/admin/monitoring/?section=health&period=all").json()["data"]

        self.assertEqual(data["activity"]["recorded_users"], 1)

    def test_health_probe_failure_does_not_trigger_follow_up_orm_queries(self):
        from ..views.admin_monitoring import _health_payload

        with patch("materials.views.admin_monitoring.connection.cursor", side_effect=RuntimeError("locked")):
            data = _health_payload()

        self.assertEqual(data["overall"], "critical")
        self.assertFalse(data["database"]["ok"])
        self.assertFalse(data["database"]["query_ok"])
        self.assertFalse(data["activity"]["ok"])
        self.assertEqual(data["activity"]["last_upload_at"], "暂无")
        self.assertEqual(data["activity"]["last_download_at"], "暂无")
