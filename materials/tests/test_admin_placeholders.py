import tempfile
from pathlib import Path

from django.core.cache import cache
from django.test import override_settings

from ..models import COURSE_TREE_CACHE_KEY, Course, CourseCategory, FolderOperation
from .helpers import (
    BnuTestCase, create_category, create_college, create_course,
    create_material, create_user,
)


class AdminPlaceholderCoursesTest(BnuTestCase):
    def setUp(self):
        super().setUp()
        self.econ = create_college(name="经济学院", slug="econ")
        self.other = create_college(name="物理学院", slug="physics")
        self.mod.profile.managed_majors.add(self.econ)
        root = create_category(name="专业课")
        econ_node = create_category(name=self.econ.name, parent=root)
        other_node = create_category(name=self.other.name, parent=root)
        self.econ_parent = create_category(name="经济专业", parent=econ_node)
        self.other_parent = create_category(name="物理专业", parent=other_node)
        self.uploader = create_user("placeholder_uploader")

    def placeholder(self, digit, name, college, parent):
        course = create_course(code="BNUX" + digit * 32, name=name,
                               college=college, course_type="major")
        create_category(name=name, parent=parent, course=course)
        return course

    def listing(self, **filters):
        response = self.client.get_json("/api/admin/placeholder-courses/", filters)
        self.assertEqual(response.status_code, 200)
        return response.json()["data"]["items"]

    def test_scope_isolation_and_filters(self):
        econ_course = self.placeholder("1", "共同课程", self.econ, self.econ_parent)
        other_course = self.placeholder("2", "外院课程", self.other, self.other_parent)
        self.client.set_token(self.user)
        self.assertEqual(self.client.get_json("/api/admin/placeholder-courses/").status_code, 403)

        self.client.set_token(self.mod)
        self.assertEqual({item["id"] for item in self.listing()}, {econ_course.id})
        response = self.client.post_json(
            f"/api/admin/placeholder-courses/{other_course.id}/adopt/",
            {"teaching_code": "PHY101"},
        )
        self.assertEqual(response.status_code, 403)

        second = self.placeholder("3", "共同课程", self.econ, self.econ_parent)
        real = create_course(code="ECON101", name="共同课程", college=self.econ)
        cross = create_course(code="PHY102", name="共同课程", college=self.other)
        create_material(econ_course, self.uploader)

        self.client.set_token(self.mod)
        mod_items = self.listing()
        self.assertEqual({item["id"] for item in mod_items}, {econ_course.id, second.id})
        mod_clues = next(item for item in mod_items if item["id"] == econ_course.id)["conflict_clues"]
        self.assertEqual({clue["course_id"] for clue in mod_clues["cross_college_real"]}, {cross.id})
        self.client.set_token(self.admin)
        items = self.listing()
        item = next(item for item in items if item["id"] == econ_course.id)
        clues = item["conflict_clues"]
        self.assertEqual({clue["course_id"] for clue in clues["same_college_real"]}, {real.id})
        self.assertEqual({clue["course_id"] for clue in clues["same_college_bnux"]}, {second.id})
        self.assertEqual({clue["course_id"] for clue in clues["cross_college_real"]}, {cross.id})
        for filters, expected in (
            ({"q": "外院课程"}, {other_course.id}),
            ({"q": econ_course.code.lower()}, {econ_course.id}),
            ({"college_id": self.econ.id}, {econ_course.id, second.id}),
            ({"has_materials": "1"}, {econ_course.id}),
            ({"has_materials": "0"}, {second.id, other_course.id}),
            ({"has_conflict": "1"}, {econ_course.id, second.id}),
            ({"has_conflict": "0"}, {other_course.id}),
        ):
            with self.subTest(filters=filters):
                self.assertEqual({item["id"] for item in self.listing(**filters)}, expected)

    def test_adopt_success_and_conflict_returns_existing_course(self):
        course = self.placeholder("4", "待补代码", self.econ, self.econ_parent)
        material = create_material(course, self.uploader)
        old_code, old_path = course.code, material.file_path
        self.client.set_token(self.mod)
        cache.set(COURSE_TREE_CACHE_KEY, "stale", timeout=None)
        response = self.client.post_json(
            f"/api/admin/placeholder-courses/{course.id}/adopt/", {"teaching_code": "ECO101"},
        )
        self.assertEqual(response.status_code, 200)
        course.refresh_from_db()
        material.refresh_from_db()
        self.assertEqual(course.code, "ECO101")
        self.assertEqual(material.course_id, course.id)
        self.assertEqual(material.file_path, old_path)
        self.assertEqual(Course.objects.get(code=old_code).merged_into_id, course.id)
        self.assertEqual(FolderOperation.objects.get(user=self.mod, action="set_course").category_id,
                         CourseCategory.objects.get(course=course).id)
        self.assertIsNone(cache.get(COURSE_TREE_CACHE_KEY))
        self.assertNotIn(course.id, {item["id"] for item in self.listing()})
        self.assertNotIn(old_code, {item["code"] for item in self.listing()})

        conflict = self.placeholder("5", "另一课程", self.econ, self.econ_parent)
        existing = create_course(code="ECO102", name="已有课程", college=self.econ)
        create_category(name=existing.name, parent=self.econ_parent, course=existing)
        response = self.client.post_json(
            f"/api/admin/placeholder-courses/{conflict.id}/adopt/", {"teaching_code": existing.code},
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["existing_course"]["id"], existing.id)
        self.assertTrue(response.json()["existing_course"]["can_merge"])
        other_existing = create_course(code="PHY103", name="外院已有课程", college=self.other)
        create_category(name=other_existing.name, parent=self.other_parent, course=other_existing)
        response = self.client.post_json(
            f"/api/admin/placeholder-courses/{conflict.id}/adopt/", {"teaching_code": other_existing.code},
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["existing_course"]["id"], other_existing.id)
        self.assertFalse(response.json()["existing_course"]["can_merge"])
        conflict.refresh_from_db()
        self.assertEqual(conflict.code, "BNUX" + "5" * 32)
        self.assertIsNone(conflict.merged_into_id)

    def test_merge_into_moves_files_dedups_leaves_and_keeps_alias(self):
        source = self.placeholder("6", "合并课程", self.econ, self.econ_parent)
        target = create_course(code="ECO201", name="合并课程", college=self.econ)
        target_leaf = create_category(name=target.name, parent=self.econ_parent, course=target)
        alias = create_course(code="OLD201", name=source.name, college=self.econ)
        alias.merged_into = source
        alias.save(update_fields=["merged_into"])
        material = create_material(source, self.uploader)
        self.client.set_token(self.mod)
        with tempfile.TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=directory):
            old_path = Path(directory) / material.file_path
            old_path.parent.mkdir()
            old_path.write_bytes(b"test material")
            cache.set(COURSE_TREE_CACHE_KEY, "stale", timeout=None)
            response = self.client.post_json(
                f"/api/admin/placeholder-courses/{source.id}/merge-into/",
                {"target_course_id": target.id},
            )
            self.assertEqual(response.status_code, 200)
            material.refresh_from_db()
            self.assertEqual(material.course_id, target.id)
            self.assertEqual(material.file_path, f"{target.code}/test.pdf")
            self.assertEqual((Path(directory) / material.file_path).read_bytes(), b"test material")
            self.assertFalse(old_path.exists())
        self.assertEqual(list(CourseCategory.objects.filter(parent=self.econ_parent, course=target)
                              .values_list("id", flat=True)), [target_leaf.id])
        self.assertFalse(CourseCategory.objects.filter(parent=self.econ_parent, course=source).exists())
        source.refresh_from_db()
        alias.refresh_from_db()
        self.assertEqual(source.merged_into_id, target.id)
        self.assertEqual(alias.merged_into_id, target.id)
        self.assertIsNone(cache.get(COURSE_TREE_CACHE_KEY))
        self.assertNotIn(source.id, {item["id"] for item in self.listing()})


import importlib.util
import json
import os
import unittest
from concurrent.futures import ThreadPoolExecutor

from django.contrib.staticfiles.testing import StaticLiveServerTestCase
from django.db import connections

from .helpers import AuthClient, _make_jwt


@unittest.skipUnless(os.environ.get('BNU_BROWSER_TESTS') == '1' and importlib.util.find_spec('playwright'), '需要 Playwright')
class AdminPlaceholdersBrowserTest(StaticLiveServerTestCase):
    def setUp(self):
        from playwright.sync_api import sync_playwright

        self.mod = create_user('placeholder_browser_mod', role='moderator')
        college = create_college(name='浏览器经济学院', slug='browser-econ')
        other = create_college(name='浏览器物理学院', slug='browser-physics')
        self.mod.profile.managed_majors.add(college)
        root = create_category(name='专业课')
        college_node = create_category(name=college.name, parent=root)
        other_node = create_category(name=other.name, parent=root)
        parent = create_category(name='浏览器经济专业', parent=college_node)
        other_parent = create_category(name='浏览器物理专业', parent=other_node)
        self.adopt_course = create_course(
            code='BNUX' + '1' * 32, name='待补代码课程', college=college, course_type='major')
        self.merge_course = create_course(
            code='BNUX' + '2' * 32, name='待合并课程', college=college, course_type='major')
        self.other_course = create_course(
            code='BNUX' + '3' * 32, name='外院占位课程', college=other, course_type='major')
        self.target = create_course(code='ECO302', name=self.merge_course.name, college=college)
        for course, course_parent in ((self.adopt_course, parent), (self.merge_course, parent),
                                      (self.other_course, other_parent), (self.target, parent)):
            create_category(name=course.name, parent=course_parent, course=course)

        client = AuthClient()
        client.set_token(self.mod)
        self.assertEqual(client.post_json('/api/auth/tutorial/', {'action': 'dismiss_offer'}).status_code, 200)

        self.pw = sync_playwright().start()
        self.addCleanup(self.pw.stop)
        self.browser = getattr(self.pw, os.environ.get('BNU_BROWSER_ENGINE', 'chromium')).launch()
        self.addCleanup(self.browser.close)
        self.context = self.browser.new_context(viewport={'width': 1440, 'height': 1000})
        self.addCleanup(self.context.close)
        self.context.add_init_script('''(() => {
            const state = %s;
            sessionStorage.setItem('token', state.token);
            localStorage.setItem('bnusparks_user_id', String(state.uid));
        })();''' % json.dumps({'token': _make_jwt(self.mod.id), 'uid': self.mod.id}))
        self.page = self.context.new_page()
        self.page.set_default_timeout(10000)
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))

    def tearDown(self):
        try:
            self.assertEqual(self.errors, [])
        finally:
            super().tearDown()

    @staticmethod
    def db_call(func):
        def run():
            try:
                return func()
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as executor:
            return executor.submit(run).result()

    def test_placeholder_adoption_and_merge(self):
        from playwright.sync_api import expect

        self.page.goto(self.live_server_url + '/manage')
        self.page.locator('#adminPlaceholdersTab').click()
        adopt_card = self.page.locator(f'.ap-card[data-course-id="{self.adopt_course.id}"]')
        merge_card = self.page.locator(f'.ap-card[data-course-id="{self.merge_course.id}"]')
        other_card = self.page.locator(f'.ap-card[data-course-id="{self.other_course.id}"]')
        expect(adopt_card).to_be_visible()
        expect(merge_card).to_be_visible()
        expect(other_card).to_have_count(0)
        expect(adopt_card.locator('.ap-clue-group').first).to_contain_text('暂无线索')
        expect(merge_card.locator('.ap-clue-group').first).to_contain_text('ECO302')

        adopt_card.locator('.ap-adopt-input').fill('ECO301')
        requests = []
        self.page.on('request', lambda request: requests.append(request.url)
                     if request.method == 'POST' and request.url.endswith(f'/{self.adopt_course.id}/adopt/') else None)
        adopt_card.locator('.ap-adopt-button').click()
        dialog = self.page.get_by_role('dialog', name='确认操作')
        expect(dialog).to_be_visible()
        self.page.keyboard.press('Escape')
        expect(dialog).to_have_count(0)
        expect(adopt_card.locator('.ap-adopt-button')).to_be_focused()
        self.assertEqual(requests, [])
        adopt_card.locator('.ap-adopt-input').fill('ECO302')
        adopt_card.locator('.ap-adopt-button').click()
        with self.page.expect_response(lambda response: response.request.method == 'POST' and
                                       response.url.endswith(f'/{self.adopt_course.id}/adopt/')) as response:
            dialog.get_by_role('button', name='确认', exact=True).click()
        self.assertEqual(response.value.status, 409)
        expect(adopt_card.locator('.ap-error')).to_contain_text('ECO302')
        expect(adopt_card.locator('.ap-error')).to_contain_text(self.target.name)
        adopt_card.get_by_role('button', name='填入并合并到该课程').click()
        expect(adopt_card.locator('.ap-merge-input')).to_have_value('ECO302')
        expect(dialog).to_contain_text('ECO302')
        with self.page.expect_response(lambda response: response.request.method == 'POST' and
                                       response.url.endswith(f'/{self.adopt_course.id}/merge-into/')) as response:
            dialog.get_by_role('button', name='确认', exact=True).click()
        self.assertEqual(response.value.status, 200)
        expect(adopt_card).to_have_count(0)
        self.assertEqual(self.db_call(lambda: Course.objects.get(pk=self.adopt_course.id).merged_into_id),
                         self.target.id)

        merge_card.locator(f'.ap-select-target[data-target-id="{self.target.id}"]').click()
        merge_card.locator('.ap-merge-button').click()
        with self.page.expect_response(lambda response: response.request.method == 'POST' and
                                       response.url.endswith(f'/{self.merge_course.id}/merge-into/')) as response:
            dialog.get_by_role('button', name='确认', exact=True).click()
        self.assertEqual(response.value.status, 200)
        expect(merge_card).to_have_count(0)
        self.assertEqual(self.db_call(lambda: Course.objects.get(pk=self.merge_course.id).merged_into_id),
                         self.target.id)

    def test_narrow_dark_layout(self):
        from playwright.sync_api import expect

        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.page.goto(self.live_server_url + '/manage')
        self.page.evaluate("document.documentElement.setAttribute('data-bnu-theme', 'dark')")
        self.page.locator('#adminPlaceholdersTab').click()
        card = self.page.locator(f'.ap-card[data-course-id="{self.adopt_course.id}"]')
        expect(card).to_be_visible()
        expect(self.page.locator('.ap-toolbar')).to_be_visible()
        expect(self.page.locator('.ap-query')).to_be_editable()
        card.locator('.ap-adopt-input').fill('ECO301')
        card.locator('.ap-adopt-button').click()
        dialog = self.page.get_by_role('dialog', name='确认操作')
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role('button', name='取消')).to_be_focused()
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
        self.page.keyboard.press('Escape')
        expect(card.locator('.ap-adopt-button')).to_be_focused()
