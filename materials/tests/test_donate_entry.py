"""「资助我们」赞赏码入口：页脚 / 首页 / 关于页贡献方式的前端契约回归。"""
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase


class DonateQrEntryContractTest(SimpleTestCase):
    def test_donate_qr_asset_is_a_png(self):
        qr = Path(settings.BASE_DIR) / "public/donate-qr.png"
        self.assertGreater(qr.stat().st_size, 10000)
        self.assertTrue(qr.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))

    def test_footer_and_hero_link_to_qr_and_support_alert_removed(self):
        root = Path(settings.BASE_DIR)
        html = (root / "public/index.html").read_text(encoding="utf-8")
        views = (root / "public/js/views.js").read_text(encoding="utf-8")

        # 页脚「联系我们」已替换为高亮「资助我们」，与首页「提供物质支持」都指向赞赏码
        self.assertEqual(html.count("/static/donate-qr.png?v=1"), 2)
        self.assertEqual(html.count("资助我们"), 1)
        self.assertNotIn('href="mailto:bnusparks@163.com">联系我们', html)
        # 原「暂无收款码」提示已无调用方
        self.assertNotIn("showSupportMessage", html)
        self.assertNotIn("showSupportMessage", views)

    def test_contribution_card_embeds_qr_thumbnail(self):
        views = (Path(settings.BASE_DIR) / "public/js/views.js").read_text(encoding="utf-8")
        self.assertIn("heading: '贡献方式'", views)
        self.assertIn('alt="赞赏码，点击查看大图"', views)
        self.assertGreaterEqual(views.count("donate-qr.png?v=1"), 3)
