"""ZIP 压缩包结构预览 API 测试（含侧车缓存、文件名多编码解码、安全过滤）"""

import hashlib
import io
import json
import shutil
import struct
import tempfile
import zipfile
import zlib
from pathlib import Path
from unittest import mock

from django.conf import settings
from django.test import override_settings

from .helpers import BnuTestCase, create_course, create_material
from materials.views import files as files_views

_TMP = tempfile.mkdtemp(prefix="bnu_ziptest_")


def tearDownModule():
    shutil.rmtree(_TMP, ignore_errors=True)


def _make_zip_bytes():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("notes/lecture1.txt", "hello")
        zf.writestr("notes/lecture2.pdf", "%PDF-1.4 test")
        zf.writestr("README.md", "# readme")
    return buf.getvalue()


def _raw_zip_bytes(entries):
    """手工构造 ZIP，可注入任意原始文件名字节与 UTF-8 flag。

    entries = [(name_bytes, flag_bits, content_bytes), ...]
    用于模拟 macOS（UTF-8 不设 flag）、Windows（GBK）等 zipfile 无法直接写出的场景。
    """
    locals_ = b""
    centrals = b""
    for name, flag, content in entries:
        nh = len(name)
        off = len(locals_)
        crc = zlib.crc32(content)
        locals_ += struct.pack("<4s5H3L2H", b"PK\x03\x04", 20, flag, 0, 0, 0,
                               crc, len(content), len(content), nh, 0) + name + content
        centrals += struct.pack("<4s6H3L5H2L", b"PK\x01\x02", 20, 20, flag, 0, 0, 0,
                                crc, len(content), len(content), nh, 0, 0, 0, 0, 0, off) + name
    eocd = struct.pack("<4s4H2LH", b"PK\x05\x06", 0, 0, len(entries), len(entries),
                       len(centrals), len(locals_), 0)
    return locals_ + centrals + eocd


@override_settings(MEDIA_ROOT=_TMP)
class ZipStructureTest(BnuTestCase):
    def setUp(self):
        super().setUp()
        self.course = create_course(code="ZIPTEST1")
        self.material = create_material(self.course, self.user, review_status="approved")
        self.material.file_name = "资料包.zip"
        self.material.file_path = f"{self.course.code}/test.zip"
        self.material.file_size = len(_make_zip_bytes())
        self.material.save()
        p = Path(settings.MEDIA_ROOT) / self.material.file_path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(_make_zip_bytes())
        self.cache_dir = Path(settings.MEDIA_ROOT).parent / ".zip_cache"

    def tearDown(self):
        super().tearDown()
        p = Path(settings.MEDIA_ROOT) / self.material.file_path
        if p.exists():
            p.unlink()
        if self.cache_dir.exists():
            for f in self.cache_dir.glob(f"z{self.material.id}_*"):
                f.unlink()

    def _cache_files(self):
        if not self.cache_dir.exists():
            return []
        return list(self.cache_dir.glob(f"z{self.material.id}_*.json"))

    def test_zip_structure_returns_items(self):
        self.client.set_token(self.user)
        r = self.client.get_json(f"/api/files/{self.material.id}/zip-structure/")
        self.assertEqual(r.status_code, 200)
        payload = r.json()["data"]
        self.assertEqual(payload["total"], 3)
        names = [it["name"] for it in payload["items"]]
        self.assertIn("README.md", names)
        self.assertIn("notes/lecture1.txt", names)
        self.assertFalse(payload.get("truncated"))
        # 目录条目不下发（由前端从路径推导）
        for it in payload["items"]:
            self.assertNotIn("is_dir", it)

    def test_zip_structure_second_call_hits_cache(self):
        self.client.set_token(self.user)
        r1 = self.client.get_json(f"/api/files/{self.material.id}/zip-structure/")
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(len(self._cache_files()), 1, "首次解析后应生成缓存文件")
        r2 = self.client.get_json(f"/api/files/{self.material.id}/zip-structure/")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r1.json(), r2.json(), "二次请求应命中缓存且结果一致")

    def test_zip_structure_requires_login(self):
        r = self.client.get(f"/api/files/{self.material.id}/zip-structure/")
        self.assertEqual(r.status_code, 401)

    def test_zip_structure_rejected_for_uploader(self):
        self.material.review_status = "rejected"
        self.material.is_approved = False
        self.material.save()
        self.client.set_token(self.user)
        r = self.client.get_json(f"/api/files/{self.material.id}/zip-structure/")
        self.assertEqual(r.status_code, 403)

    def test_zip_structure_bad_zip_returns_400(self):
        p = Path(settings.MEDIA_ROOT) / self.material.file_path
        p.write_bytes(b"this is definitely not a zip archive")
        self.client.set_token(self.user)
        r = self.client.get_json(f"/api/files/{self.material.id}/zip-structure/")
        self.assertEqual(r.status_code, 400)


@override_settings(MEDIA_ROOT=_TMP)
class ZipEncodeAndSecurityTest(BnuTestCase):
    """v=159 ZIP 加固：文件名多编码解码 / Zip Slip / 元数据过滤 / 扫描上限 / 层级上限"""

    def setUp(self):
        super().setUp()
        self.course = create_course(code="ZIPSEC1")
        self.material = create_material(self.course, self.user, review_status="approved")
        self.material.file_name = "资料包.zip"
        self.material.file_path = f"{self.course.code}/test.zip"
        self.material.save()
        self.path = Path(settings.MEDIA_ROOT) / self.material.file_path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_dir = Path(settings.MEDIA_ROOT).parent / ".zip_cache"

    def tearDown(self):
        super().tearDown()
        if self.path.exists():
            self.path.unlink()
        if self.cache_dir.exists():
            for f in self.cache_dir.glob(f"z{self.material.id}_*"):
                f.unlink()

    def _fetch(self):
        """返回 (payload, name 列表)；二次请求命中缓存，结果必须一致。"""
        self.client.set_token(self.user)
        r1 = self.client.get_json(f"/api/files/{self.material.id}/zip-structure/")
        self.assertEqual(r1.status_code, 200)
        r2 = self.client.get_json(f"/api/files/{self.material.id}/zip-structure/")
        self.assertEqual(r1.json(), r2.json(), "二次请求应命中缓存且结果一致")
        payload = r1.json()["data"]
        return payload, [it["name"] for it in payload["items"]]

    # ---------- 文件名编码 ----------
    def test_macos_utf8_no_flag_decodes_chinese(self):
        """macOS 归档（UTF-8 文件名、不设 UTF-8 flag）：不再显示 cp437 乱码。"""
        self.path.write_bytes(_raw_zip_bytes([
            ("第1章.pdf".encode("utf-8"), 0, b"hi"),
            ("统计学导论A期末复习要点.pdf".encode("utf-8"), 0, b"hi"),
            (b"README.md", 0, b"# r"),
        ]))
        payload, names = self._fetch()
        self.assertIn("第1章.pdf", names)
        self.assertIn("统计学导论A期末复习要点.pdf", names)
        self.assertIn("README.md", names)
        self.assertEqual(payload["total"], 3)

    def test_windows_gbk_no_flag_decodes_chinese(self):
        """Windows 归档（GBK 文件名、不设 UTF-8 flag）：按 GB18030 解出正确中文。"""
        self.path.write_bytes(_raw_zip_bytes([
            ("高等数学复习资料.pdf".encode("gbk"), 0, b"hi"),
            ("线性代数笔记.docx".encode("gbk"), 0, b"hi"),
        ]))
        _, names = self._fetch()
        self.assertIn("高等数学复习资料.pdf", names)
        self.assertIn("线性代数笔记.docx", names)

    def test_utf8_flag_set_keeps_chinese(self):
        """正常设了 UTF-8 flag 的中文名（Python writestr 产物）保持原样。"""
        self.path.write_bytes(_make_zip_bytes())
        _, names = self._fetch()
        self.assertIn("README.md", names)

    # ---------- 安全：Zip Slip / 绝对路径 ----------
    def test_zip_slip_and_absolute_paths_filtered(self):
        self.path.write_bytes(_raw_zip_bytes([
            (b"../../etc/passwd", 0, b"root"),
            (b"/etc/hosts", 0, b"x"),
            (b"..\\..\\win.txt", 0, b"x"),
            (b"a/../b/ok.txt", 0, b"ok"),   # 归一化后仍在包内 → 合法保留
            ("safe/讲义.pdf".encode("utf-8"), 0, b"x"),
        ]))
        payload, names = self._fetch()
        self.assertNotIn("../../etc/passwd", names)
        self.assertNotIn("/etc/hosts", names)
        self.assertNotIn("..\\..\\win.txt", names)
        self.assertIn("a/../b/ok.txt", names)
        self.assertIn("safe/讲义.pdf", names)
        self.assertEqual(payload["total"], 2)

    # ---------- 体验：macOS 元数据过滤 ----------
    def test_macos_metadata_filtered(self):
        self.path.write_bytes(_raw_zip_bytes([
            (b"__MACOSX/._01.pdf", 0, b"x"),
            (b"__MACOSX/notes", 0, b"x"),
            (b".DS_Store", 0, b"x"),
            (b"._statistics.pdf", 0, b"x"),
            ("real/讲义.pdf".encode("utf-8"), 0, b"x"),
        ]))
        payload, names = self._fetch()
        self.assertNotIn("__MACOSX/._01.pdf", names)
        self.assertNotIn("__MACOSX/notes", names)
        self.assertNotIn(".DS_Store", names)
        self.assertNotIn("._statistics.pdf", names)
        self.assertEqual(names, ["real/讲义.pdf"])
        self.assertEqual(payload["total"], 1)

    # ---------- 安全：扫描条目上限 ----------
    def test_scan_cap_truncates(self):
        self.path.write_bytes(_raw_zip_bytes([
            (f"f{i}.txt".encode(), 0, b"x") for i in range(10)
        ]))
        with mock.patch.object(files_views, "_ZIP_SCAN_MAX", 4):
            payload, names = self._fetch()
        self.assertTrue(payload["truncated"])
        self.assertLessEqual(len(names), 4)
        self.assertEqual(payload["total"], len(names))

    # ---------- 安全：层级上限 ----------
    def test_deep_entries_truncated_and_dropped(self):
        deep = "/".join(["d"] * 40) + "/f.txt"   # 40 层，超出 _ZIP_MAX_DEPTH=32
        self.path.write_bytes(_raw_zip_bytes([
            (deep.encode(), 0, b"x"),
            (b"a/b/c/f.txt", 0, b"ok"),          # 常规层级保留
        ]))
        payload, names = self._fetch()
        self.assertNotIn(deep, names)
        self.assertIn("a/b/c/f.txt", names)
        self.assertTrue(payload["truncated"])

    # ---------- 缓存：旧（乱码）缓存不可再命中 ----------
    def test_stale_cache_with_mojibake_not_served(self):
        """旧版缓存键不兼容 → 升版后即使磁盘有旧缓存也会重新解析。"""
        # 真实内容：UTF-8 无 flag 中文名（先写文件，stat 才有值）
        self.path.write_bytes(_raw_zip_bytes([
            ("笔记.pdf".encode("utf-8"), 0, b"hi"),
        ]))
        # 用旧键算法伪造一个含乱码的缓存文件
        st = self.path.stat()
        old_key = hashlib.md5(
            f"{self.material.id}:{st.st_size}:{int(st.st_mtime)}".encode("utf-8")
        ).hexdigest()[:16]
        stale = self.cache_dir / f"z{self.material.id}_{old_key}.json"
        stale.parent.mkdir(parents=True, exist_ok=True)
        stale.write_text(json.dumps({
            "file_name": "资料包.zip", "total": 1,
            "items": [{"name": "τ¼öΦ«░.pdf", "size": 1}], "truncated": False,
        }), encoding="utf-8")

        _, names = self._fetch()
        self.assertEqual(names, ["笔记.pdf"], "旧乱码缓存不得再命中")

        # 新键缓存已生成
        self.assertTrue(
            any(f.name.startswith(f"z{self.material.id}_") and f.name != stale.name
                for f in self.cache_dir.glob("z*_*.json")),
            "应生成新版本键的缓存文件",
        )
