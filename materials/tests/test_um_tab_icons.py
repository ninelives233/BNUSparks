"""SVG sprite 图标契约：静态 ui-icon 必须带描边属性，um-tab 统一用 upload/document。"""
import re
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase


class UiIconStrokeContractTest(SimpleTestCase):
    def test_no_static_ui_icon_missing_stroke_attributes(self):
        html = (Path(settings.BASE_DIR) / "public/index.html").read_text(encoding="utf-8")
        # <use> 克隆的 symbol 路径依赖这些继承属性呈现描边，缺失会渲染成实心黑块
        broken = re.findall(r'<svg class="ui-icon"(?![^>]*fill="none")[^>]*>', html)
        self.assertEqual(broken, [])


class UploadTabIconContractTest(SimpleTestCase):
    def test_um_tab_buttons_use_upload_and_document_icons(self):
        html = (Path(settings.BASE_DIR) / "public/index.html").read_text(encoding="utf-8")
        tabs = re.findall(r'<button[^>]*class="um-tab[^"]*"[^>]*>.*?</button>', html)
        self.assertEqual(len(tabs), 6)  # 上传弹窗 + 新建课程通识/专业课各 2 个
        for tab in tabs:
            self.assertIn('<svg class="ui-icon"', tab)
            # <use> 克隆的 symbol 路径依赖这些继承属性呈现描边，缺失会渲染成实心黑块
            self.assertIn('fill="none" stroke="currentColor"', tab)
            self.assertRegex(tab, r'#ui-icon-(upload|document)')  # 不再回退到 emoji 或 folder/edit
        self.assertEqual(sum('ui-icon-upload' in t for t in tabs), 3)
        self.assertEqual(sum('ui-icon-document' in t for t in tabs), 3)
