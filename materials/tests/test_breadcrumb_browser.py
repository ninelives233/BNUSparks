"""页级面包屑的跨页面布局与键盘回归（真实 SPA / API）。

BNU_BROWSER_TESTS=1 python3 manage.py test --settings=bnusparks.settings_test \
    materials.tests.test_breadcrumb_browser
"""
import importlib.util
import json
import os
from pathlib import Path
import unittest

from django.conf import settings
from django.contrib.staticfiles.testing import StaticLiveServerTestCase

from materials.models import CourseCategory, Material, MaterialType, QaQuestion, QaTag
from .helpers import AuthClient, _make_jwt, create_college, create_course, create_user


@unittest.skipUnless(os.environ.get('BNU_BROWSER_TESTS') == '1' and importlib.util.find_spec('playwright'),
                     '设置 BNU_BROWSER_TESTS=1 并安装 Playwright 后运行浏览器验收')
class BreadcrumbBrowserTest(StaticLiveServerTestCase):
    def setUp(self):
        from playwright.sync_api import sync_playwright

        self.user = create_user('209911900081', role='super_admin')
        college = create_college('导航测试学院', 'breadcrumb')
        self.course = create_course('BC_BROWSER', '导航测试课程', college, 'major')
        self.path = ['专业课', '导航测试学院', '测试专业', '第一学年', self.course.name]
        parent = None
        for name in self.path[:-1]:
            parent = CourseCategory.objects.create(name=name, parent=parent)
            # 保留各层级，避免课程树自动折叠唯一子节点。
            CourseCategory.objects.create(name='对照分类', parent=parent)
        CourseCategory.objects.create(name=self.course.name, parent=parent, course=self.course)
        general = CourseCategory.objects.create(name='通识课')
        CourseCategory.objects.create(name='测试通识分类', parent=general)
        CourseCategory.objects.create(name='对照通识分类', parent=general)
        material_type = MaterialType.objects.create(name='笔记', slug='breadcrumb-notes')
        file_path = Path(settings.MEDIA_ROOT) / 'breadcrumb.txt'
        file_path.write_text('导航测试资料', encoding='utf-8')
        self.material = Material.objects.create(
            course=self.course, material_type=material_type, title='导航测试资料',
            uploader=self.user, file_name=file_path.name, file_path=file_path.name,
            file_size=file_path.stat().st_size)
        tag_l1, _ = QaTag.objects.get_or_create(name='通用', level=1)
        tag_l2 = QaTag.objects.create(name='导航测试', level=2)
        self.question = QaQuestion.objects.create(
            title='面包屑导航如何使用？', content='<p>导航回归测试。</p>',
            author=self.user, tag_l1=tag_l1, tag_l2=tag_l2)
        client = AuthClient()
        client.set_token(self.user)
        client.post_json('/api/auth/tutorial/', {'action': 'dismiss_offer'})

        self.pw = sync_playwright().start()
        self.addCleanup(self.pw.stop)
        engine = os.environ.get('BNU_BROWSER_ENGINE', 'chromium')
        self.browser = getattr(self.pw, engine).launch()
        self.addCleanup(self.browser.close)
        self.context = self.browser.new_context(
            viewport={'width': 3440, 'height': 1000}, reduced_motion='reduce')
        self.context.add_init_script('''(() => {
            const state = %s;
            sessionStorage.setItem('token', state.token);
            localStorage.setItem('bnusparks_user_id', String(state.uid));
        })();''' % json.dumps({'uid': self.user.id, 'token': _make_jwt(self.user.id)}))
        self.page = self.context.new_page()
        self.page.set_default_timeout(10000)
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))

    def open_path(self, path, view):
        self.page.goto(self.live_server_url + path)
        self.page.wait_for_function('window._bnusparksReady === true')
        self.page.wait_for_selector('#%sView.active .page-navigation .breadcrumb > a' % view)
        self.page.evaluate('document.fonts.ready')

    def screenshot(self, name):
        output = os.environ.get('BNU_BROWSER_SCREENSHOTS')
        if output:
            Path(output).mkdir(parents=True, exist_ok=True)
            self.page.screenshot(path=str(Path(output) / (name + '.png')))

    def test_shared_position_and_spacing_across_pages(self):
        from playwright.sync_api import expect

        routes = [
            ('/leaderboard', 'leaderboard'), ('/explorer/通识课', 'explorer'),
            ('/explorer/' + '/'.join(self.path), 'explorer'),
            ('/rankings', 'rankings'), ('/recent', 'recentAll'),
            ('/recommendations', 'recommendations'), ('/announcements', 'announcements'),
            ('/broad', 'broad'), ('/qa', 'qa'), ('/qa/compose', 'qaCompose'),
            ('/user/' + str(self.user.id), 'userPublic'), ('/profile', 'profile'),
            ('/notifications', 'notif'), ('/uploads', 'myUploads'),
            ('/downloads', 'myDownloads'), ('/favorites', 'myFavorites'),
            ('/new-course', 'newCourse'), ('/file/' + str(self.material.id), 'fileDetail'),
        ]
        for path, view in routes:
            self.open_path(path, view)
            for width, theme, layout in (
                (3440, 'warm', 'compact'), (2000, 'dark', 'loose'),
                (1440, 'warm', 'compact'), (768, 'dark', 'compact'),
                (640, 'warm', 'loose'), (390, 'dark', 'compact'), (320, 'warm', 'compact'),
            ):
                with self.subTest(path=path, width=width, theme=theme, layout=layout):
                    self.page.set_viewport_size({'width': width, 'height': 1000})
                    self.page.evaluate('''([theme, layout]) => {
                        document.documentElement.dataset.bnuTheme = theme;
                        document.documentElement.dataset.bnuLayout = layout;
                        window.scrollTo({top: 0, behavior: 'instant'});
                    }''', [theme, layout])
                    gutter, top, bottom = (20, 20, 12) if width <= 640 else (32, 24, 16)
                    # 浏览器视口命令返回后，媒体查询仍可能在下一帧才更新。
                    expect(self.page.locator('.view-section.active .page-navigation')).to_have_css(
                        'padding-left', f'{gutter}px')
                    geometry = self.page.evaluate('''async () => {
                        // 断点样式与课程列表 DOM 都由 resize 更新；等下一帧再测量。
                        await new Promise(requestAnimationFrame);
                        const rect = el => {
                            const r = el.getBoundingClientRect();
                            return {x:r.x, y:r.y, right:r.right, bottom:r.bottom, height:r.height};
                        };
                        const view = document.querySelector('.view-section.active');
                        const nav = view.querySelector('.page-navigation');
                        const bc = nav.querySelector('.breadcrumb');
                        return {main:rect(document.querySelector('main')), nav:rect(nav),
                            bc:rect(bc), home:rect(bc.querySelector('a')),
                            content:rect(nav.nextElementSibling || nav.parentElement.nextElementSibling),
                            overflow:nav.scrollWidth > nav.clientWidth};
                    }''')
                    self.assertAlmostEqual(geometry['nav']['x'], geometry['main']['x'], delta=1)
                    self.assertAlmostEqual(geometry['nav']['y'], geometry['main']['y'], delta=1)
                    self.assertAlmostEqual(geometry['bc']['x'] - geometry['main']['x'], gutter, delta=1)
                    self.assertAlmostEqual(geometry['bc']['y'] - geometry['nav']['y'], top, delta=1)
                    self.assertAlmostEqual(geometry['bc']['height'], 40, delta=1)
                    self.assertAlmostEqual(geometry['home']['y'] - geometry['bc']['y'],
                                           (40 - geometry['home']['height']) / 2, delta=1)
                    self.assertAlmostEqual(geometry['nav']['bottom'] - geometry['bc']['bottom'], bottom, delta=1)
                    self.assertAlmostEqual(geometry['content']['y'], geometry['nav']['bottom'], delta=1)
                    self.assertFalse(geometry['overflow'])
                    if view in ('leaderboard', 'explorer', 'fileDetail') and width in (3440, 390):
                        kind = '-root' if path == '/explorer/通识课' else ''
                        self.screenshot(f'{view}{kind}-{width}-{theme}')
                    if path == '/explorer/通识课':
                        self.page.evaluate('toggleMgmtMode()')
                        self.page.wait_for_selector('#explorerTopActions .mgmt-new-btn')
                        managed_home = self.page.locator('#breadcrumb > a').first.bounding_box()
                        self.assertAlmostEqual(managed_home['x'], geometry['home']['x'], delta=1)
                        self.assertAlmostEqual(managed_home['y'], geometry['home']['y'], delta=1)
                        self.page.evaluate('toggleMgmtMode()')
        self.assertEqual(self.errors, [])

    def test_keyboard_expansion_navigation_and_qa_detail(self):
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.open_path('/explorer/' + '/'.join(self.path), 'explorer')
        ellipsis = self.page.locator('#breadcrumb .bc-ellipsis')
        ellipsis.focus()
        self.page.keyboard.press('Enter')
        self.assertIn('bc-expanded', self.page.locator('#breadcrumb').get_attribute('class'))
        self.assertTrue(self.page.locator('#breadcrumb .bc-mid').first.is_visible())
        self.assertFalse(self.page.evaluate('document.documentElement.scrollWidth > innerWidth'))
        self.screenshot('explorer-390-expanded')

        self.page.evaluate('showHome(); showLeaderboard()')
        self.page.wait_for_selector('#leaderboardView.active .page-navigation')
        home = self.page.locator('#leaderboardView .breadcrumb a')
        home.focus()
        self.assertEqual(home.evaluate('el => getComputedStyle(el).outlineStyle'), 'solid')
        self.page.keyboard.press('Enter')
        self.page.wait_for_selector('#homeView.active')
        self.page.wait_for_url(self.live_server_url + '/')
        self.page.go_back()
        self.page.wait_for_selector('#leaderboardView.active .page-navigation')

        self.page.goto(self.live_server_url + '/qa/questions/' + str(self.question.id))
        self.page.wait_for_selector('#qaView.qa-detail-mode #qaContent .qa-detail')
        self.assertFalse(self.page.locator('#qaView .page-navigation').is_visible())
        self.assertEqual(self.errors, [])
