"""资料广场：目录范围解析、分页筛选与课程导航回归。"""

from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone

from .helpers import (
    BnuTestCase, create_category, create_college, create_course, create_user,
)
from ..models import CourseCategory, DownloadRecord, Favorite, Material, MaterialType, UserProfile
from ..services.plaza_ranking import interaction_signals


class PlazaApiTest(BnuTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.college = create_college("经济与工商管理学院", "jingguan")
        self.root_gen = create_category(name="通识课")
        self.root_major = create_category(name="专业课")
        self.college_cat = create_category(name="经济与工商管理学院", parent=self.root_major)
        self.major_cat = create_category(name="金融学", parent=self.college_cat)
        self.core_cat = create_category(name="专业核心课", parent=self.major_cat)
        self.course_a = create_course("FIN101", "公司金融", college=self.college, course_type="major")
        self.course_b = create_course("FIN102", "投资学", college=self.college, course_type="major")
        self.course_gen = create_course("GEN0101", "大学英语")
        self.course_other = create_course("LAW201", "民法总论", college=self.college, course_type="major")

        self.cat_a = create_category(name="公司金融", parent=self.core_cat, course=self.course_a)
        self.cat_b = create_category(name="投资学", parent=self.core_cat, course=self.course_b)
        self.gen_leaf = create_category(name="语言类", parent=self.root_gen, course_text="GEN01")
        self.other_cat = create_category(name="法学", parent=self.root_major)
        self.other_leaf = create_category(name="民法总论", parent=self.other_cat, course=self.course_other)

        self.user = create_user("plaza_reader", role="user")
        self.user.profile.identity_education = UserProfile.EducationLevel.UNDERGRADUATE
        self.user.profile.identity_college = "经济与工商管理学院"
        self.user.profile.identity_major = "金融学"
        self.user.profile.save()

        self.pending = self._material(self.course_a, "待审范围外", review_status="pending")
        self.mat_a = self._material(self.course_a, "公司金融真题")
        self.mat_b = self._material(self.course_b, "投资学笔记")
        self.mat_gen = self._material(self.course_gen, "大学英语词汇")
        self.mat_other = self._material(self.course_other, "民法讲义")
        for material in (self.mat_a, self.mat_b, self.mat_gen, self.mat_other):
            material.download_count = material.id
            material.save(update_fields=["download_count"])

    def _material(self, course, title, review_status="approved"):
        return Material.objects.create(
            course=course,
            title=title,
            teacher="张老师",
            file_name="paper.pdf",
            file_path=f"{course.code}/{title}.pdf",
            file_size=1024,
            file_type="pdf",
            uploader=self.user,
            uploader_name=self.user.first_name,
            material_type=self.type_pdf,
            review_status=review_status,
            is_approved=review_status == "approved",
        )

    def _materials(self, **params):
        params.setdefault("category_id", self.major_cat.id)
        response = self.client.get("/api/materials/", params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["data"]

    def test_scope_includes_descendant_courses_only(self):
        data = self._materials()
        ids = {item["id"] for item in data["items"]}
        self.assertEqual(ids, {self.mat_a.id, self.mat_b.id})
        self.assertNotIn(self.pending.id, ids)
        self.assertNotIn(self.mat_gen.id, ids)
        self.assertNotIn(self.mat_other.id, ids)
        self.assertEqual(data["total"], 2)
        self.assertIn("uploader_avatar", data["items"][0])

    def test_parent_scope_includes_all_descendant_courses(self):
        data = self._materials(category_id=self.root_major.id)
        ids = {item["id"] for item in data["items"]}
        self.assertEqual(ids, {self.mat_a.id, self.mat_b.id, self.mat_other.id})
        self.assertNotIn(self.mat_gen.id, ids)

    def test_course_text_exact_course_code_in_scope(self):
        range_cat = create_category(
            name="形势与政策", parent=self.other_cat, course_text="GEN09001-GEN09008",
        )
        range_course = create_course("GEN09001-GEN09008", "形势与政策")
        material = self._material(range_course, "形势与政策资料")
        ids = {item["id"] for item in self._materials(category_id=range_cat.id)["items"]}
        self.assertEqual(ids, {material.id})

    def test_legacy_approved_flag_matches_public_course_visibility(self):
        legacy = self._material(self.course_a, "旧版已公开资料")
        legacy.review_status = "pending"
        legacy.is_approved = True
        legacy.save(update_fields=["review_status", "is_approved"])
        rejected = self._material(self.course_a, "已驳回资料")
        rejected.review_status = "rejected"
        rejected.is_approved = True
        rejected.save(update_fields=["review_status", "is_approved"])
        ids = {item["id"] for item in self._materials()["items"]}
        self.assertIn(legacy.id, ids)
        self.assertNotIn(rejected.id, ids)

    def test_wildcard_scope_and_empty_scope(self):
        data = self._materials(category_id=self.root_gen.id)
        self.assertEqual({item["id"] for item in data["items"]}, {self.mat_gen.id})

        empty = create_category(name="空目录", parent=self.root_major)
        data = self._materials(category_id=empty.id)
        self.assertEqual(data["total"], 0)
        self.assertEqual(data["items"], [])

    def test_same_code_shared_across_college_rows(self):
        alias = create_course("FIN101", "公司金融（另一挂载）", college=self.college, course_type="major")
        material = self._material(alias, "同码共享资料")
        data = self._materials()
        self.assertIn(material.id, {item["id"] for item in data["items"]})

    def test_merged_alias_in_scope(self):
        main = create_course("FIN103", "金融工程", college=self.college, course_type="major")
        alias = create_course("FIN103A", "金融工程（旧码）", college=self.college, course_type="major")
        alias.merged_into = main
        alias.save(update_fields=["merged_into"])
        cat = create_category(name="金融工程", parent=self.core_cat, course=alias)
        main_material = self._material(main, "合并主课程资料")
        data = self._materials(category_id=cat.id)
        self.assertIn(main_material.id, {item["id"] for item in data["items"]})

    def test_search_matches_title_teacher_and_course_display_name(self):
        self.assertEqual(
            {item["id"] for item in self._materials(q="真题")["items"]},
            {self.mat_a.id},
        )
        course = CourseCategory.objects.get(id=self.cat_b.id)
        course.name = "投资学（目录名）"
        course.save(update_fields=["name"])
        self.assertEqual(
            {item["id"] for item in self._materials(q="目录名")["items"]},
            {self.mat_b.id},
        )

    def test_filters_and_facets(self):
        upper = self._material(self.course_a, "大写扩展名资料")
        upper.file_type = "PDF"
        upper.save(update_fields=["file_type"])
        data = self._materials(material_type=self.type_pdf.id)
        self.assertEqual(data["total"], 3)
        self.assertTrue(data["facets"]["material_types"])
        pdf_facets = [row for row in data["facets"]["formats"] if row["value"] == "pdf"]
        self.assertEqual(len(pdf_facets), 1)
        self.assertEqual(pdf_facets[0]["count"], 3)

    def test_group_courseware_and_notes_only_above_course_leaf(self):
        notes = MaterialType.objects.create(name="笔记", slug="notes")
        a = self._material(self.course_a, "笔记一")
        b = self._material(self.course_a, "笔记二")
        Material.objects.filter(id__in=[a.id, b.id]).update(material_type=notes)
        Material.objects.filter(id=b.id).update(teacher=" 张老师 ")
        unknown = self._material(self.course_a, "无教师")
        Material.objects.filter(id=unknown.id).update(material_type=notes, teacher="")
        other = self._material(self.course_a, "另一教师")
        Material.objects.filter(id=other.id).update(material_type=notes, teacher="李老师")
        data = self._materials(material_type=notes.id)
        groups = [item for item in data["items"] if item.get("kind") == "group"]
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["count"], 2)
        self.assertEqual({i["id"] for i in groups[0]["items"]}, {a.id, b.id})
        self.assertEqual(data["total"], 4)
        leaf = self._materials(category_id=self.cat_a.id, material_type=notes.id, teacher="张老师")
        self.assertEqual({item["id"] for item in leaf["items"]}, {a.id, b.id})
        self.assertFalse(any(item.get("kind") == "group" for item in leaf["items"]))
        self.assertEqual(self._materials(material_type=notes.id, q="笔记一")["items"][0]["id"], a.id)

    def test_groups_paginate_as_units_and_limit_preview(self):
        courseware = MaterialType.objects.create(name="课件", slug="slides")
        for index in range(30):
            mat = self._material(self.course_a, f"课件 {index}")
            Material.objects.filter(id=mat.id).update(material_type=courseware)
        for sort in ("latest", "smart", "downloads", "favorites"):
            data = self._materials(sort=sort)
            groups = [item for item in data["items"] if item.get("kind") == "group"]
            self.assertEqual(data["total"], 32)
            self.assertEqual(data["total_pages"], 1)
            self.assertEqual(groups[0]["count"], 30)
            self.assertEqual(len(groups[0]["items"]), 5)

    def test_sort_and_pagination(self):
        for index in range(25):
            self._material(self.course_b, "批量资料%02d" % index)
        data = self._materials(sort="downloads")
        self.assertEqual(data["page_size"], 24)
        self.assertEqual(len(data["items"]), 24)
        self.assertEqual(data["items"][0]["id"], self.mat_b.id)
        second = self._materials(sort="downloads", page=2)
        self.assertEqual(second["page"], 2)
        self.assertEqual(len(second["items"]), 3)

    def test_favorites_filter_requires_login(self):
        response = self.client.get("/api/materials/", {
            "category_id": self.major_cat.id, "favorites": "1",
        })
        self.assertEqual(response.status_code, 401)

        Favorite.objects.create(user=self.user, material=self.mat_a)
        self.client.set_token(self.user)
        data = self._materials(favorites="1")
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["id"], self.mat_a.id)
        self.assertTrue(data["items"][0]["is_favorited"])

    def test_unknown_category_is_404(self):
        response = self.client.get("/api/materials/", {"category_id": 999999})
        self.assertEqual(response.status_code, 404)

    def test_profile_saves_browse_mode(self):
        self.client.set_token(self.user)
        response = self.client.patch_json("/api/auth/profile/", {"material_browse_mode": "plaza"})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["data"]["material_browse_mode"], "plaza")
        self.assertEqual(
            self.client.get("/api/auth/me/").json()["data"]["material_browse_mode"], "plaza",
        )
        invalid = self.client.patch_json("/api/auth/profile/", {"material_browse_mode": "other"})
        self.assertEqual(invalid.status_code, 400)


    def test_smart_sort_keeps_original_flat_pagination_without_group_limit(self):
        for index in range(27):
            self._material(self.course_a, f"同类型资料 {index}")
        Material.objects.filter(id=self.mat_a.id).update(download_count=500)
        first = self._materials(sort="smart")
        second = self._materials(sort="smart", page=2)
        self.assertEqual(first["items"][0]["id"], self.mat_a.id)
        self.assertEqual(first["page_size"], 24)
        self.assertEqual(len(first["items"]), 24)
        self.assertEqual(len(second["items"]), 5)
        self.assertEqual(len({m["id"] for m in first["items"] + second["items"]}), 29)
        self.assertNotIn("groups", first)
        self.assertNotIn(self.pending.id, {m["id"] for m in first["items"] + second["items"]})

    def test_recent_heat_counts_distinct_readers_not_repeated_or_self_activity(self):
        reader = create_user("smart_reader")
        script = create_user("smart_script")
        script.email = "automation@test.com"
        script.save(update_fields=["email"])
        for user in (reader, reader, reader, self.user, script):
            DownloadRecord.objects.create(user=user, material=self.mat_a, activity_type="download")
        DownloadRecord.objects.create(user=reader, material=self.mat_a, activity_type="preview")
        Favorite.objects.create(user=self.user, material=self.mat_a)
        signal = interaction_signals(Material.objects.filter(id=self.mat_a.id).values("id"), timezone.now())[self.mat_a.id]
        self.assertEqual(signal["heat"], 3.25)
        self.assertEqual(signal["favorites"], 0)

    def test_smart_sort_prefers_recent_use_over_expired_equal_popularity(self):
        reader = create_user("smart_recent")
        Material.objects.filter(id__in=[self.mat_a.id, self.mat_b.id]).update(download_count=10, created_at=timezone.now() - timedelta(days=90))
        old = DownloadRecord.objects.create(user=reader, material=self.mat_b, activity_type="download")
        DownloadRecord.objects.filter(id=old.id).update(created_at=timezone.now() - timedelta(days=40))
        DownloadRecord.objects.create(user=reader, material=self.mat_a, activity_type="download")
        self.assertEqual(self._materials(sort="smart")["items"][0]["id"], self.mat_a.id)

    def test_smart_sort_uses_valid_favorites_without_changing_public_count(self):
        Material.objects.filter(id__in=[self.mat_a.id, self.mat_b.id]).update(download_count=0)
        Favorite.objects.create(user=create_user("smart_favorite"), material=self.mat_a)
        Favorite.objects.create(user=self.user, material=self.mat_a)
        data = self._materials(sort="smart")
        self.assertEqual(data["items"][0]["id"], self.mat_a.id)
        self.assertEqual(data["items"][0]["favorite_count"], 2)

    def test_smart_practical_bonus_comes_from_directory_not_material_title(self):
        course = create_course("UNB001", "学院资料", college=self.college)
        folder = create_category(name="实用资料", parent=self.major_cat)
        create_category(name="选课经验", parent=folder, course=course)
        practical = self._material(course, "选课经验")
        Material.objects.all().update(download_count=0, created_at=timezone.now() - timedelta(days=90))
        Material.objects.filter(id=self.mat_b.id).update(title="实用资料：只是标题")
        self.assertEqual(self._materials(sort="smart")["items"][0]["id"], practical.id)

    def test_smart_sort_preserves_course_pin_without_global_pin_priority(self):
        pinned = self._material(self.course_a, "置顶资料")
        pinned.is_pinned = True
        pinned.save(update_fields=["is_pinned"])
        Material.objects.filter(id=self.mat_a.id).update(download_count=5000)
        self.assertEqual(self._materials(category_id=self.cat_a.id, sort="smart")["items"][0]["id"], pinned.id)
        self.assertEqual(self._materials(sort="smart")["items"][0]["id"], self.mat_a.id)


class CourseNavigationTest(BnuTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.root_gen = create_category(name="通识课")
        self.root_major = create_category(name="专业课")
        self.college_cat = create_category(name="经济与工商管理学院", parent=self.root_major)
        self.major_cat = create_category(name="金融学", parent=self.college_cat)
        self.single_cat = create_category(name="公司金融", parent=self.major_cat)
        self.single_child = create_category(name="专业核心课", parent=self.single_cat)
        self.course = create_course("FIN101", "公司金融", course_type="major")
        self.leaf = create_category(name="公司金融", parent=self.single_child, course=self.course)

    def _nav(self, **params):
        response = self.client.get("/api/courses/navigation/", params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["data"]

    def test_explicit_category_auto_skips_single_folder(self):
        data = self._nav(category_id=self.major_cat.id)
        self.assertEqual(data["course_type"], "major")
        self.assertEqual(data["category_id"], self.single_child.id)
        self.assertEqual(
            [level["name"] for level in data["path"]],
            ["专业课", "经济与工商管理学院", "金融学", "公司金融", "专业核心课"],
        )
        self.assertTrue(data["can_expand_tree"])

    def test_deep_general_category_keeps_general_type(self):
        gen_folder = create_category(name="语言类", parent=self.root_gen)
        gen_leaf = create_category(name="大学英语", parent=gen_folder)
        data = self._nav(category_id=gen_leaf.id)
        self.assertEqual(data["course_type"], "general")

    def test_undergraduate_default_uses_major(self):
        user = create_user("ug_identity", role="user")
        profile = user.profile
        profile.identity_education = UserProfile.EducationLevel.UNDERGRADUATE
        profile.identity_college = "经济与工商管理学院"
        profile.identity_major = "金融学"
        profile.save()
        self.client.set_token(user)
        data = self._nav(course_type="major")
        self.assertEqual(data["category_id"], self.single_child.id)

    def test_graduate_default_stops_at_college(self):
        user = create_user("grad_identity", role="user")
        profile = user.profile
        profile.identity_education = UserProfile.EducationLevel.MASTER
        profile.identity_college = "经济与工商管理学院"
        profile.identity_major = "金融学"
        profile.save()
        self.client.set_token(user)
        data = self._nav(course_type="major")
        # 从学院出发后，同一单文件夹规则继续深入；学院层仍在面包屑中。
        self.assertEqual(data["category_id"], self.single_child.id)
        self.assertEqual(data["path"][1]["name"], "经济与工商管理学院")

    def test_duplicate_major_falls_back_to_college(self):
        duplicate = create_category(name="金融学", parent=self.college_cat)
        create_category(name="金融科技", parent=duplicate)
        user = create_user("ug_duplicate", role="user")
        profile = user.profile
        profile.identity_education = UserProfile.EducationLevel.UNDERGRADUATE
        profile.identity_college = "经济与工商管理学院"
        profile.identity_major = "金融学"
        profile.save()
        self.client.set_token(user)
        data = self._nav(course_type="major")
        self.assertEqual(data["category_id"], self.college_cat.id)

    def test_missing_identity_falls_back_to_major_root(self):
        data = self._nav(course_type="major")
        self.assertEqual(data["path"][0]["name"], "专业课")
        # 测试目录只有一个学院，按单文件夹规则继续深入。
        self.assertEqual(data["category_id"], self.single_child.id)

    def test_explicit_link_is_not_overridden_by_identity(self):
        user = create_user("ug_explicit", role="user")
        profile = user.profile
        profile.identity_college = "经济与工商管理学院"
        profile.identity_major = "金融学"
        profile.save()
        self.client.set_token(user)
        data = self._nav(category_id=self.root_gen.id)
        self.assertEqual(data["category_id"], self.root_gen.id)

    def test_siblings_and_courses_picker(self):
        data = self._nav(category_id=self.major_cat.id, courses="1")
        self.assertEqual(
            [sibling["name"] for sibling in data["path"][1]["siblings"]],
            ["经济与工商管理学院"],
        )
        self.assertTrue(any(child["name"] == "公司金融" for child in data["children"]))
        data = self._nav(category_id=self.root_major.id, courses="1")
        self.assertEqual(len(data["courses"]), 1)
