"""排行榜和最近上传的资料必须跳向被点击的文件。"""
import importlib.util
import os
import unittest

from django.contrib.staticfiles.testing import StaticLiveServerTestCase
from django.core.cache import cache

from materials.models import Favorite, Material

from .helpers import _make_jwt, create_category, create_college, create_course, create_user


@unittest.skipUnless(os.environ.get('BNU_BROWSER_TESTS') == '1' and importlib.util.find_spec('playwright'),
                     '设置 BNU_BROWSER_TESTS=1 并安装 Playwright 后运行浏览器验收')
class RankingsNavigationBrowserTest(StaticLiveServerTestCase):
    def setUp(self):
        from playwright.sync_api import sync_playwright

        cache.clear()
        self.user = create_user('2099ranking_nav')
        self.undergrad_user = create_user('2099ranking_undergrad')
        self.fallback_user = create_user('2099ranking_fallback')
        self.fallback_user.profile.identity_education = '硕士'
        self.fallback_user.profile.identity_college = '法学院'
        self.fallback_user.profile.identity_major = '法学'
        self.fallback_user.profile.save()
        self.user.profile.identity_education = '硕士'
        self.user.profile.identity_college = '测试学院'
        self.user.profile.save()
        college = create_college('测试学院', 'ranking-nav')
        root = create_category('专业课')
        college_node = create_category('测试学院', parent=root)
        undergrad = create_category('本科专业', parent=college_node)
        master = create_category('硕士', parent=college_node)
        master.education_level = '硕士'
        master.save()
        create_category('研究生专业', parent=master)
        law = create_college('法学院', 'ranking-nav-law')
        law_cat = create_category('法学院', parent=root)
        law_major = create_category('法学', parent=law_cat)
        law_course = create_course('RANKLAW', '法学课程', college=law)
        create_category(law_course.name, parent=law_major, course=law_course)
        self.files = []
        for i in range(2):
            course = create_course('RANKNAV' + str(i), '本科课程' + str(i), college=college)
            create_category(course.name, parent=undergrad, course=course)
            material = Material.objects.create(course=course, uploader=self.user, title='排行资料' + str(i),
                file_name='test.pdf', file_path='test.pdf', file_size=1024, review_status='approved',
                is_approved=True, download_count=10 + i)
            self.files.append(material)
        self.files.append(Material.objects.create(
            course=self.files[0].course, uploader=self.user, title='同课另一份资料',
            file_name='another.pdf', file_path='another.pdf', file_size=1024,
            review_status='approved', is_approved=True, download_count=20))
        Favorite.objects.create(user=self.undergrad_user, material=self.files[1])
        token = _make_jwt(self.user.id)
        self.pw = sync_playwright().start()
        self.addCleanup(self.pw.stop)
        self.browser = getattr(self.pw, os.environ.get('BNU_BROWSER_ENGINE', 'chromium')).launch()
        self.addCleanup(self.browser.close)
        self.context = self.browser.new_context(viewport={'width': 1280, 'height': 800})
        self.page = self.context.new_page()
        self.page.set_default_timeout(10000)
        self.page.add_init_script('sessionStorage.setItem("token", ' + repr(token) + ');')
        self.page.route('**/api/auth/tutorial/**', lambda route: route.fulfill(json={'ok': True, 'data': {'eligible': False}}))

    def test_graduate_opens_actual_material_from_rankings_and_recent(self):
        self.page.goto(self.live_server_url + '/rankings')
        self.page.wait_for_function('window._bnusparksReady === true && currentUser')
        self.page.wait_for_selector('#rankingsContent .rankings-item')
        for material in self.files:
            self.page.locator('#rankingsContent .rankings-item').filter(has=self.page.get_by_text(material.title, exact=True)).click()
            self.page.wait_for_url('**/file/' + str(material.id))
            self.page.wait_for_function('(title) => document.querySelector("#fdTitle").textContent.includes(title)', arg=material.title)
            self.page.go_back()
            self.page.wait_for_url('**/rankings')
            self.page.wait_for_selector('#rankingsContent .rankings-item')
        self.page.evaluate('showRecentAll()')
        self.page.wait_for_selector('#recentAllContent .rankings-item')
        self.page.locator('#recentAllContent .rankings-item', has_text=self.files[0].title).click()
        self.page.wait_for_url('**/file/' + str(self.files[0].id))
        self.page.wait_for_function('(title) => document.querySelector("#fdTitle").textContent.includes(title)', arg=self.files[0].title)

    def test_visible_course_opens_exact_material_for_undergraduate(self):
        context = self.browser.new_context(viewport={'width': 390, 'height': 844}, reduced_motion='reduce')
        self.addCleanup(context.close)
        page = context.new_page()
        page.add_init_script('sessionStorage.setItem("token", ' + repr(_make_jwt(self.undergrad_user.id)) + ');')
        page.set_default_timeout(10000)
        page.goto(self.live_server_url + '/rankings')
        page.wait_for_function('window._bnusparksReady === true && currentUser')
        for material in (self.files[0], self.files[2]):
            item = page.locator('#rankingsContent .rankings-item').filter(has=page.get_by_text(material.title, exact=True))
            item.focus()
            item.press('Enter')
            page.wait_for_url('**/file/' + str(material.id))
            page.wait_for_function('(title) => document.querySelector("#fdTitle").textContent === title', arg=material.title)
            page.go_back()
            page.wait_for_url('**/rankings')
        page.locator('#rankingsModeTabs [data-ranking-type="favorite"]').click()
        item = page.locator('#rankingsContent .rankings-item').filter(has=page.get_by_text(self.files[1].title, exact=True))
        item.click()
        page.wait_for_url('**/file/' + str(self.files[1].id))
        page.wait_for_function('(title) => document.querySelector("#fdTitle").textContent === title', arg=self.files[1].title)

    def test_guest_is_prompted_to_log_in(self):
        context = self.browser.new_context(viewport={'width': 390, 'height': 844}, reduced_motion='reduce')
        self.addCleanup(context.close)
        page = context.new_page()
        page.goto(self.live_server_url + '/rankings')
        page.wait_for_function('window._bnusparksReady === true && currentUser === null')
        page.locator('#rankingsContent .rankings-item', has_text=self.files[0].title).click()
        page.wait_for_selector('#loginModal', state='visible')
        self.assertEqual(page.evaluate('location.pathname'), '/rankings')

    def test_master_without_own_directory_browses_undergraduate_scope(self):
        context = self.browser.new_context(viewport={'width': 390, 'height': 844},
                                           color_scheme='dark', reduced_motion='reduce')
        self.addCleanup(context.close)
        page = context.new_page()
        page.set_default_timeout(10000)
        page.add_init_script('sessionStorage.setItem("token", ' + repr(_make_jwt(self.fallback_user.id)) + ');')
        page.goto(self.live_server_url + '/')
        page.wait_for_function('window._bnusparksReady === true && currentUser')
        self.assertEqual(page.evaluate('currentUser.identity_education'), '硕士')
        self.assertEqual(page.evaluate('currentUser.course_navigation_education'), '本科')
        page.evaluate("setLastCourseRange('专业课'); showAllCourses()")
        page.wait_for_function("typeof expPath !== 'undefined' && expPath.includes('法学院')")
        self.assertNotIn('测试学院', page.evaluate('expPath'))
        self.assertFalse(page.evaluate('_isGraduateIdentity()'))
        page.evaluate('showTopDownloaded()')
        page.locator('#rankingsContent .rankings-item', has_text=self.files[0].title).click()
        page.wait_for_url('**/file/' + str(self.files[0].id))
        page.wait_for_function('(title) => document.querySelector("#fdTitle").textContent === title', arg=self.files[0].title)

    def test_wide_home_rank_and_recent_open_exact_material(self):
        context = self.browser.new_context(viewport={'width': 1280, 'height': 800})
        self.addCleanup(context.close)
        page = context.new_page()
        page.set_default_timeout(10000)
        page.add_init_script('sessionStorage.setItem("token", ' + repr(_make_jwt(self.undergrad_user.id)) + ');')
        page.goto(self.live_server_url + '/')
        page.wait_for_function('window._bnusparksReady === true && currentUser && document.querySelector("#homeView.active")')
        page.evaluate('''async () => {
          document.body.classList.remove('home-layout-compact');
          document.body.dataset.homeLayout = 'loose';
          await loadStats();
        }''')
        page.locator('#topDownloadedList .hc-item').filter(
            has=page.get_by_text(self.files[0].title, exact=True)).click()
        page.wait_for_url('**/file/' + str(self.files[0].id))
        page.wait_for_function('(title) => document.querySelector("#fdTitle").textContent === title',
                               arg=self.files[0].title)
        page.go_back()
        page.wait_for_url(self.live_server_url + '/')
        page.locator('#recentUploadsList .hc-item').filter(
            has=page.get_by_text(self.files[2].title, exact=True)).click()
        page.wait_for_url('**/file/' + str(self.files[2].id))
        page.wait_for_function('(title) => document.querySelector("#fdTitle").textContent === title',
                               arg=self.files[2].title)
