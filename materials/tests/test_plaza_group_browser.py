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
        course_name = ('微观经济学原理与金融市场分析' * 3
                       if self._testMethodName == 'test_long_course_names_stay_on_one_line' else '测试课程')
        course = create_course('PLAZA001', course_name)
        self.leaf = CourseCategory.objects.create(name=course_name, parent=self.folder, course=course)
        CourseCategory.objects.create(name='其他课程', parent=self.folder)
        kind = MaterialType.objects.create(name='笔记', slug='browser-notes')
        for title in ('第一份笔记', '第二份笔记', '第三份笔记', '第四份笔记', '第五份笔记'):
            Material.objects.create(course=course, teacher='张老师', title=title, material_type=kind, file_type='pdf')
        if self._testMethodName == 'test_long_course_names_stay_on_one_line':
            exam = MaterialType.objects.create(name='真题', slug='browser-long-course-exam')
            Material.objects.create(course=course, teacher='张老师', title='置顶试卷',
                                    material_type=exam, file_type='pdf', is_pinned=True)
        if self._testMethodName == 'test_grid_cards_keep_equal_height_across_rows':
            exam = MaterialType.objects.create(name='真题', slug='browser-exams')
            for index in range(7):
                Material.objects.create(course=course, teacher='张老师',
                                        title=('很长的资料标题' * 15 if index == 0 else f'试卷 {index}'),
                                        description=('很长的资料简介' * 30 if index == 0 else ''),
                                        material_type=exam, file_type='pdf')
        self.pw = sync_playwright().start()
        self.addCleanup(self.pw.stop)
        self.browser = self.pw.chromium.launch()
        self.addCleanup(self.browser.close)

    def test_long_course_names_stay_on_one_line(self):
        page = self.browser.new_page(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce')
        page.goto(self.live_server_url + '/plaza?category_id=' + str(self.folder.id))
        page.locator('#plazaGrid > .plaza-card .pc-pin').wait_for()
        for width in (1440, 768, 390):
            with self.subTest(width=width):
                page.set_viewport_size({'width': width, 'height': 900})
                page.evaluate("document.documentElement.dataset.bnuTheme = 'dark'")
                for selector in ('#plazaGrid > .plaza-card .pc-course', '.plaza-stack-front .pc-course'):
                    info = page.locator(selector).evaluate("""el => {
                      const course = el.querySelector('.pc-course-btn, .pc-course-name');
                      const teacher = el.querySelector('.pc-teacher');
                      const c = course.getBoundingClientRect(), t = teacher.getBoundingClientRect();
                      return {wrap: getComputedStyle(el).flexWrap, ellipsis: getComputedStyle(course).textOverflow,
                              overflow: course.scrollWidth > course.clientWidth,
                              courseTop: c.top, teacherTop: t.top, courseRight: c.right,
                              teacherLeft: t.left, teacherWidth: t.width, teacherScroll: teacher.scrollWidth};
                    }""")
                    self.assertEqual(info['wrap'], 'nowrap')
                    self.assertEqual(info['ellipsis'], 'ellipsis')
                    self.assertTrue(info['overflow'])
                    self.assertAlmostEqual(info['courseTop'], info['teacherTop'], delta=2)
                    self.assertLessEqual(info['courseRight'], info['teacherLeft'])
                    self.assertGreaterEqual(info['teacherWidth'] + 1, info['teacherScroll'])
        page.locator('#plazaGrid > .plaza-card .pc-course-btn').focus()
        self.assertTrue(page.locator('#plazaGrid > .plaza-card .pc-course-btn').evaluate('el => el === document.activeElement'))

    def test_preview_and_filtered_leaf(self):
        page = self.browser.new_page(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce')
        page.goto(self.live_server_url + '/plaza?category_id=' + str(self.folder.id))
        trigger = page.locator('[data-plaza-group-open]')
        trigger.wait_for()
        trigger.hover()
        page.locator('.plaza-stack-cards .plaza-card').first.wait_for(state='visible')
        self.assertEqual(page.locator('.plaza-stack-cards .plaza-card').count(), 5)
        title = page.locator('.plaza-stack-cards .plaza-card').first.locator('.pc-title').bounding_box()
        more = page.locator('.plaza-stack-more').bounding_box()
        self.assertGreater(title['height'], 15)
        self.assertLessEqual(title['y'] + title['height'], more['y'] + 1)
        bounds = page.locator('.plaza-stack-cards .plaza-card').evaluate_all(
            "els => els.map(el => {const r = el.getBoundingClientRect(); return [r.left, r.right]})")
        self.assertTrue(all(left >= -2 and right <= 1442 for left, right in bounds))
        page.keyboard.press('Escape')
        page.locator('.plaza-stack-cards .plaza-card').first.wait_for(state='hidden')
        trigger.focus()
        page.locator('.plaza-stack-cards .plaza-card').first.wait_for(state='visible')
        page.locator('.plaza-stack-more').click()
        page.wait_for_function("location.search.includes('teacher=')")
        page.wait_for_selector('#plazaGrid .plaza-card[data-id]')
        self.assertEqual(page.locator('#plazaGrid .plaza-card[data-id]').count(), 5)
        self.assertEqual(page.locator('.plaza-stack').count(), 0)
        self.assertIn('教师：张老师', page.locator('#plazaFilterChips').inner_text())

    def test_collapsed_view_all_navigates_without_opening_preview(self):
        page = self.browser.new_page(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce')
        page.goto(self.live_server_url + '/plaza?category_id=' + str(self.folder.id))
        button = page.locator('.plaza-stack-hint')
        button.wait_for()
        self.assertEqual(button.inner_text(), '查看全部 ›')
        button.hover()
        page.wait_for_timeout(800)
        self.assertEqual(page.locator('.plaza-stack.is-open').count(), 0)
        button.focus()
        page.keyboard.press('Enter')
        page.wait_for_function("location.search.includes('teacher=')")
        page.wait_for_selector('#plazaGrid .plaza-card[data-id]')
        self.assertEqual(page.locator('#plazaGrid .plaza-card[data-id]').count(), 5)
        self.assertIn('教师：张老师', page.locator('#plazaFilterChips').inner_text())
        page.goto(self.live_server_url + '/plaza?category_id=' + str(self.folder.id))
        page.locator('.plaza-stack-hint').click()
        page.wait_for_function("location.search.includes('teacher=')")
        page.wait_for_selector('#plazaGrid .plaza-card[data-id]')
        self.assertEqual(page.locator('#plazaGrid .plaza-card[data-id]').count(), 5)

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
        page.locator('.plaza-stack-more').tap()
        page.wait_for_selector('#plazaGrid .plaza-card[data-id]')
        self.assertEqual(page.locator('#plazaGrid .plaza-card[data-id]').count(), 5)
        page.reload()
        page.wait_for_selector('#plazaGrid .plaza-card[data-id]')
        self.assertIn('教师：张老师', page.locator('#plazaFilterChips').inner_text())

    def test_grid_cards_keep_equal_height_across_rows(self):
        page = self.browser.new_page(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce')
        page.goto(self.live_server_url + '/plaza?category_id=' + str(self.folder.id))
        items = page.locator('#plazaGrid > .plaza-card[data-id], #plazaGrid > .plaza-stack')
        items.first.wait_for()
        self.assertEqual(items.count(), 8)
        colors = page.evaluate("""() => {
          const color = selector => getComputedStyle(document.querySelector(selector)).color;
          return [color('#plazaGrid > .plaza-card .pc-course-btn'), color('.plaza-stack-front .pc-course-name'),
                  color('#plazaGrid > .plaza-card .pc-teacher'), color('.plaza-stack-front .pc-teacher')];
        }""")
        self.assertEqual(colors[0], colors[1])
        self.assertEqual(colors[2], colors[3])
        self.assertNotEqual(colors[0], colors[2])
        for width in (1440, 768, 390):
            with self.subTest(width=width):
                page.set_viewport_size({'width': width, 'height': 900})
                sizes = items.evaluate_all("els => els.map(el => {const r=el.getBoundingClientRect(); return [r.width,r.height]})")
                self.assertLess(max(s[1] for s in sizes) - min(s[1] for s in sizes), 1)
                self.assertLess(max(s[0] for s in sizes) - min(s[0] for s in sizes), 1)
                self.assertTrue(page.locator('#plazaGrid > .plaza-card .pc-actions').first.is_visible())
                self.assertTrue(page.locator('#plazaGrid > .plaza-card[data-id]').evaluate_all(
                    "els => els.every(el => el.querySelector('.pc-actions').getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + 1)"))
                if os.environ.get('BNU_BROWSER_SCREENSHOTS') and width in (1440, 390):
                    page.screenshot(path=os.path.join(os.environ['BNU_BROWSER_SCREENSHOTS'], f'plaza-grid-{width}.png'))

    def test_lightweight_switch_works_in_both_views(self):
        page = self.browser.new_page(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce')
        page.goto(self.live_server_url + '/plaza?category_id=' + str(self.folder.id))
        to_directory = page.locator('#plazaBrowseBar .browse-mode-link')
        to_directory.wait_for()
        for width in (1440, 390):
            page.set_viewport_size({'width': width, 'height': 900})
            self.assertTrue(to_directory.is_visible())
        page.evaluate("document.documentElement.dataset.bnuTheme = 'dark'")
        to_directory.focus()
        page.keyboard.press('Enter')
        page.wait_for_selector('#explorerView.active')
        to_plaza = page.locator('#explorerTopActions .browse-mode-link')
        to_plaza.wait_for(state='visible')
        self.assertEqual(to_plaza.inner_text().strip(), '资料广场')
        to_plaza.click()
        page.wait_for_selector('#plazaView.active')
        self.assertTrue(page.locator('#plazaBrowseBar .browse-mode-link').is_visible())

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
        first_y = (positions[0]['y'] + positions[0]['bottom']) / 2
        self.assertLess(min((p['y'] + p['bottom']) / 2 for p in positions), first_y - 40)
        self.assertGreater(max((p['y'] + p['bottom']) / 2 for p in positions), first_y + 40)
        self.assertEqual(sum((p['y'] + p['bottom']) / 2 < first_y - 40 for p in positions), 2)
        self.assertEqual(sum((p['y'] + p['bottom']) / 2 > first_y + 40 for p in positions), 2)
        self.assertGreater(max((p['x'] + p['right']) / 2 for p in positions), first_center + 40)
        self.assertGreater(max(p['y'] for p in positions) - min(p['y'] for p in positions), 40)
        offsets = sorted((abs((p['y'] + p['bottom']) / 2 - first_y),
                          (p['x'] + p['right']) / 2 - first_center) for p in positions[1:])
        self.assertGreater(offsets[-1][1], offsets[0][1] + 35)
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
                center = (positions[0][1] + positions[0][3]) / 2
                if y == 340:
                    self.assertLess(min((p[1] + p[3]) / 2 for p in positions[1:]), center - 50)
                    self.assertGreater(max((p[1] + p[3]) / 2 for p in positions[1:]), center + 50)
                page.locator('.plaza-stack-backdrop').evaluate('el => el.click()')
                page.locator('.plaza-stack.is-open').wait_for(state='hidden', timeout=1000)
