"""总管理员用户监测、下载流水与单用户下载追溯。"""

from datetime import timedelta
from unittest.mock import patch

from django.utils import timezone

from .helpers import (
    AuthClient, create_category, create_course, create_material, create_user,
)
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
        incomplete = create_user("monitor_incomplete", role=UserProfile.Role.USER, first_name="未补全同学")
        incomplete.profile.identity_education = "本科"
        incomplete.profile.identity_college = "文学院"
        # 专业留空：本科筛选下计入未补全，不影响硕士口径
        incomplete.profile.save(update_fields=["identity_education", "identity_college"])
        data = self._get("/api/admin/monitoring/?section=identity&education=本科").json()["data"]
        # 统计卡取筛选内口径：本科总数（含未补全）而非全站总数
        self.assertEqual(data["total_users"], 2)
        self.assertEqual(data["tagged_users"], 1)
        self.assertEqual(data["untagged_users"], 1)
        filtered = self._get("/api/admin/monitoring/?section=identity&education=硕士").json()["data"]
        # 层次卡片保持全局口径；统计卡/学院/专业/覆盖取筛选内口径（分母一致）
        self.assertEqual([row["name"] for row in filtered["education_levels"]], ["本科", "硕士"])
        self.assertEqual(filtered["education_filter"], "硕士")
        self.assertEqual([row["name"] for row in filtered["colleges"]], ["教育学院"])
        self.assertEqual(filtered["colleges"][0]["majors"][0]["name"], "教育学")
        self.assertEqual(filtered["tagged_users"], 1)
        self.assertEqual(filtered["total_users"], 1)
        self.assertEqual(filtered["untagged_users"], 0)

    def test_campus_distribution_follows_identity_college(self):
        from ..models import College
        College.objects.create(name="文学院", slug="wenxy-bj", campus=College.Campus.BEIJING)
        College.objects.create(name="文理学院", slug="fas", campus=College.Campus.ZHUHAI)
        zhuhai_user = create_user("monitor_zhuhai", role=UserProfile.Role.USER, first_name="珠海同学")
        zhuhai_user.profile.identity_college = "文理学院"
        zhuhai_user.profile.save(update_fields=["identity_college"])
        data = self._get("/api/admin/monitoring/?section=identity").json()["data"]
        counts = {row["key"]: row["count"] for row in data["campus_distribution"]}
        # monitor_user 挂文学院（北京）；admin 未填学院，连同「其他」计入未判定
        self.assertEqual(counts["beijing"], 1)
        self.assertEqual(counts["zhuhai"], 1)
        self.assertEqual(counts["unknown"], 1)
        names = {row["key"]: row["name"] for row in data["campus_distribution"]}
        self.assertEqual(names["unknown"], "未判定")
        # 培养层次筛选不影响校区分布的全局口径
        filtered = self._get("/api/admin/monitoring/?section=identity&education=硕士").json()["data"]
        self.assertEqual(filtered["campus_distribution"], data["campus_distribution"])

    def test_user_distribution_grade_follows_education_filter(self):
        """用户分布卡：年级按学号前四位识别并随培养层次筛选；校区保持全局。"""
        from ..models import College
        College.objects.create(name="文学院", slug="wenxy-bj", campus=College.Campus.BEIJING)
        # 7 位合成学号：既绕开真实学号检查（8-12 位数字邮箱），又能触发年级识别
        student = create_user("2024221", role=UserProfile.Role.USER, first_name="24级同学")
        student.profile.identity_education = "硕士"
        student.profile.identity_college = "文学院"
        student.profile.identity_major = "语言学及应用语言学"
        student.profile.save(update_fields=["identity_education", "identity_college", "identity_major"])
        data = self._get("/api/admin/monitoring/?section=identity").json()["data"]
        grades = {row["name"]: row["count"] for row in data["grade_distribution"]}
        # monitor_user 与 admin 的用户名非学号 → 未识别；202422121001 → 2024级
        self.assertEqual(grades["2024级"], 1)
        self.assertGreaterEqual(grades["未识别"], 2)
        names = [row["name"] for row in data["grade_distribution"]]
        self.assertEqual(names[0], "2024级")
        self.assertEqual(names[-1], "未识别")
        # 筛选硕士后年级只统计该层次；校区仍是全站口径
        filtered = self._get("/api/admin/monitoring/?section=identity&education=硕士").json()["data"]
        fgrades = {row["name"]: row["count"] for row in filtered["grade_distribution"]}
        self.assertEqual(fgrades, {"2024级": 1})
        self.assertEqual(filtered["campus_distribution"], data["campus_distribution"])

    def test_identity_users_filters_by_tags(self):
        from ..views import admin_monitoring
        ghost = create_user("monitor_ghost", role=UserProfile.Role.USER, first_name="停用同学")
        ghost.is_active = False
        ghost.save(update_fields=["is_active"])
        ghost.profile.identity_education = "本科"
        ghost.profile.identity_college = "文学院"
        ghost.profile.identity_major = "汉语言文学"
        ghost.profile.save(update_fields=["identity_education", "identity_college", "identity_major"])
        other = create_user("monitor_othermajor", role=UserProfile.Role.USER, first_name="隔壁专业")
        other.profile.identity_education = "本科"
        other.profile.identity_college = "文学院"
        other.profile.identity_major = "编辑出版学"
        other.profile.save(update_fields=["identity_education", "identity_college", "identity_major"])
        path = ("/api/admin/monitoring/?section=identity_users"
                "&education=本科&college=文学院&major=汉语言文学")
        # 普通用户不可见
        denied = self._get(path, self.user)
        self.assertEqual(denied.status_code, 403)
        data = self._get(path).json()["data"]
        self.assertEqual(data["total"], 1)
        self.assertEqual([row["id"] for row in data["users"]], [self.user.id])
        self.assertEqual(data["users"][0]["grade"], "未识别")
        self.assertEqual(data["users"][0]["student_id"], "monitor_user")
        self.assertEqual(data["users"][0]["nickname"], "下载同学")
        self.assertFalse(data["truncated"])
        # 限量截断提示
        with patch.object(admin_monitoring, "MONITOR_IDENTITY_USERS_LIMIT", 0):
            data = self._get(path).json()["data"]
            self.assertEqual(data["returned"], 0)
            self.assertTrue(data["truncated"])
        # 无任何筛选条件拒绝
        self.assertEqual(self._get("/api/admin/monitoring/?section=identity_users").status_code, 400)

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

    def test_access_records_follow_renamed_tree_node(self):
        """重命名树节点后，访问记录流与单用户追溯都应显示新目录名。"""
        root = create_category(name="根")
        category = create_category(name="旧目录名", parent=root, course=self.course)

        stream = self._get("/api/admin/monitoring/?section=downloads").json()["data"]
        self.assertEqual(
            [item["course_name"] for item in stream["items"]],
            ["旧目录名", "旧目录名"],
        )

        category.name = "新目录名"
        category.save(update_fields=["name"])

        stream = self._get("/api/admin/monitoring/?section=downloads").json()["data"]
        self.assertEqual(
            [item["course_name"] for item in stream["items"]],
            ["新目录名", "新目录名"],
        )
        traced = self._get(f"/api/admin/users/{self.user.id}/downloads/").json()["data"]
        self.assertEqual(
            [item["course_name"] for item in traced["items"]],
            ["新目录名", "新目录名"],
        )

    def test_access_records_keep_snapshot_when_course_code_diverges(self):
        """资料换课或历史改码导致快照代码与当前课程不一致时，保留原快照名。"""
        DownloadRecord.objects.create(
            user=self.user, material=self.material,
            course_code="HIST999", course_name="历史快照名",
            material_title="换课资料", file_name="moved.pdf",
        )
        stream = self._get("/api/admin/monitoring/?section=downloads").json()["data"]
        names = {item["course_code"]: item["course_name"] for item in stream["items"]}
        self.assertEqual(names["HIST999"], "历史快照名")
        self.assertEqual(names[self.course.code], self.course.name)

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
