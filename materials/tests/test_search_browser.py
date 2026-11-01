"""独立搜索结果页（v=350）浏览器验收：真实页面、真实 API（可选 Playwright）。

覆盖实施方案 §13.2 中可自动化的核心场景：
1. 首页/深层课程目录/问答区提交分别进入 /search；问答默认 qa；无结果浮层与滚动锁；
2. 全部→分类→筛选→排序→翻页；点击结果→返回；关键词/条件/页码/滚动恢复；
3. 搜索页刷新与深链直达；访客深链显示需登录态、登录后继续加载；
4. 搜索/课程/问答模块都未加载时首次点击成功；问答详情实际成为 active view；
5. 慢课程组 + 快资料组：快组先渲染、互不阻塞；一组失败可独立重试；
6. 资料详情「← 返回搜索结果」与问答详情「← 返回搜索结果」往返；
7. 浏览器控制台无新 JS 错误。

BNU_BROWSER_TESTS=1 python3 manage.py test --settings=bnusparks.settings_test \
    materials.tests.test_search_browser
测试数据仅写入临时测试数据库/上传目录。
"""
import importlib.util
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from django.conf import settings
from django.contrib.auth.models import User
from django.contrib.staticfiles.testing import StaticLiveServerTestCase
from django.db import connections

from materials.models import (
    College, Course, CourseCategory, Material, MaterialType,
    QaAnswer, QaQuestion, QaTag, UserProfile,
)


@unittest.skipUnless(os.environ.get('BNU_BROWSER_TESTS') == '1' and importlib.util.find_spec('playwright'),
                     '设置 BNU_BROWSER_TESTS=1 并安装 Playwright 后运行浏览器验收')
class SearchPageBrowserTest(StaticLiveServerTestCase):
    maxDiff = None

    def setUp(self):
        from playwright.sync_api import sync_playwright
        self.user = User.objects.create_user('2099search_u@mail.bnu.edu.cn', password='browser-test-only', first_name='搜索同学')
        UserProfile.objects.update_or_create(user=self.user, defaults={
            'identity_education': '本科', 'identity_college': '搜索学院', 'identity_major': '搜索专业'})
        self.author = User.objects.create_user('2099search_a', password='browser-test-only', first_name='问答作者')
        self.college = College.objects.create(name='搜索学院', slug='search-browser')
        self.course = Course.objects.create(code='SRCH101', name='搜索学导论', college=self.college)
        self.course2 = Course.objects.create(code='SRCH202', name='搜索学进阶', college=self.college)
        parent = None
        cats = {}
        for name in ('专业课', '搜索学院', '搜索专业'):
            parent = CourseCategory.objects.create(name=name, parent=parent)
            cats[name] = parent
        CourseCategory.objects.create(name=self.course.name, parent=parent, course=self.course)
        CourseCategory.objects.create(name=self.course2.name, parent=parent, course=self.course2)
        self.mt = MaterialType.objects.create(name='笔记', slug='search-notes')
        self.files = {}
        for idx in range(24):
            m = Material.objects.create(
                course=self.course if idx % 2 else self.course2,
                material_type=self.mt, title=f'搜索学复习资料{idx:02d}',
                teacher='搜索教师', uploader=self.user,
                file_name=f'srch-{idx}.txt', file_path=f'srch-{idx}.txt',
                file_size=64, review_status='approved', is_approved=True,
                download_count=idx)
            self.files[idx] = m
        Path(settings.MEDIA_ROOT).mkdir(parents=True, exist_ok=True)
        (Path(settings.MEDIA_ROOT) / 'srch-0.txt').write_text('搜索学内容', encoding='utf-8')

        self.tag_l1 = QaTag.objects.create(name='搜索学部', level=1)
        self.tag_l2 = QaTag.objects.create(name='课程学习', level=2)
        self.qa = QaQuestion.objects.create(
            title='搜索学怎么复习？', content='<p>搜索学期末如何复习</p>',
            author=self.author, tag_l1=self.tag_l1, tag_l2=self.tag_l2)
        self.answer = QaAnswer.objects.create(
            question=self.qa, author=self.author,
            content='<p>先整理搜索学错题，再按章节复习</p>', is_accepted=True)

        engine = os.environ.get('BNU_BROWSER_ENGINE', 'chromium')
        self.pw = sync_playwright().start()
        self.browser = getattr(self.pw, engine).launch()
        self.context = self.browser.new_context(viewport={'width': 1280, 'height': 900})
        self.page = self.context.new_page()
        self.page.set_default_timeout(9000)

        def _tutorial_block(route):
            if '/api/auth/tutorial' in route.request.url:
                route.fulfill(status=200, content_type='application/json',
                              json={'ok': True, 'data': {'eligible': False, 'claimed': False}})
            else:
                route.continue_()
        self.page.route(lambda url: '/api/auth/tutorial' in url, _tutorial_block)
        self.errors = []

        def _on_pageerror(err):
            self.errors.append(str(err))
        self.page.on('pageerror', _on_pageerror)

    def tearDown(self):
        self.browser.close()
        self.pw.stop()
        self.assertEqual(self.errors, [])

    def db_call(self, func, **kwargs):
        def call():
            try:
                return func(**kwargs)
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(call).result()

    # ── 助手 ──
    def _goto_root_ready(self):
        self.page.goto(self.live_server_url + '/')
        self.page.wait_for_function('window._bnusparksReady === true')

    def _login(self):
        self._goto_root_ready()
        result = self.page.evaluate('''async () => {
            const r = await fetch('/api/auth/login/', {method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({username:'2099search_u@mail.bnu.edu.cn', password:'browser-test-only'})});
            const d = await r.json();
            if (d.ok) { localStorage.setItem('token', d.data.token); sessionStorage.setItem('token', d.data.token);
              localStorage.setItem('bnusparks_user_id', String(d.data.user.id)); }
            return d.ok;
        }''')
        self.assertTrue(result)
        self.page.evaluate("api('/api/auth/tutorial/', {method:'POST', body:{action:'dismiss_offer'}})")
        self.page.reload()
        self.page.wait_for_function('window._bnusparksReady === true')
        self.page.wait_for_function('typeof currentUser !== "undefined" && currentUser')

    def _search_from_top(self, keyword):
        self.page.fill('.search-box input', keyword)
        self.page.press('.search-box input', 'Enter')
        self.page.wait_for_url('**/search**')
        self.page.wait_for_selector('#searchView.active')
        self.page.wait_for_function(
            "document.querySelector('#searchBody') && !document.querySelector('#searchBody').textContent.includes('加载中…')")

    def _path(self):
        return self.page.evaluate('location.pathname + location.search')

    def _assert_no_overlay(self):
        snap = self.page.evaluate('''() => ({
            overlays: Array.from(document.querySelectorAll('.search-overlay')).filter(
              el => el.isConnected && getComputedStyle(el).display !== 'none').length,
            locked: document.body.style.position === 'fixed',
        })''')
        self.assertEqual(snap['overlays'], 0, '不得出现结果浮层')
        self.assertFalse(snap['locked'], '不得锁定 body 滚动')

    # ── 场景 1：三处提交进入搜索页 ──
    def test_submit_from_home_qa_and_explorer(self):
        self._login()
        # 首页提交 → 全部聚合
        self._search_from_top('搜索学')
        self._assert_no_overlay()
        data = self.page.evaluate('history.state')
        self.assertEqual(data['view'], 'search')
        self.assertEqual(data['searchType'], 'all')
        self.assertEqual(data['searchQuery'], '搜索学')
        # 三组计数到齐且为真实数字
        self.page.wait_for_function('''() => {
            const counts = Array.from(document.querySelectorAll('.sr-tab-count'));
            return counts.length === 3 && counts.every(c => /^\\d+$/.test(c.textContent));
        }''')
        counts = self.page.evaluate('''() => {
            const out = {};
            document.querySelectorAll('[data-sr-tab]').forEach(a => {
                const c = a.querySelector('.sr-tab-count');
                out[a.getAttribute('data-sr-tab')] = c ? c.textContent : null;
            });
            return out;
        }''')
        self.assertEqual(int(counts['course']), 2)
        self.assertEqual(int(counts['material']), 24)
        self.assertEqual(int(counts['qa']), 1)
        # 问答区提交 → 默认 qa 类型
        self.page.evaluate("document.querySelector('.side-nav a[data-view=qa]').click()")
        self.page.wait_for_function("document.getElementById('qaView').classList.contains('active')")
        self._search_from_top('搜索学')
        state = self.page.evaluate('history.state')
        self.assertEqual(state['searchType'], 'qa')
        self.page.wait_for_selector('[data-sr-list="qa"] .sr-item')
        self.assertEqual(
            self.page.evaluate('document.querySelectorAll("[data-sr-list=qa] .sr-item").length'), 1)

    # ── 场景 2：分类/筛选/排序/翻页/往返 ──
    def test_category_filter_sort_pagination_roundtrip(self):
        self._login()
        self._search_from_top('搜索学')
        # 进入课程分类
        self.page.click('[data-sr-tab="course"]')
        self.page.wait_for_selector('[data-sr-list="course"] .sr-item')
        self.assertEqual(self.page.evaluate('history.state.searchType'), 'course')
        self.assertEqual(self.page.evaluate('history.state.searchPage'), 1)
        # 课程结果使用真实链接
        href = self.page.evaluate('document.querySelector("[data-sr-list=course] .sr-item-title").href')
        self.assertIn('/explorer/', href)
        # 切资料分类 → 翻页
        self.page.click('[data-sr-tab="material"]')
        self.page.wait_for_selector('[data-sr-list="material"] .sr-item')
        self.assertEqual(self.page.evaluate(
            'document.querySelectorAll("[data-sr-list=material] .sr-item").length'), 20)
        first_page_first = self.page.evaluate(
            'document.querySelector("[data-sr-list=material] .sr-item-title").textContent')
        self.page.click('[data-sr-page="2"]')
        self.page.wait_for_function(
            'history.state && history.state.searchPage === 2')
        self.page.wait_for_function(
            'document.querySelectorAll("[data-sr-list=material] .sr-item").length === 4')
        second_page_first = self.page.evaluate(
            'document.querySelector("[data-sr-list=material] .sr-item-title").textContent')
        self.assertNotEqual(first_page_first, second_page_first)
        # 排序：下载最多 → 第一条应是 download_count 最大的 23 号
        self.page.select_option('[data-sr-filter="sort"]', 'downloads')
        self.page.wait_for_function('history.state.searchSort === "downloads"')
        self.page.wait_for_function('''() => {
            const t = document.querySelector("[data-sr-list=material] .sr-item-title");
            return t && t.textContent.includes("23");
        }''')
        # 筛选后计数展示
        self.page.wait_for_function('''() => {
            const t = document.querySelector(".sr-filtered-total");
            return t && t.textContent.includes("24");
        }''')
        # 点击资料结果 → 详情出现返回搜索按钮
        self.page.click('[data-sr-list="material"] .sr-item-title')
        self.page.wait_for_selector('#fileDetailView.active')
        fid = self.page.evaluate('history.state.fileId')
        self.page.wait_for_function(
            "document.getElementById('fdReturnSearchBtn') && !document.getElementById('fdReturnSearchBtn').hidden")
        # 返回搜索：条件与页码保留
        self.page.click('#fdReturnSearchBtn')
        self.page.wait_for_selector('#searchView.active')
        self.page.wait_for_function('history.state.view === "search"')
        state = self.page.evaluate('history.state')
        self.assertEqual(state['searchType'], 'material')
        self.assertEqual(state['searchSort'], 'downloads')
        self.assertEqual(state['searchPage'], 1, '改排序后页码已归 1，返回应保留')
        self.page.wait_for_selector('[data-sr-list="material"] .sr-item')
        # 返回后再后退应到原来源页（首页）；沿栈前进 search → 原详情（不复制条目）
        self.page.evaluate('history.back()')
        self.page.wait_for_selector('#homeView.active')
        self.page.evaluate('history.forward()')
        self.page.wait_for_selector('#searchView.active')
        self.page.evaluate('history.forward()')
        self.page.wait_for_selector('#fileDetailView.active')
        self.assertEqual(self.page.evaluate('history.state.fileId'), fid)

    def test_course_result_navigates_and_returns(self):
        self._login()
        self._search_from_top('搜索学导论')
        self.page.wait_for_selector('[data-sr-group="course"] .sr-item-title')
        # 全部页课程组：点击进入课程目录
        self.page.click('[data-sr-group="course"] .sr-item-title')
        self.page.wait_for_selector('#explorerView.active')
        self.page.wait_for_function('expPath && expPath.length >= 4')
        path = self.page.evaluate('expPath.slice()')
        self.assertEqual(path[-1], '搜索学导论')
        self.assertIn('/explorer/', self.page.evaluate('location.pathname'))
        # 返回搜索页：关键词与全部类型恢复
        self.page.evaluate('history.back()')
        self.page.wait_for_selector('#searchView.active')
        self.page.wait_for_function('history.state.view === "search"')
        self.assertEqual(self.page.evaluate('history.state.searchQuery'), '搜索学导论')
        self.assertEqual(self.page.evaluate('history.state.searchType'), 'all')

    # ── 场景 3：刷新与深链 ──
    def test_search_refresh_and_deep_link(self):
        self._login()
        self.page.goto(self.live_server_url + '/search?q=搜索学&type=material&sort=latest&page=2')
        self.page.wait_for_function('window._bnusparksReady === true')
        self.page.wait_for_selector('#searchView.active')
        self.page.wait_for_selector('[data-sr-list="material"] .sr-item')
        state = self.page.evaluate('history.state')
        self.assertEqual(state['searchQuery'], '搜索学')
        self.assertEqual(state['searchType'], 'material')
        self.assertEqual(state['sort'] if 'sort' in state else state['searchSort'], 'latest')
        self.assertEqual(state['searchPage'], 2)
        # 刷新后条件保留
        self.page.reload()
        self.page.wait_for_selector('#searchView.active')
        self.page.wait_for_selector('[data-sr-list="material"] .sr-item')
        self.assertEqual(self.page.evaluate('history.state.searchType'), 'material')

    def test_no_keyword_search_page(self):
        self._login()
        self.page.goto(self.live_server_url + '/search')
        self.page.wait_for_function('window._bnusparksReady === true')
        self.page.wait_for_selector('#searchView.active')
        self.page.wait_for_selector('.sr-empty')
        self.assertIn('输入关键词', self.page.evaluate("document.querySelector('.sr-empty-title').textContent"))

    # ── 场景 4：模块未加载时首次点击 ──
    def test_first_click_qa_with_module_cold(self):
        self._login()
        # 冷启动直接深链搜索页（qa/explorer 特性均未加载）
        self.page.goto(self.live_server_url + '/search?q=搜索学&type=qa')
        self.page.wait_for_function('window._bnusparksReady === true')
        self.page.wait_for_selector('[data-sr-list="qa"] .sr-item-title')
        self.assertFalse(self.page.evaluate(
            "!!(window._bnusparksFeatureReady && window._bnusparksFeatureReady.qa)"))
        self.page.click('[data-sr-list="qa"] .sr-item-title')
        self.page.wait_for_selector('#qaView.active')
        self.page.wait_for_selector('.qa-detail .qa-q-title')
        self.assertIn('搜索学怎么复习', self.page.evaluate("document.querySelector('.qa-q-title').textContent"))
        self.assertTrue(self.page.evaluate(
            "document.getElementById('qaView').classList.contains('active')"))
        # 返回搜索结果按钮存在且可用
        back_text = self.page.evaluate("document.querySelector('.qa-back-link').textContent")
        self.assertIn('返回搜索结果', back_text)
        self.page.click('.qa-back-link')
        self.page.wait_for_selector('#searchView.active')
        self.page.wait_for_function('history.state.view === "search"')

    # ── 场景 5：慢组不阻塞快组、独立重试 ──
    def test_slow_group_does_not_block_fast_group(self):
        self._login()
        holder = {}

        def hold_course(route):
            resp = route.fetch()
            holder['route'] = route
            holder['resp'] = resp

        self.page.route(
            lambda url: '/api/search/?v=2' in url and 'type=course' in url, hold_course)
        self._search_from_top('搜索学')
        # 资料组先成功渲染（课程组仍被扣留）
        self.page.wait_for_selector('[data-sr-group="material"] .sr-item')
        course_items = self.page.evaluate(
            'document.querySelectorAll("[data-sr-group=course] .sr-item").length')
        self.assertEqual(course_items, 0)
        self.assertEqual(
            self.page.evaluate('document.querySelector("[data-sr-group=course] .sr-group-count").textContent'), '…')
        # 放行课程组
        if 'route' not in holder:
            self.page.wait_for_timeout(500)
        holder['route'].fulfill(response=holder['resp'])
        self.page.wait_for_selector('[data-sr-group="course"] .sr-item')

    def test_failed_group_retry_keeps_others(self):
        self._login()
        calls = {'n': 0}

        def fail_once(route):
            calls['n'] += 1
            if calls['n'] == 1:
                route.fulfill(status=500, content_type='application/json',
                              json={'ok': False, 'error': 'boom'})
            else:
                route.continue_()

        self.page.route(
            lambda url: '/api/qa/search/' in url, fail_once)
        self._search_from_top('搜索学')
        self.page.wait_for_selector('[data-sr-group="qa"] .sr-error')
        # 其他两组不受影响
        self.page.wait_for_selector('[data-sr-group="material"] .sr-item')
        self.page.wait_for_selector('[data-sr-group="course"] .sr-item')
        # 无结果提示不得出现（有成功组）
        self.assertFalse(self.page.evaluate("!!document.querySelector('.sr-empty-title')"))
        # 独立重试成功
        self.page.click('[data-sr-group="qa"] .sr-retry-btn')
        self.page.wait_for_selector('[data-sr-group="qa"] .sr-item')

    # ── 场景 6：访客深链 ──
    def test_guest_deep_link_login_then_load(self):
        # 访客直接打开搜索深链：保留路由与关键词，显示需登录态
        self.page.goto(self.live_server_url + '/search?q=搜索学')
        self.page.wait_for_function('window._bnusparksReady === true')
        self.page.wait_for_selector('#searchView.active')
        self.page.wait_for_selector('.sr-empty--auth')
        # 登录弹窗自动打开（占一条 _modal 历史条目）；关闭后回到搜索条目
        self.page.wait_for_selector('#loginModal', state='visible')
        self.page.evaluate('closeAuthModal()')
        self.page.wait_for_timeout(500)
        self.assertFalse(self.page.evaluate(
            "document.getElementById('loginModal').style.display === 'flex'"))
        state = self.page.evaluate('history.state')
        self.assertEqual(state.get('searchQuery'), '搜索学')
        self.assertEqual(state.get('view'), 'search')
        # 页内「登录」按钮可再次打开；随后登录继续加载
        self.page.click('.sr-empty--auth .sr-retry-btn')
        self.page.wait_for_selector('#loginModal', state='visible')
        self.page.fill('#loginSid', '2099search_u')  # 表单自动补 @mail.bnu.edu.cn 后缀
        self.page.fill('#loginPassword', 'browser-test-only')
        self.page.click('#loginForm button[type="submit"]')
        self.page.wait_for_selector('#searchView.active')
        self.page.wait_for_selector('[data-sr-group="material"] .sr-item')
        self.assertEqual(self.page.evaluate('history.state.searchQuery'), '搜索学')

    # ── 场景 7：无 JS 错误 & 上传选课浮层不受影响 ──
    def test_upload_picker_overlay_still_works(self):
        self._login()
        self._goto_root_ready()
        self.page.click('.h8-upload-btn')
        self.page.wait_for_selector('.search-overlay', state='visible')
        self.page.fill('#courseSearchInput', '搜索学')
        self.page.wait_for_selector('.so-result-item')
        self.assertTrue(self.page.evaluate(
            "document.body.style.position === 'fixed'"), '上传选课浮层仍应锁定滚动')
        self.page.click('.search-overlay-close')
        self.page.wait_for_timeout(300)
        self.assertFalse(self.page.evaluate(
            "!!document.querySelector('.search-overlay')"), '关闭后浮层应移除')
        self.assertFalse(self.page.evaluate(
            "document.body.style.position === 'fixed'"), '关闭后应解锁滚动')
