"""固定界面使用的自托管宋体应随静态资源一起发布。"""

from pathlib import Path

from django.contrib.staticfiles import finders
from django.test import SimpleTestCase


class SerifFontStaticTest(SimpleTestCase):
    def test_font_is_collected_and_shared_by_header(self):
        font_path = finders.find("fonts/bnu-serif.woff2")
        self.assertIsNotNone(font_path)
        self.assertEqual(Path(font_path).read_bytes()[:4], b"wOF2")
        tokens = Path(finders.find("css/tokens.css")).read_text(encoding="utf-8")
        base = Path(finders.find("css/base.css")).read_text(encoding="utf-8")
        self.assertIn('/static/fonts/bnu-serif.woff2', tokens)
        self.assertIn('--serif: "BNU Serif"', tokens)
        self.assertRegex(base, r'\.header-logo-area \.hl-chinese\s*\{\s*font-family:\s*var\(--serif\)')
