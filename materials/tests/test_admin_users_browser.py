"""用户管理角色分流与汇总看板：真实页面及真实 API，可选 Playwright。

BNU_BROWSER_TESTS=1 python3 manage.py test --settings=bnusparks.settings_test \
    materials.tests.test_admin_users_browser
"""

import importlib.util
import json
import os
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from django.contrib.staticfiles.testing import StaticLiveServerTestCase
from django.core.cache import cache

from ..models import UserProfile
from .helpers import _make_jwt, create_user


@unittest.skipUnless(os.environ.get("BNU_BROWSER_TESTS") == "1" and importlib.util.find_spec("playwright"),
                     "设置 BNU_BROWSER_TESTS=1 并安装 Playwright 后运行浏览器验收")
class AdminUsersBrowserTest(StaticLiveServerTestCase):
    def setUp(self):
        from playwright.sync_api import sync_playwright
        cache.clear()
        self.viewers = {}
        for role in (UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR, UserProfile.Role.SUPER_ADMIN):
            user = create_user(f"dashboard_{role}", role=role)
            user.profile.identity_college = "看板测试学院"
            user.profile.identity_education = "本科"
            user.profile.identity_major = "看板测试专业"
            user.profile.save(update_fields=["identity_college", "identity_education", "identity_major"])
            self.viewers[role] = user
        user = create_user("dashboard_grad")
        user.profile.identity_college = "看板研究生院"
        user.profile.identity_education = "硕士"
        user.profile.identity_major = "看板研究生专业"
        user.profile.save(update_fields=["identity_college", "identity_education", "identity_major"])
        self.pw = sync_playwright().start()
        self.browser = getattr(self.pw, os.environ.get("BNU_BROWSER_ENGINE", "chromium")).launch()
        self.context = None
        self.errors = []

    def tearDown(self):
        self.browser.close()
        self.pw.stop()
        self.assertEqual(self.errors, [])

    def _enter(self, role, section="users"):
        if self.context:
            self.context.close()
        user = self.viewers[role]
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 1000})
        values = json.dumps({"token": _make_jwt(user.id), "id": str(user.id), "section": section})
        # 故意恢复仅总管理员可用的分区，验证旧 session/history 不会绕过角色分流。
        self.context.add_init_script("""(() => {
            const v = %s;
            localStorage.setItem('token', v.token);
            localStorage.setItem('bnusparks_user_id', v.id);
            if (!sessionStorage.getItem('dashboard_seeded')) {
                sessionStorage.setItem('dashboard_seeded', '1');
                sessionStorage.setItem('bnusparks_admin_tab', 'users');
                sessionStorage.setItem('bnusparks_admin_user_section', v.section);
                sessionStorage.setItem('bnusparks_view', JSON.stringify({view:'admin', adminTab:'users', adminUserSection:v.section}));
            }
        })();""" % values)
        self.page = self.context.new_page()
        self.page.set_default_timeout(10000)
        self.page.route("**/api/auth/tutorial/**", lambda route: route.fulfill(
            json={"ok": True, "data": {"eligible": False, "claimed": False}}))
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.monitor_requests = []
        self.page.on("request", lambda request: self.monitor_requests.append(request.url)
                     if "/api/admin/monitoring/" in request.url else None)
        self.page.goto(self.live_server_url + "/manage")
        self.page.wait_for_selector("#adminContent .college-share-percent")

    def _assert_summary(self):
        self.assertTrue(self.page.locator("#adminUsersTab").is_visible())
        self.assertEqual(self.page.locator("#adminContent .monitor-stat-card").count(), 1)
        self.assertEqual(self.page.locator("#adminContent .monitor-stat-value").inner_text(), "4")
        self.assertEqual(self.page.locator("#adminContent .college-share-percent").inner_text(), "75%")
        self.assertEqual(self.page.locator("#identityCollegeBars button").count(), 0)
        self.assertEqual(self.page.locator("#identityMajorPanel, #identityUserPanel, .campus-distribution-card, .admin-user-monitor-nav").count(), 0)
        content = self.page.locator("#adminContent").inner_text()
        for private in ("身份已完整", "身份覆盖率", "身份未补全", "校区分布", "年级分布", "用户名单", "看板测试专业", "dashboard_grad"):
            self.assertNotIn(private, content)
        self.assertEqual(self.page.evaluate("history.state.adminUserSection"), "identity")
        for url in self.monitor_requests:
            self.assertEqual(parse_qs(urlsplit(url).query)["section"], ["identity"])

    def test_other_admins_get_only_summary_with_keyboard_filters_and_restoration(self):
        for role in (UserProfile.Role.MODERATOR, UserProfile.Role.SUB_MODERATOR):
            with self.subTest(role=role):
                self._enter(role)
                self._assert_summary()
                period = self.page.get_by_role("tab", name="近 7 天", exact=True)
                period.focus()
                self.page.keyboard.press("Enter")
                self.page.wait_for_function("document.querySelector('.identity-trend-head p')?.textContent.includes('近 7 天')")
                education = self.page.locator(".identity-monitor-grid--summary button", has_text="本科")
                education.focus()
                self.page.keyboard.press("Enter")
                self.page.wait_for_function("document.querySelector('#identityCollegeBars')?.textContent.includes('看板测试学院') && !document.querySelector('#identityCollegeBars').textContent.includes('看板研究生院')")
                self._assert_summary()
                self.page.reload()
                self.page.wait_for_selector("#adminContent .college-share-percent")
                self._assert_summary()
                self.assertEqual(self.page.evaluate("history.state.adminIdentityEducation"), "本科")
                self.assertEqual(self.page.evaluate("history.state.adminIdentityPeriod"), "week")
                self.assertEqual(urlsplit(self.page.url).path, "/manage")

    def test_summary_layout_in_narrow_dark_and_reduced_motion(self):
        self._enter(UserProfile.Role.MODERATOR)
        for width in (1440, 390):
            for theme in ("warm", "dark"):
                with self.subTest(width=width, theme=theme):
                    self.page.set_viewport_size({"width": width, "height": 1000})
                    self.page.emulate_media(reduced_motion="reduce")
                    self.page.evaluate("theme => document.documentElement.dataset.bnuTheme = theme", theme)
                    self._assert_summary()
                    self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
                    chart = self.page.locator(".identity-user-trend-card").bounding_box()
                    pie = self.page.locator(".college-share-card").bounding_box()
                    if width == 1440:
                        self.assertAlmostEqual(chart["y"], pie["y"], delta=1)
                    else:
                        self.assertGreater(pie["y"], chart["y"])
                    self.assertTrue(self.page.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"))
                    screenshots = os.environ.get("BNU_BROWSER_SCREENSHOT_DIR")
                    if screenshots:
                        target = Path(screenshots)
                        target.mkdir(parents=True, exist_ok=True)
                        self.page.screenshot(path=str(target / f"admin-summary-{width}-{theme}.png"), full_page=True)

    def test_super_admin_keeps_full_functions_and_user_drilldown(self):
        self._enter(UserProfile.Role.SUPER_ADMIN, section="identity")
        self.assertEqual(self.page.locator(".admin-user-monitor-nav [role=tab]").count(), 6)
        self.assertEqual(self.page.locator("#adminContent .monitor-stat-card").count(), 3)
        self.assertTrue(self.page.locator(".campus-distribution-card").is_visible())
        self.assertTrue(self.page.locator("#identityMajorPanel").is_visible())
        self.page.locator("#identityCollegeBars button", has_text="看板测试学院").click()
        self.page.locator("#identityMajorPanel button", has_text="看板测试专业").click()
        self.page.wait_for_selector("#identityUserPanel .iu-row")
        self.assertEqual(self.page.locator("#identityUserPanel .iu-row").count(), 3)
        self.page.get_by_role("tab", name="用户名单", exact=True).click()
        self.page.wait_for_selector(".admin-users-table")
        self.assertIn("dashboard_grad", self.page.locator(".admin-users-table").inner_text())
