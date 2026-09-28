"""交流群二维码引用契约：两处入口必须使用同一缓存版本，避免新旧码不一致。"""
import re
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase


class GroupQrRefContractTest(SimpleTestCase):
    def test_placeholder_asset_is_a_png(self):
        # 真码含真人头像且定期过期，不入库；仓库只保留占位符，部署机自行替换
        qr = Path(settings.BASE_DIR) / "public/group-qr.placeholder.png"
        self.assertGreater(qr.stat().st_size, 10000)
        self.assertTrue(qr.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))

    def test_all_group_qr_refs_share_one_cache_version(self):
        root = Path(settings.BASE_DIR)
        views = (root / "public/js/views.js").read_text(encoding="utf-8")
        home = (root / "public/js/home.js").read_text(encoding="utf-8")

        # 关于页（缩略图+大图链接）与首页轮播缩略图共 3 处引用
        refs = re.findall(r"group-qr\.png\?v=(\d+)", views + home)
        self.assertEqual(len(refs), 3)
        self.assertEqual(len(set(refs)), 1, "group-qr 缓存键在各入口间不一致，会导致新旧二维码混用")

        # 有效期说明随码更新（换码时同步改这句）
        self.assertIn("10 月 5 日前有效", views)
