"""真实页面、真实 API 的移动详情回归（可选 Playwright）。

BNU_BROWSER_TESTS=1 python3 manage.py test --settings=bnusparks.settings_test \
    materials.tests.test_file_detail_browser
BNU_BROWSER_SCREENSHOTS 指定截图目录；测试数据仅写入临时测试数据库/上传目录。
"""
import importlib.util
import os
from pathlib import Path
import unittest
from concurrent.futures import ThreadPoolExecutor

from django.db import connections

from django.conf import settings
from django.contrib.auth.models import User
from django.contrib.staticfiles.testing import StaticLiveServerTestCase
from materials.models import College, Course, CourseCategory, Material, MaterialType, UserProfile


@unittest.skipUnless(os.environ.get('BNU_BROWSER_TESTS') == '1' and importlib.util.find_spec('playwright'),
                     '设置 BNU_BROWSER_TESTS=1 并安装 Playwright 后运行浏览器验收')
class FileDetailBrowserTest(StaticLiveServerTestCase):
    def setUp(self):
        from playwright.sync_api import sync_playwright
        self.uploader = User.objects.create_user('fd_owner', password='browser-test-only', first_name='资料上传者的很长昵称用于验证窄屏省略')
        self.reader = User.objects.create_user('fd_reader', password='browser-test-only', first_name='浏览器测试用户')
        for user in (self.uploader, self.reader):
            UserProfile.objects.update_or_create(user=user, defaults={'identity_education': '本科', 'identity_college': '测试学院', 'identity_major': '数学', 'mobile_nav': 'burger'})
        college = College.objects.create(name='浏览器测试学院', slug='fd-browser')
        course = Course.objects.create(name='微积分 I', code='FD_BROWSER', college=college)
        parent = None
        for name in ('专业课', '本科课程', '浏览器测试学院', '数学', '第一学年'):
            parent = CourseCategory.objects.create(name=name, parent=parent)
        CourseCategory.objects.create(name=course.name, parent=parent, course=course)
        material_type = MaterialType.objects.create(name='真题', slug='fd-exam')
        self.files = {}
        for key, title, desc, filename in (
            ('description', '2021–2022 学年第一学期期中考试试卷', '第四版课本，含计算题和证明题的解题说明。', '期中试卷原版.txt'),
            ('empty', '课程复习提纲', '', '课程复习提纲.txt'),
            ('long', '2021–2022 学年第一学期微积分 I 期中考试试卷及详细参考答案与教学补充说明用于验证完整自然换行', '本资料包含完整的复习内容。', '微积分期中考试及参考答案_完整原始文件名称_用于验证文件名可换行.txt'),
            ('pdf', '期中考试 PDF 试卷', 'PDF 下载后查看。', '期中考试 PDF 试卷.pdf'),
        ):
            path = Path(settings.MEDIA_ROOT) / filename
            path.write_text('微积分 I\n\n一、计算题\n求函数 f(x) = x² 的导数。\n\n二、证明题\n说明连续与可导之间的关系。\n', encoding='utf-8')
            self.files[key] = Material.objects.create(course=course, material_type=material_type,
                title=title, description=desc, teacher='测试教师', uploader=self.uploader,
                file_name=filename, file_path=filename, file_size=path.stat().st_size,
                view_count=17, download_count=13)
        self.pw = sync_playwright().start()
        try:
            self.browser = self.pw.chromium.launch()
        except Exception:
            self.pw.stop()
            raise
        self.context = self.browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1)
        self.page = self.context.new_page()
        self.page.set_default_timeout(8000)
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.login(self.reader)

    def tearDown(self):
        if hasattr(self, 'browser'):
            self.browser.close()
            self.pw.stop()

    @staticmethod
    def db_call(func, **kwargs):
        # Playwright 的同步包装在调用线程保留 asyncio 循环；ORM 写入放入独立线程。
        def call():
            try:
                return func(**kwargs)
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(call).result()

    def login(self, user):
        self.page.goto(self.live_server_url + '/')
        self.page.wait_for_function("typeof ensureFeature === 'function'")
        result = self.page.evaluate('''async credentials => {
            const response = await fetch('/api/auth/login/', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(credentials)});
            const result = await response.json();
            if (result.ok) { localStorage.setItem('token', result.data.token); sessionStorage.setItem('token', result.data.token); }
            return result.ok;
        }''', {'username': user.username, 'password': 'browser-test-only'})
        self.assertTrue(result)

    def open_file(self, key, width=390, theme='warm'):
        self.page.set_viewport_size({'width': width, 'height': 844})
        self.page.goto(self.live_server_url + '/')
        self.page.wait_for_function("typeof currentUser !== 'undefined' && currentUser")
        self.page.evaluate("navToCourse('专业课', 'FD_BROWSER')")
        selector = ('.mf-row[data-file-id="%s"] .mf-text' if width <= 768 else 'tr[data-file-id="%s"] .fn-text') % self.files[key].id
        self.page.locator(selector).click()
        self.page.wait_for_url('**/file/' + str(self.files[key].id))
        try:
            self.page.wait_for_selector('#fileDetailView.active #fdTitle')
        except Exception:
            self.screenshot('debug-open-failure')
            print('PAGE', self.page.url, self.page.locator('body').inner_text()[:1500], self.errors, flush=True)
            raise
        self.page.wait_for_function("document.querySelector('#fdTitle').textContent && !document.querySelector('#fdTitle').textContent.includes('加载中')")
        self.page.evaluate("theme => document.documentElement.setAttribute('data-bnu-theme', theme)", theme)
        self.page.wait_for_function("!document.querySelector('#fdPreviewBody').textContent.includes('正在加载')")
        self.page.evaluate('document.fonts.ready')

    def screenshot(self, name):
        output = os.environ.get('BNU_BROWSER_SCREENSHOTS')
        if output:
            Path(output).mkdir(parents=True, exist_ok=True)
            self.page.locator('#fileDetailView').screenshot(path=str(Path(output) / (name + '.png')))

    def assert_mobile_geometry(self, key, width):
        result = self.page.evaluate('''() => {
            const rect = s => { const r=document.querySelector(s).getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
            const attrs=[...document.querySelectorAll('.fdm-attr')].map(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y}));
            return {overflow:document.documentElement.scrollWidth>innerWidth,
                title:rect('#fdTitle'), meta:rect('.fd-meta1'), social:rect('.fd-social-area'),
                actions:rect('#fdActions'), preview:rect('#fdPreviewArea'),
                desc:document.querySelector('.fd-desc-area').hidden ? null : rect('.fd-desc-area'),
                attrs, stats:[...document.querySelectorAll('.fdm-stat')].map(e=>e.getBoundingClientRect().width),
                buttons:[...document.querySelectorAll('#fdActions button')].map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,label:e.getAttribute('aria-label')})),
                titleSize:getComputedStyle(document.querySelector('#fdTitle')).fontSize};
        }''')
        self.assertFalse(result['overflow'], (key, width, result))
        self.assertEqual(result['titleSize'], '22px')
        for region in ('title', 'meta', 'social', 'actions', 'preview'):
            self.assertAlmostEqual(result[region]['x'], 16, delta=1)
            self.assertAlmostEqual(result[region]['right'], width-16, delta=1)
        self.assertEqual(len(result['attrs']), 4)
        self.assertEqual(result['attrs'][0]['x'], result['attrs'][2]['x'])
        self.assertEqual(result['attrs'][1]['x'], result['attrs'][3]['x'])
        self.assertEqual(result['attrs'][0]['y'], result['attrs'][1]['y'])
        self.assertEqual(len(set(result['stats'])), 1)
        for btn in result['buttons']:
            self.assertAlmostEqual(btn['height'], 44)
        for btn in result['buttons'][1:]:
            self.assertAlmostEqual(btn['width'], 44)
            self.assertTrue(btn['label'])
        if key != 'empty':
            self.assertAlmostEqual(result['desc']['y']-result['title']['bottom'], 8, delta=1)
            self.assertAlmostEqual(result['meta']['y']-result['desc']['bottom'], 16, delta=1)
        else:
            self.assertIsNone(result['desc'])
            self.assertAlmostEqual(result['meta']['y']-result['title']['bottom'], 16, delta=1)
        self.assertAlmostEqual(result['social']['y']-result['meta']['bottom'], 16, delta=1)
        self.assertAlmostEqual(result['actions']['y']-result['social']['bottom'], 16, delta=1)
        self.assertAlmostEqual(result['preview']['y']-result['actions']['bottom'], 16, delta=1)
        self.assertEqual(self.page.locator('#fdMoreBtn, #fdFileInfo, .fdm-desc-toggle').count(), 0)

    def test_mobile_matrix_and_preview_states(self):
        for width in (320, 375, 390, 430):
            for theme in ('warm', 'dark'):
                for key in ('description', 'empty', 'long'):
                    with self.subTest(width=width, theme=theme, key=key):
                        self.open_file(key, width, theme)
                        self.assert_mobile_geometry(key, width)
                        self.assertIn('求函数', self.page.locator('#fdPvTextContent').inner_text())
                        if key == 'empty':
                            self.assertEqual(self.page.locator('.fdm-filename').count(), 0)
                        self.screenshot(f'{width}-{theme}-{key}-preview-success')
        self.open_file('pdf', 375)
        self.assertEqual(self.page.locator('#fdPreviewBody iframe').count(), 0)
        self.assertNotIn('前 3 页', self.page.locator('#fdPreviewArea').inner_text())
        self.assertNotIn('系统查看器', self.page.locator('#fdPreviewArea').inner_text())
        self.assertLess(self.page.locator('#fdPreviewBody').bounding_box()['height'], 190)
        self.screenshot('375-warm-pdf-unavailable')
        # 只拦截失败响应；其余展示数据和预览内容均走本地真实 API。
        self.page.route('**/download/?*', lambda route: route.fulfill(status=503, body='preview unavailable'))
        for width in (320, 375, 390, 430):
            for theme in ('warm', 'dark'):
                self.open_file('description', width, theme)
                self.page.wait_for_selector('.pv-retry-btn')
                self.assert_mobile_geometry('description', width)
                self.assertLess(self.page.locator('#fdPreviewBody').bounding_box()['height'], 170)
                self.screenshot(f'{width}-{theme}-preview-failure')
        self.page.unroute('**/download/?*')
        self.page.get_by_role('button', name='重试', exact=True).click()
        self.page.wait_for_selector('#fdPvTextContent')
        self.assertIn('求函数', self.page.locator('#fdPvTextContent').inner_text())
        self.assertEqual(self.errors, [])

    def test_description_panel_and_report_warning_icon(self):
        for width in (320, 390, 1200):
            for theme in ('warm', 'dark'):
                self.open_file('description', width, theme)
                self.assertEqual(self.page.locator('.fd-desc-label').inner_text(), '资料说明')
                style = self.page.locator('.fd-desc-card').evaluate('''el => ({
                    border: getComputedStyle(el).borderLeftWidth,
                    overflow: el.scrollWidth > el.clientWidth
                })''')
                self.assertEqual(style['border'], '2px')
                self.assertFalse(style['overflow'])
                self.assertEqual(self.page.locator('#fdRepBtn use').get_attribute('href'), '#ui-icon-alert')
                self.assertEqual(self.page.locator('#fdRepBtn svg').get_attribute('aria-hidden'), 'true')
                self.screenshot(f'{width}-{theme}-description-warning')
        content = '<img src=x onerror="window.unsafeDescription=true">\n' + '长简介内容' * 100
        self.db_call(Material.objects.filter(pk=self.files['description'].pk).update, description=content)
        self.open_file('description', 320)
        self.assertEqual(self.page.locator('.fd-desc-body').inner_text(), content)
        self.assertEqual(self.page.locator('.fd-desc-body img').count(), 0)
        self.assertFalse(self.page.evaluate('Boolean(window.unsafeDescription)'))
        self.db_call(Material.objects.filter(pk=self.files['description'].pk).update, description=' \n ')
        for width in (320, 1200):
            self.open_file('description', width)
            self.assertFalse(self.page.locator('.fd-desc-area').is_visible())
        self.assertEqual(self.errors, [])

    def test_missing_fields_long_values_and_escaping(self):
        material = self.files['long']
        material.teacher = '教师姓名很长需要在本列换行' * 6
        material.description = '<img src=x onerror=alert(1)> 作为简介文字安全显示'
        self.db_call(material.save, update_fields=['teacher', 'description'])
        self.open_file('long', 320, 'dark')
        self.assert_mobile_geometry('long', 320)
        self.assertEqual(self.page.locator('.fd-desc-area img').count(), 0)
        self.assertIn('<img', self.page.locator('.fd-desc-area').inner_text())
        self.screenshot('320-dark-long-teacher-and-safe-description')
        material = self.files['empty']
        material.teacher = ''
        material.material_type = None
        self.db_call(material.save, update_fields=['teacher', 'material_type'])
        self.open_file('empty', 320)
        self.assertEqual(self.page.locator('.fdm-attr-label').all_text_contents(), ['类型', '大小', '上传'])
        self.assertNotIn('未填写', self.page.locator('.fd-meta1').inner_text())
        self.assertFalse(self.page.evaluate('document.documentElement.scrollWidth > innerWidth'))
        self.login(self.uploader)
        self.open_file('empty', 320)
        self.page.get_by_role('button', name='添加教师', exact=True).click()
        self.page.locator('[data-field="teacher"] input').fill('新教师')
        self.page.keyboard.press('Enter')
        self.page.wait_for_function("document.querySelector('.fd-meta1').textContent.includes('新教师') && !document.querySelector('.fd-meta1 input')")
        self.page.get_by_role('button', name='添加简介', exact=True).click()
        self.page.locator('[data-field="description"] input').fill('新增简介')
        self.page.keyboard.press('Enter')
        self.page.wait_for_function("document.querySelector('.fd-desc-area').textContent.includes('新增简介') && !document.querySelector('.fd-desc-area input')")
        self.db_call(material.refresh_from_db)
        self.assertEqual(material.teacher, '新教师')
        self.assertEqual(material.description, '新增简介')
        self.assertEqual(self.errors, [])

    def test_actions_breadcrumb_keyboard_and_desktop(self):
        self.open_file('description', 320)
        favorite = self.page.locator('#fdFavBtn')
        favorite.focus()
        self.page.keyboard.press('Enter')
        self.page.wait_for_function("document.querySelector('#fdFavBtn').getAttribute('aria-pressed')==='true'")
        self.assertEqual(favorite.inner_text(), '')
        self.assertEqual(favorite.get_attribute('aria-label'), '取消收藏')
        self.assertEqual(self.page.locator('.fdm-stat').nth(2).locator('b').inner_text(), '1')
        self.page.reload()
        self.page.wait_for_selector('#fdFavBtn[aria-pressed="true"]')
        self.open_file('description', 320)
        with self.page.expect_download() as download:
            self.page.get_by_role('button', name='下载文件', exact=True).click()
        self.assertIsNone(download.value.failure())
        self.page.locator('#fdRepBtn').click()
        self.page.wait_for_selector('.report-overlay')
        self.page.keyboard.press('Escape')
        self.page.wait_for_selector('.report-overlay', state='detached')
        self.page.locator('#fdBreadcrumb .bc-ellipsis').click()
        self.assertGreaterEqual(self.page.locator('#fdBreadcrumb a').count(), 5)
        self.screenshot('320-warm-breadcrumb-expanded')
        self.page.locator('#fdBreadcrumb a').filter(has_text='微积分 I').click()
        self.page.wait_for_url('**/explorer/**')
        self.open_file('description', 390, 'dark')
        self.page.emulate_media(reduced_motion='reduce')
        self.page.locator('.fdu-card').focus()
        self.page.keyboard.press('Enter')
        self.page.wait_for_url('**/user/**')
        self.login(self.uploader)
        self.open_file('empty', 320)
        self.assert_mobile_geometry('empty', 320)
        self.assertEqual(self.page.locator('#fdActions button').count(), 4)
        self.page.get_by_role('button', name='添加简介', exact=True).click()
        self.assertTrue(self.page.locator('[data-field="description"] input').is_visible())
        self.page.keyboard.press('Escape')
        dialogs = []
        def dismiss_delete(dialog):
            dialogs.append(dialog.message)
            dialog.dismiss()
        self.page.once('dialog', dismiss_delete)
        self.page.get_by_role('button', name='删除', exact=True).click()
        self.assertTrue(dialogs and '确认删除' in dialogs[0])
        self.open_file('description', 1200)
        self.assertTrue(self.page.locator('.fd-desc-card').is_visible())
        self.assertIn('收藏', self.page.locator('#fdFavBtn').inner_text())
        self.assertTrue(self.page.locator('.fd-type-select').is_visible())
        self.screenshot('1200-warm-desktop-editor')
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.page.wait_for_selector('.fdm-attrs')
        self.page.wait_for_function("getComputedStyle(document.querySelector('#fdTitle')).fontSize==='22px'")
        self.assert_mobile_geometry('description', 390)
        self.assertEqual(self.errors, [])
