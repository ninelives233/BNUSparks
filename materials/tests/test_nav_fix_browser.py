"""移动端导航修复回归（真实页面、真实 API，可选 Playwright）。

覆盖 2026-10-15 排查报告 D1–D6 的行为回归，以及同日两轮线上回归：
  D1 返回恢复离开时的滚动位置（含 scrollY=0 不误恢复）；
     滚动期间不得写 history（X5 类内核会弹顶部假加载条）；
     前进/后退遍历不得复制历史条目
  D2 顶栏搜索浮层占一条历史：返回只关浮层；结果点击后返回栈正确
  D3 迟到的详情响应不覆盖已离开的页面
  D4 抽屉 ✕ 关闭后一次返回不重开抽屉、不烧返回栈
  D5 跨刷新边界前进/后退到 /about 正文非空
  D6 深链启动期首页面板不得改写当前历史条目的 URL/视图

BNU_BROWSER_TESTS=1 python3 manage.py test --settings=bnusparks.settings_test \
    materials.tests.test_nav_fix_browser
测试数据仅写入临时测试数据库/上传目录。
"""
import importlib.util
import os
import re
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from django.conf import settings
from django.contrib.auth.models import User
from django.contrib.staticfiles.testing import StaticLiveServerTestCase
from django.db import connections

from materials.models import College, Course, CourseCategory, Material, MaterialType, UserProfile


@unittest.skipUnless(os.environ.get('BNU_BROWSER_TESTS') == '1' and importlib.util.find_spec('playwright'),
                     '设置 BNU_BROWSER_TESTS=1 并安装 Playwright 后运行浏览器验收')
class NavFixBrowserTest(StaticLiveServerTestCase):
    maxDiff = None

    def setUp(self):
        from playwright.sync_api import sync_playwright
        self.owner = User.objects.create_user('navfix_owner', password='browser-test-only', first_name='回归上传者')
        self.reader = User.objects.create_user('navfix_reader', password='browser-test-only', first_name='回归读者')
        for user in (self.owner, self.reader):
            UserProfile.objects.update_or_create(user=user, defaults={
                'identity_education': '本科', 'identity_college': '测试学院', 'identity_major': '数学',
                'mobile_nav': 'bottom'})
        college = College.objects.create(name='回归测试学院', slug='nav-fix')
        course = Course.objects.create(name='线性代数 I', code='NAV_FIX', college=college)
        cats = {}
        parent = None
        for name in ('专业课', '回归测试学院', '数学', '第一学年'):
            parent = CourseCategory.objects.create(name=name, parent=parent)
            cats[name] = parent
        CourseCategory.objects.create(name=course.name, parent=parent, course=course)
        # 「专业课」根放第二个孩子：生产中根下是几十个学院，不应发生整链自动折叠
        CourseCategory.objects.create(name='对照分类', parent=cats['专业课'])
        material_type = MaterialType.objects.create(name='真题', slug='nav-fix-exam')
        self.course = course
        self.files = {}
        for idx, (key, title) in enumerate((
            ('a', '导航回归资料A-试卷'),
            ('b', '导航回归资料B-笔记'),
        )):
            filename = f'nav-fix-{idx}.txt'
            path = Path(settings.MEDIA_ROOT) / filename
            path.write_text('导航回归测试内容\n' * 40, encoding='utf-8')
            self.files[key] = Material.objects.create(
                course=course, material_type=material_type, title=title,
                teacher='回归教师', uploader=self.owner,
                file_name=filename, file_path=filename, file_size=path.stat().st_size,
                view_count=3, download_count=2)
        engine = os.environ.get('BNU_BROWSER_ENGINE', 'chromium')
        self.pw = sync_playwright().start()
        self.browser = getattr(self.pw, engine).launch()
        self.context = self.browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1)
        self.context.add_init_script("try{localStorage.setItem('bnusparks_appearance_guest', JSON.stringify({mobile_nav:'bottom'}))}catch(e){}")
        # 教程自动导览资格一律置否，避免自动弹窗劫持导航场景
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
            self.errors.append('%s | %s' % (err, getattr(err, 'stack', '') or ''))
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

    # ── 页面助手 ──
    def _path(self):
        from urllib.parse import unquote
        return unquote(self.page.evaluate('location.pathname'))

    def _wait_path(self, suffix, timeout=9000):
        import time
        deadline = time.time() + timeout / 1000
        while time.time() < deadline:
            path = self._path()
            if path.endswith(suffix) or (suffix.endswith('/') and path.startswith(suffix)):
                return
            self.page.wait_for_timeout(60)
        self.fail('path not reached: %s (now %s)' % (suffix, path))

    def _snapshot(self):
        return self.page.evaluate('''() => {
            const active = document.querySelector('.view-section.active');
            const overlays = [];
            document.querySelectorAll('.preview-overlay, .file-info-overlay, .search-overlay, .mf-sheet-overlay').forEach(el => {
                if (el.isConnected && getComputedStyle(el).display !== 'none') overlays.push(el.className);
            });
            return {
                url: decodeURIComponent(location.pathname),
                state: history.state,
                view: active ? active.id : null,
                expPath: (typeof expPath !== 'undefined') ? expPath.slice() : null,
                scrollY: window.scrollY,
                overlays,
            };
        }''')

    def _goto_root_ready(self):
        self.page.goto(self.live_server_url + '/')
        self.page.wait_for_function('window._bnusparksReady === true')
        self.page.wait_for_timeout(250)

    def _login(self, user):
        self._goto_root_ready()
        result = self.page.evaluate('''async credentials => {
            const response = await fetch('/api/auth/login/', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(credentials)});
            const result = await response.json();
            if (result.ok) { localStorage.setItem('token', result.data.token); sessionStorage.setItem('token', result.data.token); }
            return result.ok;
        }''', {'username': user.username, 'password': 'browser-test-only'})
        self.assertTrue(result)
        # 关闭首次登录核心导览推荐（与路由拦截双保险）
        self.page.evaluate("api('/api/auth/tutorial/', {method:'POST', body:{action:'dismiss_offer'}})")
        self.page.reload()
        self.page.wait_for_function('window._bnusparksReady === true')
        self.page.wait_for_timeout(250)

    def _nav_to_file_list(self):
        """首页 → 底栏全部课程 → 专业课页签 → 学院卡片（自动跳层）→ 课程卡片。"""
        self._goto_root_ready()
        self.page.locator('#mobileBottomNav [data-mobile-view="allCourses"]').click()
        self._wait_path('/explorer/')
        self.page.wait_for_timeout(400)
        self.page.locator('.course-root-tab[data-course-root="专业课"]').click()
        self._wait_path('/explorer/专业课')
        self.page.wait_for_timeout(400)
        self.page.locator('.folder-card[data-n="回归测试学院"]').click()
        self._wait_path('/第一学年')
        self.page.wait_for_timeout(400)
        self.page.locator('.folder-list-item', has_text='线性代数 I').first.click()
        self._wait_path('/线性代数 I')
        self.page.wait_for_timeout(500)
        self.page.wait_for_selector('.mf-row')

    def _open_file(self, key='a'):
        fid = self.files[key].id
        self.page.locator(f'.mf-row[data-file-id="{fid}"] .mf-text').click()
        self._wait_path(f'/file/{fid}')
        self.page.wait_for_function("document.querySelector('#fdTitle') && document.querySelector('#fdTitle').textContent && !document.querySelector('#fdTitle').textContent.includes('加载中')")

    # ── D1：返回恢复离开时的滚动位置 ──
    def test_d1_back_restores_scroll(self):
        self._login(self.reader)
        self._nav_to_file_list()
        # 制造可滚动高度：移动列表内容有限，直接验证真实滚动量
        self.page.evaluate('window.scrollTo(0, 400)')
        self.page.wait_for_timeout(400)  # 超过节流的滚动同步窗口
        before = self.page.evaluate('window.scrollY')
        self.assertGreater(before, 0, '测试前置：列表应可滚动')
        self._open_file('a')
        self.page.wait_for_timeout(300)
        self.assertEqual(self.page.evaluate('window.scrollY'), 0, '进入详情应回到顶部')
        hist_len = self.page.evaluate('history.length')
        self.page.evaluate('history.back()')
        self.page.wait_for_timeout(500)
        after = self.page.evaluate('window.scrollY')
        self.assertEqual(after, before, '返回列表应恢复离开时的滚动位置')
        # 再前进到详情、再次返回，滚动仍应正确（0 恢复为 0 也不误写）
        self.page.evaluate('history.forward()')
        self.page.wait_for_timeout(500)
        self.assertTrue(self.page.evaluate("document.getElementById('fileDetailView').classList.contains('active')"))
        self.page.evaluate('history.back()')
        self.page.wait_for_timeout(500)
        self.assertEqual(self.page.evaluate('window.scrollY'), before)
        # popstate 遍历路径重开详情不得复制历史条目（否则下一次返回落在复制品上）
        self.assertEqual(self.page.evaluate('history.length'), hist_len,
                         '前进/后退遍历不得增长历史栈')

    def test_d1_top_of_list_stays_zero(self):
        self._login(self.reader)
        self._nav_to_file_list()
        self.page.evaluate('window.scrollTo(0, 0)')
        self.page.wait_for_timeout(400)
        self._open_file('b')
        self.page.evaluate('history.back()')
        self.page.wait_for_timeout(500)
        self.assertEqual(self.page.evaluate('window.scrollY'), 0, '离开时在顶部，返回后也应为 0')

    def test_d1_scrolling_never_writes_history(self):
        """滚动期间不得写 history：X5 类内核把 history 变更当导航处理，会弹出
        顶部假加载条，滚动一触发 replaceState 就等于「一滑一个加载提示」
        （2026-10-15 线上回归）。"""
        self._login(self.reader)
        self._goto_root_ready()
        self.page.wait_for_timeout(1200)  # 等首页异步面板的迟到渲染窗口过去
        state_before = self.page.evaluate('history.state')
        self.page.evaluate('''() => {
            window.__hsWrites = 0;
            const rs = history.replaceState.bind(history);
            history.replaceState = function (...a) { window.__hsWrites += 1; return rs(...a); };
            const ps = history.pushState.bind(history);
            history.pushState = function (...a) { window.__hsWrites += 1; return ps(...a); };
        }''')
        # 连续滚动超过已移除的滚动同步的 200ms 节流窗口
        for y in (200, 400, 600, 350):
            self.page.evaluate('window.scrollTo(0, %d)' % y)
            self.page.wait_for_timeout(260)
        self.assertEqual(self.page.evaluate('window.__hsWrites'), 0,
                         '滚动不得触发任何 history 写入（会触发移动内核假加载条）')
        self.assertEqual(self.page.evaluate('history.state'), state_before,
                         '滚动不得改写当前历史条目（含 scrollY）')

    # ── D2：顶栏搜索浮层的返回语义 ──
    def test_d2_top_search_back_closes_overlay_only(self):
        self._login(self.reader)
        self._nav_to_file_list()
        self.page.fill('.search-box input', '导航回归')
        self.page.press('.search-box input', 'Enter')
        self.page.wait_for_selector('.search-overlay .sg-item')
        path_before = self._path()
        exp_before = self.page.evaluate('expPath.slice()')
        self.page.evaluate('history.back()')
        self.page.wait_for_timeout(500)
        snap = self._snapshot()
        self.assertEqual(snap['overlays'], [], '一次返回应关闭搜索浮层')
        self.assertEqual(snap['url'], path_before, '关闭浮层不应回退视图层级')
        self.assertEqual(snap['expPath'], exp_before, '浮层关闭后目录上下文不得残留浮层前的旧值')
        self.assertTrue(snap['view'] == 'explorerView')
        # 浮层条目已交还：再一次返回应真正回到上一级目录
        self.page.evaluate('history.back()')
        self.page.wait_for_timeout(500)
        self.assertEqual(self._path(), '/explorer/专业课/回归测试学院/数学/第一学年')

    def test_d2_top_search_result_navigation(self):
        self._login(self.reader)
        self._goto_root_ready()
        self.page.fill('.search-box input', '导航回归资料A')
        self.page.press('.search-box input', 'Enter')
        self.page.wait_for_selector('.search-overlay .sg-item-link')
        self.page.locator('.sg-item-link').first.click()
        self.page.wait_for_timeout(600)
        fid = self.files['a'].id
        self.assertEqual(self._path(), f'/file/{fid}', '点击资料结果应进入详情')
        self.page.evaluate('history.back()')
        self.page.wait_for_timeout(500)
        snap = self._snapshot()
        self.assertEqual(snap['url'], '/', '详情返回应回到发起搜索的页面，而不是残留弹层条目')
        self.assertEqual(snap['view'], 'homeView')
        self.assertIsNone(snap['state'] and snap['state'].get('_modal'), '返回后不得落在 _modal 僵尸条目上')

    # ── D3：迟到的详情响应不覆盖已离开的页面 ──
    def test_d3_late_detail_response_no_hijack(self):
        self._login(self.reader)
        self._goto_root_ready()
        holder = {}

        def hold_detail(route):
            resp = route.fetch()
            holder['route'] = route
            holder['resp'] = resp

        self.page.route(re.compile(re.escape(self.live_server_url) + r'/api/files/\d+/$'), hold_detail)
        self.page.fill('.search-box input', '导航回归资料A')
        self.page.press('.search-box input', 'Enter')
        self.page.wait_for_selector('.search-overlay .sg-item-link')
        self.page.locator('.sg-item-link').first.click()
        self.page.wait_for_timeout(400)
        self.assertEqual(self._path(), f"/file/{self.files['a'].id}")
        self.page.locator('#mobileBottomNav [data-mobile-view="allCourses"]').click()
        self._wait_path('/explorer/')
        self.page.wait_for_timeout(300)
        if 'route' not in holder:
            self.page.wait_for_timeout(1000)
        holder['route'].fulfill(response=holder['resp'])
        self.page.wait_for_timeout(800)
        probe = self.page.evaluate('''() => {
            const fv = document.getElementById('fileDetailView');
            return {
                explorerActive: document.getElementById('explorerView').classList.contains('active'),
                fvActive: fv.classList.contains('active'),
            };
        }''')
        self.assertTrue(probe['explorerActive'], '迟到响应送达后应停留在用户选择的页面')
        self.assertFalse(probe['fvActive'], '迟到的详情响应不得重新激活详情视图')

    # ── D4：抽屉关闭与返回 ──
    def test_d4_drawer_close_then_single_back(self):
        self._login(self.reader)
        self._goto_root_ready()
        self.page.wait_for_selector('#userAvatarTrigger')
        self.page.locator('#userAvatarTrigger').click()
        self.page.wait_for_selector('#notifDrawer', state='visible')
        self.page.wait_for_timeout(200)
        self.page.locator('#drawerMenuBody .dm-item', has_text='通知中心').click()
        self.page.wait_for_timeout(400)
        self.page.locator('#notifDrawer .notif-drawer-close:visible').first.click()
        self.page.wait_for_timeout(200)
        self.assertFalse(self.page.evaluate("document.getElementById('notifDrawer').style.display === 'flex'"))
        # ✕ 关闭即交还历史条目：当前位置已回到首页条目，不残留 drawer 状态
        self.assertEqual((self.page.evaluate('history.state') or {}).get('view'), 'home',
                         '关闭抽屉后当前条目应为首页，而非抽屉条目')
        self.assertFalse(self.page.evaluate("document.body.style.position === 'fixed'"), '关闭后不得残留滚动锁')
        # 再次打开 → 菜单项进入我的上传 → 一次返回应回首页，抽屉不重开
        self.page.locator('#userAvatarTrigger').click()
        self.page.wait_for_selector('#notifDrawer', state='visible')
        self.page.wait_for_timeout(200)
        self.page.locator('#drawerMenuBody .dm-item', has_text='我的上传').click()
        self.page.wait_for_timeout(700)
        self.assertEqual(self._path(), '/uploads', '抽屉菜单项应正常导航')
        self.assertTrue(self.page.evaluate("document.getElementById('myUploadsView').classList.contains('active')"),
                        '返回前应停留在我的上传视图（弹层历史交还不得反吞导航）')
        self.page.evaluate('history.back()')
        self.page.wait_for_timeout(600)
        if self._path() != '/':
            for n in self.page.evaluate('window.__navlog || []'):
                print('NAV', json.dumps(n, ensure_ascii=False)[:400], file=sys.stderr)
        snap = self._snapshot()
        self.assertEqual(snap['url'], '/', '返回应回到首页条目')
        self.assertNotEqual(snap['state'] and snap['state'].get('view'), 'drawer', '返回不得重开抽屉')
        self.assertFalse(self.page.evaluate("document.getElementById('notifDrawer').style.display === 'flex'"))
        self.assertFalse(self.page.evaluate("document.body.style.position === 'fixed'"), '返回后不得残留滚动锁')

    # ── D5：跨刷新边界前进/后退 ──
    def test_d5_cross_refresh_about_content(self):
        self._login(self.reader)
        self.page.goto(self.live_server_url + '/about')
        self.page.wait_for_function('window._bnusparksReady === true')
        self.page.wait_for_timeout(400)
        self.page.locator('#mobileBottomNav [data-mobile-view="qa"]').click()
        self._wait_path('/qa')
        self.page.wait_for_timeout(600)
        self.page.reload()
        self.page.wait_for_function('window._bnusparksReady === true')
        self.page.wait_for_timeout(500)
        self.page.evaluate('history.back()')
        self.page.wait_for_timeout(600)
        snap = self._snapshot()
        self.assertEqual(snap['view'], 'aboutView')
        content_len = self.page.evaluate("(document.getElementById('aboutSectionContent')||{innerText:''}).innerText.length")
        self.assertGreater(content_len, 40, '跨刷新返回到 /about 正文不得空白')

    # ── D6：深链启动期首页面板不得改写历史条目 ──
    def test_d6_deep_link_state_not_patched_to_home(self):
        self._login(self.reader)
        self.page.goto(self.live_server_url + '/explorer/专业课/回归测试学院/数学/第一学年')
        self.page.wait_for_function('window._bnusparksReady === true')
        self.page.wait_for_timeout(1200)  # 等紧凑首页异步面板的迟到渲染窗口过去
        snap = self._snapshot()
        self.assertTrue(snap['url'].startswith('/explorer/专业课'), '深链 URL 不得被首页面板改写')
        self.assertEqual((snap['state'] or {}).get('view'), 'explorer', '历史条目视图不得被改写为 home')
        self.assertIsNone((snap['state'] or {}).get('homeHotKind'), '非首页条目不得混入首页面板字段')
