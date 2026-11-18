"""标签页账号隔离的真实浏览器回归。"""
import importlib.util
import os
import unittest

from django.contrib.auth.models import User
from django.contrib.staticfiles.testing import StaticLiveServerTestCase
from django.core.cache import cache


@unittest.skipUnless(os.environ.get('BNU_BROWSER_TESTS') == '1' and importlib.util.find_spec('playwright'),
                     '设置 BNU_BROWSER_TESTS=1 并安装 Playwright 后运行浏览器验收')
class AuthTabsBrowserTest(StaticLiveServerTestCase):
    def setUp(self):
        from playwright.sync_api import sync_playwright
        cache.clear()
        self.a = User.objects.create_user('2099tab_a@mail.bnu.edu.cn', password='browser-test-only')
        self.b = User.objects.create_user('2099tab_b@mail.bnu.edu.cn', password='browser-test-only')
        self.pw = sync_playwright().start()
        self.addCleanup(self.pw.stop)
        self.browser = getattr(self.pw, os.environ.get('BNU_BROWSER_ENGINE', 'chromium')).launch()
        self.addCleanup(self.browser.close)
        self.context = self.browser.new_context()
        self.page = self.context.new_page()
        self.page.goto(self.live_server_url + '/')
        self.ready(self.page)

    def ready(self, page):
        page.wait_for_function('window._bnusparksReady === true')

    def login(self, page, name, user):
        page.evaluate('showLoginModal()')
        page.locator('#loginSid').fill(name)
        page.locator('#loginPassword').fill('browser-test-only')
        page.locator('#loginForm button[type="submit"]').click()
        page.wait_for_function('(id) => currentUser && currentUser.id === id', arg=user.id)

    def test_duplicate_logout_switch_refresh_and_new_tab(self):
        self.login(self.page, '2099tab_a', self.a)
        # window.open 与浏览器复制标签页一样复制初始 sessionStorage，之后各自独立。
        with self.page.expect_popup() as popup:
            self.page.evaluate('window.open(location.href)')
        other = popup.value
        self.ready(other)
        other.wait_for_function('(id) => currentUser && currentUser.id === id', arg=self.a.id)
        other.evaluate('logout()')
        self.ready(other)
        self.login(other, '2099tab_b', self.b)
        for page, user in ((self.page, self.a), (other, self.b)):
            page.reload()
            self.ready(page)
            page.wait_for_function('(id) => currentUser && currentUser.id === id', arg=user.id)
            self.assertEqual(page.evaluate("async () => (await api('/api/auth/me/')).id"), user.id)
            page.evaluate('refreshCurrentUser()')
            page.wait_for_function('(id) => currentUser && currentUser.id === id', arg=user.id)

        # A 退出不得删除 B 的共享凭据，也不能在刷新后捡到 B 的账号。
        self.page.evaluate('logout()')
        self.ready(self.page)
        self.assertIsNone(self.page.evaluate('currentUser'))
        self.assertIsNone(self.page.evaluate('getAuthToken()'))
        self.assertEqual(self.page.evaluate("localStorage.getItem('token')"), other.evaluate('getAuthToken()'))
        self.page.reload()
        self.ready(self.page)
        self.assertIsNone(self.page.evaluate('currentUser'))
        self.assertIsNone(self.page.evaluate('getAuthToken()'))
        # 真正的新标签页仍可继承当前共享登录。
        new_page = self.context.new_page()
        new_page.goto(self.live_server_url + '/')
        self.ready(new_page)
        new_page.wait_for_function('(id) => currentUser && currentUser.id === id', arg=self.b.id)
        other.reload()
        self.ready(other)
        other.wait_for_function('(id) => currentUser && currentUser.id === id', arg=self.b.id)

    def test_stale_refresh_does_not_restore_previous_user(self):
        self.login(self.page, '2099tab_a', self.a)
        result = self.page.evaluate('''async (otherId) => {
          const realApi = api;
          let finish;
          api = (url, options) => url === '/api/auth/me/'
            ? new Promise(resolve => { finish = resolve; }) : realApi(url, options);
          const pending = refreshCurrentUser();
          _persistToken('different-token', false, otherId);
          setAuthenticatedUser({id: otherId, username: 'other', role: 'user'});
          finish({id: %d, username: 'old', role: 'user'});
          await pending;
          api = realApi;
          return currentUser.id;
        }''' % self.a.id, self.b.id)
        self.assertEqual(result, self.b.id)

    def test_timetable_accounts_and_late_pull_are_isolated(self):
        schedule_a = {
            'meta': {'semester': '测试学期'}, 'courses': [{'id': 'a', 'name': '甲账号课程', 'meetings': []}],
            'start': '2026-09-07', 'importedAt': 2000000000000, 'pendingCodes': {},
        }
        self.login(self.page, '2099tab_a', self.a)
        self.page.evaluate("async (data) => api('/api/user/timetable/', {method:'PUT', body:{owner_id:currentUser.id, data}})", schedule_a)
        self.page.evaluate('ttNavTimetable()')
        self.page.wait_for_function("typeof ttState !== 'undefined' && ttState.data && ttState.data.courses[0].name === '甲账号课程'")

        # 先挂起甲的云端拉取，再在同一页切换乙；旧响应不能在乙的页面或缓存落地。
        result = self.page.evaluate('''async (userId) => {
          const login = await fetch('/api/auth/login/', {method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({username:'2099tab_b@mail.bnu.edu.cn', password:'browser-test-only'})});
          const b = (await login.json()).data;
          const realApi = api;
          let finish;
          api = (url, opts) => url.startsWith('/api/user/timetable/')
            ? new Promise(resolve => { finish = resolve; }) : realApi(url, opts);
          ttResetSyncState();
          const old = ttSyncPull();
          api = realApi;
          _persistToken(b.token, false, b.user.id);
          setAuthenticatedUser(b.user);
          finish({data:{courses:[{name:'过期甲课程', meetings:[]}], importedAt:3000000000000}, updated_at:'2026-01-01'});
          await old;
          await (ttSyncPullPromise || Promise.resolve());
          return {uid: ttState.uid, data: ttState.data, cache: localStorage.getItem('bnusparks_timetable_v1_u' + userId),
                  cloud: (await realApi('/api/user/timetable/')).data};
        }''', self.b.id)
        self.assertEqual(result['uid'], self.b.id)
        self.assertIsNone(result['data'])
        self.assertIsNone(result['cache'])
        self.assertIsNone(result['cloud'])

        # 乙主动保存自己的课表后，两个标签页的刷新与轮询仍各自保留不同数据。
        self.page.evaluate('''async () => {
          ttState.data = {meta:{semester:'测试学期'}, courses:[{id:'b', name:'乙账号课程', meetings:[]}],
            start:'2026-09-07', importedAt:2100000000000, pendingCodes:{}};
          ttSaveStore(ttState.data);
          await ttSyncUpload();
        }''')
        with self.page.expect_popup() as popup:
            self.page.evaluate('window.open(location.href)')
        other = popup.value
        self.ready(other)
        other.wait_for_function("typeof ttState !== 'undefined' && ttState.data && ttState.data.courses[0].name === '乙账号课程'")
        self.page.evaluate('''async () => {
          const response = await fetch('/api/auth/login/', {method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({username:'2099tab_a@mail.bnu.edu.cn', password:'browser-test-only'})});
          const a = (await response.json()).data;
          _persistToken(a.token, false, a.user.id);
          setAuthenticatedUser(a.user);
        }''')
        self.page.wait_for_function("ttState.data && ttState.data.courses[0].name === '甲账号课程'")
        for page, expected in ((self.page, '甲账号课程'), (other, '乙账号课程')):
            page.evaluate('ttSyncPull()')
            page.reload()
            self.ready(page)
            page.wait_for_function('(name) => ttState.data && ttState.data.courses[0].name === name', arg=expected)
            cloud_name = page.evaluate("async () => (await api('/api/user/timetable/')).data.courses[0].name")
            self.assertEqual(cloud_name, expected)
