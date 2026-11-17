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
