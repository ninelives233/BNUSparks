"""资料组在真实 SPA 中的预览、导航和键盘交互。"""
import importlib.util
import os
import unittest

from django.contrib.staticfiles.testing import StaticLiveServerTestCase

from materials.models import CourseCategory, Material, MaterialType
from .helpers import create_course


@unittest.skipUnless(os.environ.get('BNU_BROWSER_TESTS') == '1' and importlib.util.find_spec('playwright'), '需要 Playwright')
class PlazaGroupBrowserTest(StaticLiveServerTestCase):
    def setUp(self):
        from playwright.sync_api import sync_playwright
        root = CourseCategory.objects.create(name='通识课')
        self.folder = CourseCategory.objects.create(name='测试目录', parent=root)
        CourseCategory.objects.create(name='另一目录', parent=root)
        course = create_course('PLAZA001', '测试课程')
        self.leaf = CourseCategory.objects.create(name='测试课程', parent=self.folder, course=course)
        CourseCategory.objects.create(name='其他课程', parent=self.folder)
        kind = MaterialType.objects.create(name='笔记', slug='browser-notes')
        for title in ('第一份笔记', '第二份笔记'):
            Material.objects.create(course=course, teacher='张老师', title=title, material_type=kind, file_type='pdf')
        self.pw = sync_playwright().start()
        self.addCleanup(self.pw.stop)
        self.browser = self.pw.chromium.launch()
        self.addCleanup(self.browser.close)

    def test_preview_and_filtered_leaf(self):
        page = self.browser.new_page(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce')
        page.goto(self.live_server_url + '/plaza?category_id=' + str(self.folder.id))
        trigger = page.locator('[data-plaza-group-open]')
        trigger.wait_for()
        trigger.hover()
        page.locator('.plaza-stack-panel').wait_for(state='visible')
        self.assertEqual(page.locator('.plaza-stack-cards .plaza-card').count(), 2)
        page.keyboard.press('Escape')
        self.assertFalse(page.locator('.plaza-stack-panel').is_visible())
        trigger.focus()
        page.locator('.plaza-stack-panel').wait_for(state='visible')
        page.locator('.plaza-stack-panel [data-plaza-group-more]').click()
        page.wait_for_function("location.search.includes('teacher=')")
        page.wait_for_selector('#plazaGrid .plaza-card[data-id]')
        self.assertEqual(page.locator('#plazaGrid .plaza-card[data-id]').count(), 2)
        self.assertEqual(page.locator('.plaza-stack').count(), 0)
        self.assertIn('教师：张老师', page.locator('#plazaFilterChips').inner_text())

    def test_touch_preview_in_dark_mode(self):
        context = self.browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, reduced_motion='reduce')
        self.addCleanup(context.close)
        page = context.new_page()
        page.goto(self.live_server_url + '/plaza?category_id=' + str(self.folder.id))
        page.locator('[data-plaza-group-open]').wait_for()
        page.evaluate("document.documentElement.dataset.bnuTheme = 'dark'")
        page.locator('[data-plaza-group-open]').tap()
        page.locator('.plaza-stack-panel').wait_for(state='visible')
        self.assertFalse(page.evaluate('document.documentElement.scrollWidth > window.innerWidth'))
        page.locator('.plaza-stack-panel [data-plaza-group-more]').tap()
        page.wait_for_selector('#plazaGrid .plaza-card[data-id]')
        self.assertEqual(page.locator('#plazaGrid .plaza-card[data-id]').count(), 2)
        page.reload()
        page.wait_for_selector('#plazaGrid .plaza-card[data-id]')
        self.assertIn('教师：张老师', page.locator('#plazaFilterChips').inner_text())
