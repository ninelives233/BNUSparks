"""回归测试：用户公开页统计口径（v=133 修复）

历史 Bug：公开页「被下载次数」误统计为该用户自己的下载记录数，
应为其已通过资料被下载的总次数。
"""

import tempfile
from pathlib import Path

from django.conf import settings
from django.test import TestCase
from django.test.utils import override_settings
from django.contrib.auth.models import User
from django.core.cache import cache

from .helpers import AuthClient, create_course, create_material
from ..models import UserProfile, Material, DownloadRecord, DeletionRecord, Favorite


class UserPublicStatsTest(TestCase):
    def setUp(self):
        cache.clear()  # 公开页 API 有 60s 服务端缓存，避免跨测试脏读
        self.uploader = User.objects.create_user(
            username="uploader1", email="uploader1@mail.bnu.edu.cn",
            password="password123", first_name="上传者",
        )
        UserProfile.objects.create(user=self.uploader)
        self.c = AuthClient()

    def test_download_count_sums_upload_downloads_not_own_records(self):
        """被下载次数 = 该用户已通过资料被下载总次数，不含用户自己的下载记录"""
        course = create_course(code="GEN0001", name="大学语文")
        course2 = create_course(code="GEN0002", name="高数")
        m1 = create_material(course, self.uploader, review_status="approved")
        m2 = create_material(course2, self.uploader, review_status="approved")
        Material.objects.filter(id=m1.id).update(download_count=5)
        Material.objects.filter(id=m2.id).update(download_count=3)
        # 上传者自己下载他人文件 10 次（不应计入「被下载次数」）
        for _ in range(10):
            DownloadRecord.objects.create(
                user=self.uploader,
                material=m1,
                course_code=course.code,
                course_name=course.name,
                material_title=m1.title,
                file_name=m1.file_name,
            )
        r = self.c.get_json(f"/api/user/public/{self.uploader.id}/")
        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertEqual(data["user"]["upload_count"], 2)
        self.assertEqual(data["user"]["download_count"], 8)

    def test_collection_count_sums_favorites_on_public_materials(self):
        """公开页的被收藏次数应统计已通过审核且未删除资料的收藏总数"""
        course = create_course(code="GEN0010", name="大学英语")
        course2 = create_course(code="GEN0011", name="高等数学")
        m1 = create_material(course, self.uploader, review_status="approved")
        m2 = create_material(course2, self.uploader, review_status="approved")
        pending = create_material(course, self.uploader, review_status="pending")
        other = User.objects.create_user(
            username="favorite_user", email="favorite_user@mail.bnu.edu.cn",
            password="password123",
        )
        Favorite.objects.create(user=other, material=m1)
        Favorite.objects.create(user=other, material=m2)
        Favorite.objects.create(user=self.uploader, material=pending)

        r = self.c.get_json(f"/api/user/public/{self.uploader.id}/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["data"]["user"]["collection_count"], 2)

    def test_favorite_toggle_invalidates_public_stats_cache(self):
        """资料收藏/取消后，公开页统计不应继续返回旧缓存"""
        course = create_course(code="GEN0012", name="教育学")
        material = create_material(course, self.uploader, review_status="approved")
        other = User.objects.create_user(
            username="cache_favorite_user", email="cache_favorite_user@mail.bnu.edu.cn",
            password="password123",
        )

        first = self.c.get_json(f"/api/user/public/{self.uploader.id}/")
        self.assertEqual(first.json()["data"]["user"]["collection_count"], 0)

        self.c.set_token(other)
        toggled = self.c.post_json(f"/api/files/{material.id}/favorite/", {})
        self.assertEqual(toggled.status_code, 200, toggled.content)

        second = self.c.get_json(f"/api/user/public/{self.uploader.id}/")
        self.assertEqual(second.json()["data"]["user"]["collection_count"], 1)

    def test_public_page_hides_deleted_file_immediately(self):
        """删除已通过资料后，公开页即时不再显示（缓存随代际失效，60s 窗口内也生效）"""
        course = create_course(code="GEN0009", name="高等数学")
        m = create_material(course, self.uploader, review_status="approved")
        # 首次访问 → 生成并命中缓存
        r1 = self.c.get_json(f"/api/user/public/{self.uploader.id}/")
        self.assertEqual(r1.status_code, 200)
        self.assertIn(m.id, [it["id"] for it in r1.json()["data"]["materials"]])
        # 上传者删除该文件
        self.c.set_token(self.uploader)
        rdel = self.c.delete_json(f"/api/files/{m.id}/delete/")
        self.assertEqual(rdel.status_code, 200, rdel.content)
        # 删除后再次访问（仍在缓存窗口内）→ 应立即消失
        r2 = self.c.get_json(f"/api/user/public/{self.uploader.id}/")
        self.assertEqual(r2.status_code, 200)
        self.assertNotIn(m.id, [it["id"] for it in r2.json()["data"]["materials"]])

    def test_public_page_shows_member_since(self):
        """公开页应返回注册时间 member_since（yyyy-mm）"""
        r = self.c.get_json(f"/api/user/public/{self.uploader.id}/")
        self.assertEqual(r.status_code, 200)
        member_since = r.json()["data"]["user"]["member_since"]
        self.assertRegex(member_since, r"^\d{4}-\d{2}$")


class GhostMaterialTest(TestCase):
    """v=182：幽灵文件（有 DeletionRecord 但 Material 行残留）从公开页/排行榜排除"""

    def setUp(self):
        cache.clear()
        self.uploader = User.objects.create_user(
            username="ghost_uploader", email="ghost@mail.bnu.edu.cn",
            password="password123", first_name="幽灵上传者",
        )
        UserProfile.objects.create(user=self.uploader)
        self.c = AuthClient()

    def _make_ghost(self, material):
        """给已存在的 Material 行补一条 DeletionRecord，模拟删除中途失败的幽灵残留"""
        course = material.course
        return DeletionRecord.objects.create(
            material_id=material.id,
            title=material.title,
            file_name=material.file_name,
            file_size=material.file_size,
            course_code=course.code,
            course_name=course.name,
            uploader_name="幽灵上传者",
            deleted_by=self.uploader,
        )

    def test_public_page_excludes_ghost_material(self):
        """有 DeletionRecord 的 approved 行：不出现在公开页列表，也不计入 upload_count/download_count"""
        course = create_course(code="GEN0021", name="大学英语")
        ghost = create_material(course, self.uploader, review_status="approved")
        live = create_material(course, self.uploader, review_status="approved")
        self._make_ghost(ghost)

        r = self.c.get_json(f"/api/user/public/{self.uploader.id}/")
        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        material_ids = [it["id"] for it in data["materials"]]
        self.assertNotIn(ghost.id, material_ids)
        self.assertIn(live.id, material_ids)
        self.assertEqual(data["user"]["upload_count"], 1)

    def test_ranking_upload_counts_approved_non_ghost_only(self):
        """排行榜上传量：只算「已通过审核」且非幽灵；pending/幽灵均不计（用户拍板口径）"""
        course = create_course(code="GEN0022", name="数据结构")
        course2 = create_course(code="GEN0023", name="编译原理")
        create_material(course, self.uploader, review_status="approved")
        create_material(course, self.uploader, review_status="pending")
        ghost = create_material(course2, self.uploader, review_status="approved")
        self._make_ghost(ghost)

        r = self.c.get_json("/api/user/rankings/?type=upload")
        self.assertEqual(r.status_code, 200)
        items = r.json()["data"]["items"]
        row = next((x for x in items if x["user_id"] == self.uploader.id), None)
        self.assertIsNotNone(row, "上传者应进入上传量排行榜")
        self.assertEqual(row["count"], 1)  # 只算 1 条 approved 非幽灵，pending 与幽灵不计

    def test_clean_ghost_materials_command(self):
        """清理命令：删除幽灵行、保留正常行"""
        from django.core.management import call_command

        course = create_course(code="GEN0024", name="操作系统")
        course2 = create_course(code="GEN0025", name="计算机网络")
        ghost = create_material(course, self.uploader, review_status="approved")
        live = create_material(course2, self.uploader, review_status="approved")
        self._make_ghost(ghost)

        call_command("clean_ghost_materials", verbosity=0)
        self.assertFalse(Material.objects.filter(id=ghost.id).exists(), "幽灵行应被清理")
        self.assertTrue(Material.objects.filter(id=live.id).exists(), "正常行应保留")

    def test_clean_ghost_materials_dry_run(self):
        """清理命令 --dry-run：只统计不删除"""
        from django.core.management import call_command

        course = create_course(code="GEN0026", name="软件工程")
        ghost = create_material(course, self.uploader, review_status="approved")
        self._make_ghost(ghost)

        call_command("clean_ghost_materials", dry_run=True, verbosity=0)
        self.assertTrue(Material.objects.filter(id=ghost.id).exists(), "dry-run 不应删除")


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix="bnusparks_media_test_"))
class CleanGhostFilesTest(TestCase):
    """v=182.1：--check-files 扫描「文件缺失孤立死行」（Testfix 死行同款）"""

    def setUp(self):
        cache.clear()
        self.uploader = User.objects.create_user(
            username="orphan_uploader", email="orphan@mail.bnu.edu.cn",
            password="password123", first_name="孤儿上传者",
        )
        UserProfile.objects.create(user=self.uploader)

    def test_check_files_removes_missing_file_orphan(self):
        """--check-files：approved 但物理文件缺失的行被清理，有真实文件的行保留"""
        from django.core.management import call_command

        course = create_course(code="GEN0030", name="人工智能")
        course2 = create_course(code="GEN0031", name="机器学习")
        orphan = create_material(course, self.uploader, review_status="approved")  # 无真实文件
        live = create_material(course2, self.uploader, review_status="approved")
        # 给 live 造真实文件，模拟正常可下载资料
        p = Path(settings.MEDIA_ROOT) / live.file_path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"real file")

        call_command("clean_ghost_materials", check_files=True, verbosity=0)

        self.assertFalse(Material.objects.filter(id=orphan.id).exists(), "文件缺失的 approved 行应被清理")
        self.assertTrue(Material.objects.filter(id=live.id).exists(), "有真实文件的行应保留")

    def test_default_mode_keeps_missing_file_orphan(self):
        """默认模式不扫文件：文件缺失但无删除记录的行不删（防误删测试/临时数据）"""
        from django.core.management import call_command

        course = create_course(code="GEN0032", name="数据库")
        orphan = create_material(course, self.uploader, review_status="approved")
        call_command("clean_ghost_materials", verbosity=0)
        self.assertTrue(Material.objects.filter(id=orphan.id).exists(), "默认模式不应删文件缺失行")
