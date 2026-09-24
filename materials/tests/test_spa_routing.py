"""SPA 干净 URL 路由测试（v=171）：catch-all 兜底返回 index.html，API/后台不受影响"""

from django.test import TestCase, Client


class SpaRoutingTestCase(TestCase):
    """catch-all 兜底：/about /explorer/... /file/... 等深链刷新返回 index.html"""

    def setUp(self):
        self.client = Client()

    def _is_index(self, content):
        return b"<!DOCTYPE html>" in content and b"BNUSparks" in content

    def test_root_returns_index(self):
        r = self.client.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(self._is_index(r.content))

    def test_about_returns_index(self):
        r = self.client.get("/about")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(self._is_index(r.content))

    def test_qa_direct_refresh_returns_index(self):
        # 问答区（v=174）：/qa 直达刷新返回 index.html，由前端恢复视图
        r = self.client.get("/qa")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(self._is_index(r.content))

    def test_explorer_deep_link_returns_index(self):
        # /explorer/专业课/经管学院（中文已 percent-encode）
        r = self.client.get("/explorer/%E4%B8%93%E4%B8%9A%E8%AF%BE/%E7%BB%8F%E7%AE%A1%E5%AD%A6%E9%99%A2")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(self._is_index(r.content))

    def test_random_deep_path_returns_index(self):
        r = self.client.get("/some/random/deep/path")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(self._is_index(r.content))

    def test_mail_deep_links_still_work(self):
        for p in ("/reset-password/", "/verify-email/"):
            r = self.client.get(p)
            self.assertEqual(r.status_code, 200, p)
            self.assertTrue(self._is_index(r.content), p)

    def test_etag_304_applies_to_deep_link(self):
        first = self.client.get("/about")
        etag = first.headers.get("ETag")
        self.assertTrue(etag, "deep link 应带 ETag")
        second = self.client.get("/about", HTTP_IF_NONE_MATCH=etag)
        self.assertEqual(second.status_code, 304)

    def test_api_not_swallowed_by_catchall(self):
        r = self.client.get("/api/stats/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("application/json", r.headers.get("Content-Type", ""))

    def test_admin_not_swallowed_by_catchall(self):
        # /admin/（带斜杠）必须走 Django 后台（重定向到登录页），不能被兜底吞掉
        r = self.client.get("/admin/")
        self.assertEqual(r.status_code, 302)
        self.assertIn("/admin/login/", r.headers.get("Location", ""))
