"""个人外观、校园入口、首页统计与推荐契约。"""

from datetime import timedelta

from django.utils import timezone

from .helpers import BnuTestCase, create_college, create_course, create_material, create_user
from ..models import CampusLink, DownloadRecord, Favorite, Material, UserProfile, UserTimetable


class PersonalHomeApiTest(BnuTestCase):
    def setUp(self):
        super().setUp()
        self.client.set_token(self.user)

    def test_appearance_defaults_and_patch_are_account_scoped(self):
        response = self.client.get_json("/api/auth/profile/")
        data = response.json()["data"]
        self.assertEqual(data["home_layout"], "compact")
        self.assertEqual(data["color_theme"], "warm")
        self.assertEqual(data["mobile_nav"], "burger")
        self.assertEqual(data["default_view"], "home")
        self.assertEqual(data["timetable_text_align"], "left")
        self.assertFalse(data["appearance_configured"])

        response = self.client.patch_json("/api/auth/profile/", {
            "home_layout": "compact", "color_theme": "dark", "mobile_nav": "bottom",
            "default_view": "timetable", "timetable_text_align": "right",
        })
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["home_layout"], "compact")
        self.assertEqual(data["color_theme"], "dark")
        self.assertEqual(data["mobile_nav"], "bottom")
        self.assertEqual(data["default_view"], "timetable")
        self.assertEqual(data["timetable_text_align"], "right")
        self.assertTrue(data["appearance_configured"])
        self.user.profile.refresh_from_db()
        self.assertEqual(self.user.profile.home_layout, "compact")
        self.assertEqual(self.user.profile.color_theme, "dark")
        self.assertEqual(self.user.profile.default_view, "timetable")
        self.assertEqual(self.user.profile.timetable_text_align, "right")

        response = self.client.patch_json("/api/auth/profile/", {"color_theme": "system"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["color_theme"], "system")
        self.user.profile.refresh_from_db()
        self.assertEqual(self.user.profile.color_theme, "system")

        other = create_user("student2", first_name="学生乙")
        other_client = self.client.__class__()
        other_client.set_token(other)
        other_data = other_client.get_json("/api/auth/profile/").json()["data"]
        self.assertEqual(other_data["home_layout"], "compact")
        self.assertEqual(other_data["color_theme"], "warm")
        self.assertEqual(other_data["mobile_nav"], "burger")
        self.assertEqual(other_data["default_view"], "home")
        self.assertEqual(other_data["timetable_text_align"], "left")

    def test_profile_download_count_means_downloads_received_by_approved_uploads(self):
        """个人中心的「被下载次数」不应误用本人主动下载记录数。"""
        course = create_course(code="GEN9900", name="学习科学")
        approved = create_material(course, self.user, review_status="approved")
        pending = create_material(course, self.user, review_status="pending")
        Material.objects.filter(id=approved.id).update(download_count=7)
        Material.objects.filter(id=pending.id).update(download_count=11)

        other = create_user("profile_download_owner")
        other_material = create_material(course, other, review_status="approved")
        for _ in range(3):
            DownloadRecord.objects.create(
                user=self.user,
                material=other_material,
                activity_type=DownloadRecord.ActivityType.DOWNLOAD,
                course_code=course.code,
                course_name=course.name,
                material_title=other_material.title,
                file_name=other_material.file_name,
            )

        response = self.client.get_json("/api/auth/profile/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["download_count"], 7)

    def test_appearance_rejects_unknown_enum(self):
        response = self.client.patch_json("/api/auth/profile/", {"color_theme": "neon"})
        self.assertEqual(response.status_code, 400)
        self.user.profile.refresh_from_db()
        self.assertEqual(self.user.profile.color_theme, "")
        response = self.client.patch_json("/api/auth/profile/", {"default_view": "dashboard"})
        self.assertEqual(response.status_code, 400)
        self.user.profile.refresh_from_db()
        self.assertEqual(self.user.profile.default_view, "")
        response = self.client.patch_json("/api/auth/profile/", {"timetable_text_align": "justify"})
        self.assertEqual(response.status_code, 400)
        self.user.profile.refresh_from_db()
        self.assertEqual(self.user.profile.timetable_text_align, "")

    def test_graduate_default_landing_is_timetable_but_explicit_home_wins(self):
        for username, education in (("masterstudent", UserProfile.EducationLevel.MASTER),
                                    ("doctorstudent", UserProfile.EducationLevel.DOCTOR)):
            student = create_user(username)
            student.profile.identity_education = education
            student.profile.save(update_fields=["identity_education"])
            client = self.client.__class__()
            client.set_token(student)

            profile_data = client.get_json("/api/auth/profile/").json()["data"]
            self.assertEqual(profile_data["default_view"], "timetable")
            self.assertEqual(profile_data["timetable_text_align"], "left")
            self.assertFalse(profile_data["appearance_configured"])
            me_data = client.get_json("/api/auth/me/").json()["data"]
            self.assertEqual(me_data["default_view"], "timetable")
            self.assertEqual(me_data["timetable_text_align"], "left")

            response = client.patch_json("/api/auth/profile/", {"default_view": "home"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["data"]["default_view"], "home")

    def test_campus_links_are_public_only_when_enabled_and_admin_managed(self):
        CampusLink.objects.create(name="教务系统", url="https://jw.example.edu.cn", is_enabled=True)
        CampusLink.objects.create(name="停用入口", url="https://off.example.edu.cn", is_enabled=False)
        response = self.client.get_json("/api/campus-links/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["name"] for row in response.json()["data"]["items"]], ["教务系统"])
        self.assertTrue(response.json()["data"]["can_manage"])
        self.assertFalse(response.json()["data"]["can_manage_featured"])

        self.client.set_token(self.admin)
        response = self.client.post_json("/api/campus-links/create/", {"name": "错误入口", "url": "javascript:alert(1)"})
        self.assertEqual(response.status_code, 400)
        response = self.client.post_json("/api/campus-links/create/", {"name": "图书馆", "url": "https://lib.example.edu.cn"})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(CampusLink.objects.count(), 3)
        created_id = response.json()["data"]["id"]
        response = self.client.patch_json("/api/campus-links/%s/" % created_id, {"is_enabled": False})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["data"]["is_enabled"])

    def test_stats_expose_real_favorite_ranking(self):
        course = create_course(code="GEN9901", name="学习方法")
        material = create_material(course, self.user, review_status="approved")
        Favorite.objects.create(user=self.user, material=material)
        response = self.client.get_json("/api/stats/?limit=4")
        self.assertEqual(response.status_code, 200)
        favorite_rows = response.json()["data"]["top_favorited"]
        self.assertEqual(favorite_rows[0]["id"], material.id)
        self.assertEqual(favorite_rows[0]["favorite_count"], 1)

    def test_campus_reorder_requires_complete_unique_integer_set(self):
        first = CampusLink.objects.create(name="教务系统", url="https://jw.example.edu.cn", order=0)
        second = CampusLink.objects.create(name="图书馆", url="https://lib.example.edu.cn", order=1)
        self.client.set_token(self.admin)

        for payload in ({"ids": [first.id]}, {"ids": [first.id, first.id]}, {"ids": [first.id, second.id, 999999]}):
            response = self.client.post_json("/api/campus-links/reorder/", payload)
            self.assertEqual(response.status_code, 400)
        response = self.client.post(
            "/api/campus-links/reorder/", data="[]", content_type="application/json", **self.client.defaults
        )
        self.assertEqual(response.status_code, 400)
        response = self.client.post_json("/api/campus-links/reorder/", {"ids": [second.id, first.id]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in response.json()["data"]["items"]], [second.id, first.id])

    def test_campus_write_rejects_non_object_json_without_500(self):
        self.client.set_token(self.admin)
        response = self.client.post(
            "/api/campus-links/create/", data="[]", content_type="application/json", **self.client.defaults
        )
        self.assertEqual(response.status_code, 400)
        response = self.client.post_json("/api/campus-links/create/", {"name": [], "url": "https://example.edu.cn"})
        self.assertEqual(response.status_code, 400)


class RecommendationApiTest(BnuTestCase):
    def setUp(self):
        super().setUp()
        college = create_college("教育学院", "edu")
        self.timetable_course = create_course("EDU1001", "教育学原理", college=college, course_type="major")
        self.other_course = create_course("GEN1001", "大学语文", course_type="general")
        self.timetable_material = create_material(self.timetable_course, self.user, review_status="approved")
        self.fallback_material = create_material(self.other_course, self.user, review_status="approved")
        UserTimetable.objects.create(user=self.user, data={"courses": [{"code": "EDU1001"}]})
        self.client.set_token(self.user)

    def test_recommendation_has_reason_and_prioritizes_timetable_course(self):
        response = self.client.get_json("/api/recommendations/?limit=4")
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["mode"], "personalized")
        self.assertEqual(data["items"][0]["id"], self.timetable_material.id)
        self.assertEqual(data["items"][0]["relevance"], 1.0)
        self.assertTrue(data["items"][0]["reason"])

    def test_recommendation_page_can_fill_thirteen_item_grid(self):
        extra_courses = [
            create_course("GEN110%d" % index, "额外课程%d" % index)
            for index in range(1, 12)
        ]
        for course in extra_courses:
            create_material(course, self.user, review_status="approved")
        response = self.client.get_json("/api/recommendations/?limit=99")
        data = response.json()["data"]
        self.assertEqual(data["config"]["page_limit"], 13)
        self.assertEqual(len(data["items"]), 13)

    def test_recommendation_refresh_switches_candidate_window(self):
        extra_courses = [
            create_course("GEN120%d" % index, "刷新候选课程%d" % index)
            for index in range(1, 8)
        ]
        for course in extra_courses:
            create_material(course, self.user, review_status="approved")

        first = self.client.get_json("/api/recommendations/?limit=4&refresh=1")
        second = self.client.get_json("/api/recommendations/?limit=4&refresh=2")
        first_ids = [item["id"] for item in first.json()["data"]["items"]]
        second_ids = [item["id"] for item in second.json()["data"]["items"]]
        self.assertNotEqual(first_ids, second_ids)

    def test_acquired_material_is_not_recommended(self):
        Favorite.objects.create(user=self.user, material=self.timetable_material)
        response = self.client.get_json("/api/recommendations/")
        ids = [item["id"] for item in response.json()["data"]["items"]]
        self.assertNotIn(self.timetable_material.id, ids)

    def test_recent_preview_is_a_bounded_explainable_signal(self):
        DownloadRecord.objects.create(
            user=self.user, material=self.fallback_material,
            activity_type=DownloadRecord.ActivityType.PREVIEW,
        )
        response = self.client.get_json("/api/recommendations/")
        row = next(item for item in response.json()["data"]["items"] if item["id"] == self.fallback_material.id)
        self.assertEqual(row["relevance"], 0.65)
        self.assertEqual(row["reason"], "来自你最近浏览的课程。")

    def test_old_preview_does_not_create_recent_reason(self):
        DownloadRecord.objects.create(
            user=self.user, material=self.fallback_material,
            activity_type=DownloadRecord.ActivityType.PREVIEW,
        )
        DownloadRecord.objects.filter(user=self.user, material=self.fallback_material).update(
            created_at=timezone.now() - timedelta(days=31)
        )
        response = self.client.get_json("/api/recommendations/")
        row = next(item for item in response.json()["data"]["items"] if item["id"] == self.fallback_material.id)
        self.assertNotEqual(row["reason"], "来自你最近浏览的课程。")
        self.assertNotIn("最近浏览", response.json()["data"]["signals"])

    def test_related_recall_precedes_large_unrelated_new_pool(self):
        old_related = create_material(self.timetable_course, self.user, review_status="approved")
        old_related.title = "较早但相关的资料"
        old_related.created_at = timezone.now() - timedelta(days=180)
        old_related.save(update_fields=["title", "created_at"])
        for index in range(505):
            create_material(self.other_course, self.user, review_status="approved")
        response = self.client.get_json("/api/recommendations/?limit=4")
        ids = [item["id"] for item in response.json()["data"]["items"]]
        self.assertIn(old_related.id, ids)

    def test_merged_alias_is_recalled_and_acquired_related_is_exhausted(self):
        alias = create_course("EDU1001-2026", "教育学原理", college=self.timetable_course.college, course_type="major")
        alias.merged_into = self.timetable_course
        alias.save(update_fields=["merged_into"])
        alias_material = create_material(alias, self.user, review_status="approved")
        response = self.client.get_json("/api/recommendations/")
        self.assertIn(alias_material.id, [item["id"] for item in response.json()["data"]["items"]])
        Favorite.objects.create(user=self.user, material=self.timetable_material)
        Favorite.objects.create(user=self.user, material=alias_material)
        response = self.client.get_json("/api/recommendations/")
        data = response.json()["data"]
        self.assertTrue(data["related_exhausted"])
        self.assertNotIn(alias_material.id, [item["id"] for item in data["items"]])

    def test_type_preference_stays_neutral_until_five_materials(self):
        response = self.client.get_json("/api/recommendations/")
        self.assertFalse(response.json()["data"]["type_preference_applied"])
