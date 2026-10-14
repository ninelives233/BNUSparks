"""用户公开主页「紧凑贡献者名片」前端契约回归（v=317）。

名片与统计带合并、标签更名、分享主页/编辑资料操作、空态与加载失败重试、
资料行键盘可达与统计文字样式均为前端渲染约定，此处守门防止回退。
"""
from pathlib import Path

from django.conf import settings
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase

from .helpers import AuthClient, create_course, create_material, create_user
from ..models import DeletionRecord


class UserPublicCardContractTest(SimpleTestCase):
    def setUp(self):
        root = Path(settings.BASE_DIR)
        self.views = (root / "public/js/views.js").read_text(encoding="utf-8")
        self.user_css = (root / "public/css/user.css").read_text(encoding="utf-8")
        self.announcement_css = (root / "public/css/announcement.css").read_text(encoding="utf-8")

    def test_stat_strip_labels_and_merged_card(self):
        """三列统计带并入名片：上传资料/被下载/被收藏，独立统计卡标记不再输出"""
        self.assertIn("stat(u.upload_count, '上传资料')", self.views)
        self.assertIn("stat(u.download_count, '被下载')", self.views)
        self.assertIn("stat(u.collection_count, '被收藏')", self.views)
        self.assertNotIn("user-stats-row", self.views)
        self.assertIn('class="up-card"', self.views)

    def test_bio_placeholder_removed(self):
        """简介仅有内容时显示，占位句「此人神秘，未留简介」不得回归"""
        self.assertNotIn("此人神秘", self.views)

    def test_share_link_carries_user_id(self):
        """分享主页复制 /user/{id} 深链；缺用户标识时拒绝复制"""
        self.assertIn("copyUserProfileLink", self.views)
        self.assertIn("routeToPath('userPublic'", self.views)
        self.assertIn("缺少用户标识", self.views)

    def test_edit_profile_entry_gated_to_self(self):
        """「编辑资料」仅本人可见，进入既有个人中心流程"""
        self.assertIn("parseInt(userId, 10) === currentUser.id", self.views)
        self.assertIn("编辑资料", self.views)
        self.assertIn("showProfile()", self.views)

    def test_list_title_uses_api_total(self):
        """列表标题「上传资料 · N 份」使用接口 total，空态文案同步更新"""
        self.assertIn("上传资料 · ' + (data.total || 0) + ' 份", self.views)
        self.assertIn("暂未分享公开资料", self.views)
        self.assertNotIn("该用户尚未上传资料", self.views)
        self.assertNotIn("上传的文件</h3>", self.views)

    def test_load_failure_offers_retry(self):
        self.assertIn("retryUserPublic", self.views)
        self.assertIn("主页加载失败", self.views)

    def test_rows_keyboard_focusable_and_download_is_stat_text(self):
        """资料行可聚焦回车进入详情；下载次数为统计文字 + chevron 详情箭头"""
        self.assertIn("_upMakeRowsFocusable", self.views)
        self.assertIn("setAttribute('tabindex', '0')", self.views)
        self.assertIn("up-dl-count", self.views)
        self.assertIn("chevron-right", self.views)
        # 旧的下载图标式 side（易误读为下载按钮）不得回归
        self.assertNotIn("_IC_DOWN + '</span>' + m.download_count", self.views)

    def test_mobile_keeps_horizontal_card(self):
        """窄屏不再纵向居中名片；相关旧规则应从 announcement.css 移除"""
        self.assertNotIn("user-public-card", self.announcement_css)
        self.assertIn(".up-card { padding: 16px; }", self.user_css)

    def test_list_styles_scoped_to_public_page(self):
        """列表行样式经 .user-public-files 作用域限定，不影响共享 pc-* 场景"""
        self.assertIn(".user-public-files .pc-item:focus-visible", self.user_css)
        self.assertIn(".user-public-files .pc-item-side", self.user_css)


class UserPublicTotalContractTest(TestCase):
    """列表标题依赖的 total 与公开页口径一致：已通过且非幽灵"""

    def setUp(self):
        cache.clear()
        self.uploader = create_user("pubpage_uploader", first_name="贡献者")
        self.c = AuthClient()

    def test_total_counts_approved_non_ghost_only(self):
        course = create_course(code="GEN0041", name="近代物理")
        create_material(course, self.uploader, review_status="approved")
        ghost = create_material(course, self.uploader, review_status="approved")  # 删除中途残留
        create_material(course, self.uploader, review_status="pending")
        DeletionRecord.objects.create(
            material_id=ghost.id,
            title="测试资料",
            file_name="test.pdf",
            file_size=1024,
            course_code=course.code,
            course_name=course.name,
            uploader_name="贡献者",
            deleted_by=self.uploader,
        )
        r = self.c.get_json(f"/api/user/public/{self.uploader.id}/")
        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["user"]["upload_count"], data["total"])
        self.assertEqual(len(data["materials"]), data["total"])
