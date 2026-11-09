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
        for title in ('第一份笔记', '第二份笔记', '第三份笔记', '第四份笔记'):
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
        page.locator('.plaza-stack-cards .plaza-card').first.wait_for(state='visible')
        self.assertEqual(page.locator('.plaza-stack-cards .plaza-card').count(), 4)
        bounds = page.locator('.plaza-stack-cards .plaza-card').evaluate_all(
            "els => els.map(el => {const r = el.getBoundingClientRect(); return [r.left, r.right]})")
        self.assertTrue(all(left >= -2 and right <= 1442 for left, right in bounds))
        page.keyboard.press('Escape')
        page.locator('.plaza-stack-cards .plaza-card').first.wait_for(state='hidden')
        trigger.focus()
        page.locator('.plaza-stack-cards .plaza-card').first.wait_for(state='visible')
        page.locator('.plaza-stack-anchor').click()
        page.wait_for_function("location.search.includes('teacher=')")
        page.wait_for_selector('#plazaGrid .plaza-card[data-id]')
        self.assertEqual(page.locator('#plazaGrid .plaza-card[data-id]').count(), 4)
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
        page.locator('.plaza-stack-cards .plaza-card').first.wait_for(state='visible')
        self.assertFalse(page.evaluate('document.documentElement.scrollWidth > window.innerWidth'))
        if os.environ.get('BNU_BROWSER_SCREENSHOTS'):
            page.screenshot(path=os.path.join(os.environ['BNU_BROWSER_SCREENSHOTS'], 'plaza-fan-mobile.png'))
        page.locator('.plaza-stack-anchor').tap()
        page.wait_for_selector('#plazaGrid .plaza-card[data-id]')
        self.assertEqual(page.locator('#plazaGrid .plaza-card[data-id]').count(), 4)
        page.reload()
        page.wait_for_selector('#plazaGrid .plaza-card[data-id]')
        self.assertIn('教师：张老师', page.locator('#plazaFilterChips').inner_text())

    def test_fan_animates_from_stack_without_centered_panel(self):
        page = self.browser.new_page(viewport={'width': 1440, 'height': 900})
        page.goto(self.live_server_url + '/plaza?category_id=' + str(self.folder.id))
        trigger = page.locator('[data-plaza-group-open]')
        trigger.wait_for()
        page.evaluate("""() => {
            const grid = document.querySelector('#plazaGrid');
            grid.style.gridTemplateColumns = 'repeat(3, 300px)';
            grid.querySelector('.plaza-stack').style.gridColumn = '2';
        }""")
        page.wait_for_timeout(500)
        trigger.hover()
        page.wait_for_timeout(800)
        if os.environ.get('BNU_BROWSER_SCREENSHOTS'):
            page.screenshot(path=os.path.join(os.environ['BNU_BROWSER_SCREENSHOTS'], 'plaza-fan-debug.png'))
        page.locator('.plaza-stack.is-open').wait_for(timeout=3000)
        cards = page.locator('.plaza-stack-cards .plaza-card')
        self.assertNotEqual(cards.first.evaluate("el => getComputedStyle(el).transitionDuration"), '0s')
        page.wait_for_timeout(1000)
        positions = cards.evaluate_all("els => els.map(el => { const r = el.getBoundingClientRect(); return {x:r.x, y:r.y, right:r.right, bottom:r.bottom}; })")
        original = trigger.bounding_box()
        first_center = (positions[0]['x'] + positions[0]['right']) / 2
        self.assertAlmostEqual(first_center, original['x'] + original['width'] / 2, delta=2)
        self.assertAlmostEqual((positions[0]['y'] + positions[0]['bottom']) / 2, original['y'] + original['height'] / 2, delta=2)
        self.assertLess(min((p['x'] + p['right']) / 2 for p in positions), first_center - 40)
        self.assertGreater(max((p['x'] + p['right']) / 2 for p in positions), first_center + 40)
        self.assertGreater(max(p['y'] for p in positions) - min(p['y'] for p in positions), 40)
        self.assertEqual(page.locator('.plaza-stack-panel').count(), 0)
        if os.environ.get('BNU_BROWSER_SCREENSHOTS'):
            page.screenshot(path=os.path.join(os.environ['BNU_BROWSER_SCREENSHOTS'], 'plaza-fan.png'))
        page.mouse.move(1400, 850)
        page.locator('.plaza-stack.is-open').wait_for(state='hidden', timeout=700)

    def test_hover_requires_stationary_pointer(self):
        page = self.browser.new_page(viewport={'width': 1440, 'height': 900})
        page.goto(self.live_server_url + '/plaza?category_id=' + str(self.folder.id))
        trigger = page.locator('[data-plaza-group-open]')
        trigger.wait_for()
        page.wait_for_timeout(500)
        box = trigger.bounding_box()
        page.mouse.move(box['x'] + 40, box['y'] + 60)
        page.wait_for_timeout(350)
        page.mouse.move(box['x'] + 65, box['y'] + 60)
        page.wait_for_timeout(400)
        self.assertEqual(page.locator('.plaza-stack.is-open').count(), 0)
        page.locator('.plaza-stack.is-open').wait_for(timeout=1000)
        page.mouse.move(1400, 850)
        page.locator('.plaza-stack.is-open').wait_for(state='hidden', timeout=700)

    def test_fan_fits_middle_and_edges(self):
        page = self.browser.new_page(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce')
        page.goto(self.live_server_url + '/plaza?category_id=' + str(self.folder.id))
        trigger = page.locator('[data-plaza-group-open]')
        trigger.wait_for()
        page.wait_for_timeout(500)
        for x, y in ((30, 80), (570, 80), (1100, 80), (30, 340), (570, 340),
                     (1100, 340), (30, 650), (570, 650), (1100, 650)):
            with self.subTest(x=x, y=y):
                page.evaluate("""([x, y]) => {
                  const el = document.querySelector('.plaza-stack');
                  Object.assign(el.style, {position:'fixed', left:x+'px', top:y+'px', width:'300px', height:'208px'});
                }""", [x, y])
                page.wait_for_timeout(80)
                self.assertAlmostEqual(trigger.bounding_box()['x'], x, delta=2)
                trigger.evaluate("el => el.click()")
                page.locator('.plaza-stack.is-open').wait_for(timeout=2000)
                positions = page.locator('.plaza-stack-cards .plaza-card').evaluate_all(
                    "els => els.map(el => {const r=el.getBoundingClientRect(); return [r.left,r.top,r.right,r.bottom]})")
                self.assertTrue(all(left >= -1 and top >= -1 and right <= 1441 and bottom <= 901
                                    for left, top, right, bottom in positions), positions)
                center = (positions[0][0] + positions[0][2]) / 2
                if x == 570:
                    self.assertLess(min(p[0] for p in positions[1:]), center - 150)
                    self.assertGreater(max(p[2] for p in positions[1:]), center + 150)
                page.locator('.plaza-stack-backdrop').evaluate('el => el.click()')
                page.locator('.plaza-stack.is-open').wait_for(state='hidden', timeout=1000)
