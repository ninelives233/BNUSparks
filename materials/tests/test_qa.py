"""问答区（新生指南）模块测试 — Phase 1

覆盖：2026 门控、匿名浏览、列表筛选/搜索/分页、详情占位、浏览量去重、
问题/回答收藏（联动）、回答点赞、管理权限矩阵、置顶上限、软删除、
编辑留痕/回滚、字数上限、HTML 净化、插图上传、埋点、每日日报、48h 硬删清理。
"""

from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image as PILImage

from ..models import (
    College,
    Notification,
    QaAnswer,
    QaAnswerLike,
    QaAskClickDaily,
    QaConfig,
    QaDeleteRequest,
    QaEditHistory,
    QaFavorite,
    QaQuestion,
    QaTag,
    QaViewLog,
    Report,
    UserProfile,
)
from ..views.qa import _purge_expired_qa, _send_daily_qa_report
from .helpers import BnuTestCase, create_college, create_user


def _make_png_bytes():
    buf = __import__("io").BytesIO()
    PILImage.new("RGB", (8, 8), "blue").save(buf, format="PNG")
    return buf.getvalue()


class QaBaseTestCase(BnuTestCase):
    def setUp(self):
        super().setUp()
        # 两级标签（通用由 migration 0024 种过一次，测试里 get_or_create 避免重复）
        self.general, _ = QaTag.objects.get_or_create(
            name="通用", level=1, defaults={"sort_order": 0})
        self.t_life, _ = QaTag.objects.get_or_create(
            name="校园生活", level=2, defaults={"sort_order": 1, "description": "衣食住用…"})
        self.t_study, _ = QaTag.objects.get_or_create(
            name="日常学习", level=2, defaults={"sort_order": 2, "description": "上课考试…"})
        # 问答区版主（小版主 + can_moderate_qa）
        self.qa_mod = create_user("qamod1", role="sub_moderator", first_name="问答版主")
        self.qa_mod.profile.can_moderate_qa = True
        self.qa_mod.profile.save()
        # 已发布问题 + 回答
        self.q1 = QaQuestion.objects.create(
            title="新生入学需要准备什么？", content="<p>请问需要哪些材料？</p>",
            author=self.admin, tag_l1=self.general, tag_l2=self.t_life,
        )
        self.q2 = QaQuestion.objects.create(
            title="图书馆几点关门？", content="<p>自习到多晚？</p>",
            author=self.admin, tag_l1=self.general, tag_l2=self.t_study,
        )
        self.ans1 = QaAnswer.objects.create(
            question=self.q1, author=self.admin, content="<p>录取通知书、身份证。</p>")

    def _create_question(self, title="测试标题", content="<p>正文</p>", **extra):
        return QaQuestion.objects.create(
            title=title, content=content, author=self.admin,
            tag_l1=self.general, tag_l2=self.t_life, **extra)


# ── 2026 门控 & 匿名浏览 ──

class QaGuestGateTests(QaBaseTestCase):
    def test_guest_verify_accepts_2026(self):
        r = self.client.post_json("/api/qa/guest/verify/", {"sid": "2026012345"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["data"]["verified"])

    def test_guest_verify_rejects_other_years(self):
        r = self.client.post_json("/api/qa/guest/verify/", {"sid": "2025012345"})
        self.assertEqual(r.status_code, 403)

    def test_guest_verify_requires_sid(self):
        r = self.client.post_json("/api/qa/guest/verify/", {})
        self.assertEqual(r.status_code, 400)

    def test_anonymous_browse_list(self):
        r = self.client.get_json("/api/qa/questions/")
        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertEqual(data["total"], 2)
        self.assertTrue(any(i["title"] == "新生入学需要准备什么？" for i in data["items"]))


# ── 列表 / 详情 ──

class QaBrowseTests(QaBaseTestCase):
    def test_detail_includes_question_and_answer_avatars(self):
        self.admin.profile.avatar.save(
            "qa-avatar.png", SimpleUploadedFile("qa-avatar.png", _make_png_bytes(), "image/png"),
            save=True,
        )
        r = self.client.get_json(f"/api/qa/questions/{self.q1.id}/")
        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertTrue(data["avatar_url"].startswith("/media/avatars/"))
        self.assertTrue(data["answers"][0]["avatar_url"].startswith("/media/avatars/"))

    def test_list_filter_by_tag_and_keyword(self):
        # 二级标签筛选
        r = self.client.get_json("/api/qa/questions/", {"tag_l2": self.t_life.id})
        titles = [i["title"] for i in r.json()["data"]["items"]]
        self.assertIn("新生入学需要准备什么？", titles)
        self.assertNotIn("图书馆几点关门？", titles)
        # 关键词搜索（标题）
        r = self.client.get_json("/api/qa/questions/", {"keyword": "图书馆"})
        self.assertEqual(r.json()["data"]["total"], 1)
        # 关键词搜索（正文）
        r = self.client.get_json("/api/qa/questions/", {"keyword": "材料"})
        self.assertEqual(r.json()["data"]["total"], 1)

    def test_list_pagination_and_pin_first(self):
        for i in range(12):
            self._create_question(title=f"分页问题{i}")
        pinned = self._create_question(title="置顶的帖子", is_pinned=True)
        pinned.pinned_at = timezone.now()
        pinned.save()
        r = self.client.get_json("/api/qa/questions/", {"page": 1, "pageSize": 10})
        data = r.json()["data"]
        self.assertEqual(data["total_pages"], 2)
        self.assertEqual(len(data["items"]), 10)
        self.assertEqual(data["items"][0]["title"], "置顶的帖子")

    def test_detail_includes_answers(self):
        self.client.set_token(self.admin)
        r = self.client.get_json(f"/api/qa/questions/{self.q1.id}/")
        data = r.json()["data"]
        self.assertFalse(data["deleted"])
        self.assertEqual(len(data["answers"]), 1)
        self.assertEqual(data["answers"][0]["content"], "<p>录取通知书、身份证。</p>")

    def test_detail_deleted_placeholder(self):
        self.client.set_token(self.qa_mod)
        self.client.delete_json(f"/api/admin/qa/questions/{self.q1.id}/delete/")
        r = self.client.get_json(f"/api/qa/questions/{self.q1.id}/")
        data = r.json()["data"]
        self.assertTrue(data["deleted"])
        self.assertEqual(data["deleted_hint"], "该内容已被删除")


# ── 浏览量去重 ──

class QaViewTests(QaBaseTestCase):
    def _view(self, qid, user=None):
        if user:
            self.client.set_token(user)
        else:
            self.client.defaults.pop("HTTP_AUTHORIZATION", None)
        return self.client.post_json(f"/api/qa/questions/{qid}/view/")

    def test_view_dedup_same_user_same_day(self):
        self._view(self.q1.id, self.user)
        self._view(self.q1.id, self.user)
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.view_count, 1)
        self.assertEqual(QaViewLog.objects.count(), 1)

    def test_view_increments_other_user(self):
        self._view(self.q1.id, self.user)
        self._view(self.q1.id, self.admin)
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.view_count, 2)

    def test_view_guest_dedup(self):
        self._view(self.q1.id, None)
        self._view(self.q1.id, None)
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.view_count, 1)


# ── 收藏 ──

class QaFavoriteTests(QaBaseTestCase):
    def test_question_favorite_toggle(self):
        self.client.set_token(self.user)
        r = self.client.post_json(f"/api/qa/questions/{self.q1.id}/favorite/")
        self.assertTrue(r.json()["data"]["favorited"])
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.favorite_count, 1)
        # 再次 toggle 取消
        r = self.client.post_json(f"/api/qa/questions/{self.q1.id}/favorite/")
        self.assertFalse(r.json()["data"]["favorited"])
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.favorite_count, 0)

    def test_answer_favorite_auto_favorites_question(self):
        self.client.set_token(self.user)
        r = self.client.post_json(f"/api/qa/answers/{self.ans1.id}/favorite/")
        self.assertTrue(r.json()["data"]["favorited"])
        # 问题级收藏也被同步建立
        self.assertTrue(QaFavorite.objects.filter(
            user=self.user, question=self.q1, answer__isnull=True).exists())
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.favorite_count, 1)
        # 合并收藏列表里出现该问题
        r = self.client.get_json("/api/qa/user/favorites/")
        ids = [i["id"] for i in r.json()["data"]["items"]]
        self.assertIn(self.q1.id, ids)

    def test_answer_unfavorite_keeps_question_fav(self):
        self.client.set_token(self.user)
        self.client.post_json(f"/api/qa/answers/{self.ans1.id}/favorite/")
        self.client.post_json(f"/api/qa/answers/{self.ans1.id}/favorite/")  # 取消回答收藏
        self.assertFalse(QaFavorite.objects.filter(user=self.user, answer=self.ans1).exists())
        self.assertTrue(QaFavorite.objects.filter(
            user=self.user, question=self.q1, answer__isnull=True).exists())
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.favorite_count, 1)

    def test_favorite_requires_login(self):
        r = self.client.post_json(f"/api/qa/questions/{self.q1.id}/favorite/")
        self.assertEqual(r.status_code, 401)


# ── 点赞 ──

class QaLikeTests(QaBaseTestCase):
    def test_answer_like_toggle(self):
        self.client.set_token(self.user)
        r = self.client.post_json(f"/api/qa/answers/{self.ans1.id}/like/")
        self.assertTrue(r.json()["data"]["liked"])
        self.assertEqual(r.json()["data"]["like_count"], 1)
        self.ans1.refresh_from_db()
        self.assertEqual(self.ans1.like_count, 1)
        # 取消点赞
        r = self.client.post_json(f"/api/qa/answers/{self.ans1.id}/like/")
        self.assertFalse(r.json()["data"]["liked"])
        self.ans1.refresh_from_db()
        self.assertEqual(self.ans1.like_count, 0)

    def test_answer_like_toggle_twice(self):
        # toggle 语义：两次点击 = 点赞再取消
        self.client.set_token(self.user)
        self.client.post_json(f"/api/qa/answers/{self.ans1.id}/like/")
        self.client.post_json(f"/api/qa/answers/{self.ans1.id}/like/")
        self.assertEqual(QaAnswerLike.objects.filter(answer=self.ans1).count(), 0)
        self.ans1.refresh_from_db()
        self.assertEqual(self.ans1.like_count, 0)

    def test_detail_returns_liked_state(self):
        self.client.set_token(self.user)
        self.client.post_json(f"/api/qa/answers/{self.ans1.id}/like/")
        r = self.client.get_json(f"/api/qa/questions/{self.q1.id}/")
        self.assertTrue(r.json()["data"]["answers"][0]["liked"])


# ── 管理权限与 CRUD ──

class QaAdminTests(QaBaseTestCase):
    def _post_question(self, user, **payload):
        if user:
            self.client.set_token(user)
        else:
            self.client.defaults.pop("HTTP_AUTHORIZATION", None)
        data = {"title": "新问题", "content": "<p>正文</p>",
                "tag_l1": self.general.id, "tag_l2": self.t_life.id}
        data.update(payload)
        return self.client.post_json("/api/admin/qa/questions/", data)

    def test_admin_permission_matrix(self):
        # 普通版主 403
        r = self._post_question(self.mod)
        self.assertEqual(r.status_code, 403)
        # 问答区版主通过
        r = self._post_question(self.qa_mod)
        self.assertEqual(r.status_code, 200)
        # 超管通过
        r = self._post_question(self.admin)
        self.assertEqual(r.status_code, 200)
        # 匿名 401
        r = self._post_question(None)
        self.assertEqual(r.status_code, 401)

    def test_create_validations(self):
        r = self._post_question(self.admin, title="")
        self.assertEqual(r.status_code, 400)
        r = self._post_question(self.admin, title="长" * 101)
        self.assertEqual(r.status_code, 400)
        r = self._post_question(self.admin, content="")
        self.assertEqual(r.status_code, 400)
        r = self._post_question(self.admin, tag_l2=999999)
        self.assertEqual(r.status_code, 400)

    def test_pin_limit_5(self):
        self.client.set_token(self.admin)
        for i in range(5):
            r = self.client.post_json("/api/admin/qa/questions/", {
                "title": f"置顶{i}", "content": "<p>x</p>",
                "tag_l1": self.general.id, "tag_l2": self.t_life.id, "is_pinned": True,
            })
            self.assertEqual(r.status_code, 200, f"第 {i + 1} 篇置顶应成功")
        # 第 6 篇置顶 → 400
        r = self.client.post_json("/api/admin/qa/questions/", {
            "title": "第六篇", "content": "<p>x</p>",
            "tag_l1": self.general.id, "tag_l2": self.t_life.id, "is_pinned": True,
        })
        self.assertEqual(r.status_code, 400)
        self.assertIn("置顶已满", r.json()["error"])

    def test_soft_delete_and_exclude_from_list(self):
        self.client.set_token(self.qa_mod)
        self.client.delete_json(f"/api/admin/qa/questions/{self.q1.id}/delete/")
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.status, "deleted")
        # 列表不再出现
        r = self.client.get_json("/api/qa/questions/")
        titles = [i["title"] for i in r.json()["data"]["items"]]
        self.assertNotIn(self.q1.title, titles)
        # 恢复
        self.client.put_json(f"/api/admin/qa/questions/{self.q1.id}/", {"status": "published"})
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.status, "published")

    def test_edit_history_and_rollback(self):
        self.client.set_token(self.qa_mod)
        r = self.client.put_json(f"/api/admin/qa/questions/{self.q1.id}/",
                                 {"title": "改后的标题", "content": "<p>新正文</p>"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(QaEditHistory.objects.filter(target_type="question", target_id=self.q1.id).count(), 1)
        history = self.client.get_json(f"/api/admin/qa/questions/{self.q1.id}/history/")
        hid = history.json()["data"]["items"][0]["id"]
        r = self.client.post_json(f"/api/admin/qa/questions/{self.q1.id}/rollback/", {"history_id": hid})
        self.assertEqual(r.status_code, 200)
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.title, "新生入学需要准备什么？")
        self.assertIn("请问需要哪些材料", self.q1.content)

    def test_answer_content_length_limit(self):
        self.client.set_token(self.admin)
        r = self.client.post_json(f"/api/admin/qa/questions/{self.q1.id}/answers/",
                                  {"content": "<p>" + "长" * 20001 + "</p>"})
        self.assertEqual(r.status_code, 400)

    def test_sanitizer_strips_scripts(self):
        self.client.set_token(self.admin)
        dirty = '<script>alert(1)</script><p onmouseover="x()">正文<img src="javascript:alert(1)"><img src="/media/qa_images/a.png"></p>'
        r = self.client.post_json("/api/admin/qa/questions/", {
            "title": "净化测试", "content": dirty,
            "tag_l1": self.general.id, "tag_l2": self.t_life.id,
        })
        self.assertEqual(r.status_code, 200)
        q = QaQuestion.objects.get(title="净化测试")
        self.assertNotIn("<script", q.content)
        self.assertNotIn("onmouseover", q.content)
        self.assertNotIn("javascript:", q.content)
        self.assertIn("/media/qa_images/a.png", q.content)

    def test_sanitizer_preserves_contenteditable_blocks_and_inline_formatting(self):
        self.client.set_token(self.admin)
        # 不同浏览器的 contenteditable 会把回车/加粗输出成 div/b/i；
        # 发布后必须规范化为白名单里的语义标签，而不是把段落拼成一行。
        dirty = '<div>第一段</div><div><b>重点</b>与<i>补充</i></div>第三行\n第四行'
        r = self.client.post_json("/api/admin/qa/questions/", {
            "title": "保留富文本结构", "content": dirty,
            "tag_l1": self.general.id, "tag_l2": self.t_life.id,
        })
        self.assertEqual(r.status_code, 200)
        q = QaQuestion.objects.get(title="保留富文本结构")
        self.assertIn("<p>第一段</p>", q.content)
        self.assertIn("<p><strong>重点</strong>与<em>补充</em></p>", q.content)
        self.assertIn("第三行<br>第四行", q.content)

    def test_records_and_pending(self):
        self.client.set_token(self.qa_mod)
        r = self.client.get_json("/api/admin/qa/records/")
        self.assertEqual(r.status_code, 200)
        kinds = {i["kind"] for i in r.json()["data"]["items"]}
        self.assertEqual(kinds, {"question", "answer"})
        r = self.client.get_json("/api/admin/qa/pending/")
        self.assertEqual(r.json()["data"]["total"], 0)  # Phase 1 恒空

    def test_upload_image(self):
        self.client.set_token(self.qa_mod)
        r = self.client.post("/api/admin/qa/upload-image/", {
            "image": SimpleUploadedFile("pic.png", _make_png_bytes(), "image/png"),
        }, **self.client.defaults)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["data"]["url"].startswith("/media/qa_images/"))
        # 非图片 → 400
        r = self.client.post("/api/admin/qa/upload-image/", {
            "image": SimpleUploadedFile("hack.txt", b"x", "text/plain"),
        }, **self.client.defaults)
        self.assertEqual(r.status_code, 400)


# ── 埋点 & 日报 ──

class QaAnalyticsTests(QaBaseTestCase):
    def test_ask_click_aggregates_daily(self):
        self.client.post_json("/api/qa/ask-click/")
        self.client.post_json("/api/qa/ask-click/")
        row = QaAskClickDaily.objects.get()
        self.assertEqual(row.count, 2)

    def test_daily_report_notifies_audience(self):
        row, _ = QaAskClickDaily.objects.get_or_create(date=timezone.now().date(), defaults={"count": 0})
        row.count = 7
        row.save()
        sent = _send_daily_qa_report()
        # 超管 + 问答区版主各一条
        self.assertTrue(Notification.objects.filter(
            recipient=self.admin, type=Notification.Type.OPERATION).exists())
        self.assertTrue(Notification.objects.filter(
            recipient=self.qa_mod, type=Notification.Type.OPERATION).exists())
        self.assertGreaterEqual(sent, 2)


# ── 48h 硬删（qa_purge 命令）──

class QaPurgeTests(QaBaseTestCase):
    def test_purge_expired_soft_deleted(self):
        # 收藏 + 编辑留痕 + 超期软删除 → 硬删并清理孤儿
        self.client.set_token(self.user)
        self.client.post_json(f"/api/qa/questions/{self.q1.id}/favorite/")
        QaEditHistory.objects.create(
            target_type="question", target_id=self.q1.id, editor=self.admin,
            old_title=self.q1.title, new_title="改后", old_content="", new_content="")
        self.client.set_token(self.qa_mod)
        self.client.delete_json(f"/api/admin/qa/questions/{self.q1.id}/delete/")
        self.q1.refresh_from_db()
        self.q1.deleted_at = timezone.now() - timedelta(hours=72)
        self.q1.save(update_fields=["deleted_at"])

        q_cnt, a_cnt = _purge_expired_qa()
        self.assertEqual(q_cnt, 1)
        self.assertEqual(a_cnt, 0)
        self.assertFalse(QaQuestion.objects.filter(id=self.q1.id).exists())
        # 收藏级联清理 + 孤儿编辑留痕清理
        self.assertFalse(QaFavorite.objects.filter(question_id=self.q1.id).exists())
        self.assertFalse(QaEditHistory.objects.filter(
            target_type="question", target_id=self.q1.id).exists())

    def test_purge_keeps_recent_soft_deleted(self):
        self.client.set_token(self.qa_mod)
        self.client.delete_json(f"/api/admin/qa/questions/{self.q1.id}/delete/")
        # deleted_at 为当前时间 → 未超期，保留
        q_cnt, a_cnt = _purge_expired_qa()
        self.assertEqual(q_cnt, 0)
        self.assertTrue(QaQuestion.objects.filter(id=self.q1.id).exists())

    def test_purge_expired_answer_cascade(self):
        # 超期回答硬删 → 级联清点赞；问题仍在
        self.client.set_token(self.user)
        self.client.post_json(f"/api/qa/answers/{self.ans1.id}/like/")
        self.client.set_token(self.qa_mod)
        self.client.delete_json(f"/api/admin/qa/answers/{self.ans1.id}/delete/")
        self.ans1.refresh_from_db()
        self.ans1.deleted_at = timezone.now() - timedelta(hours=72)
        self.ans1.save(update_fields=["deleted_at"])

        q_cnt, a_cnt = _purge_expired_qa()
        self.assertEqual(q_cnt, 0)
        self.assertEqual(a_cnt, 1)
        self.assertFalse(QaAnswer.objects.filter(id=self.ans1.id).exists())
        self.assertFalse(QaAnswerLike.objects.filter(answer_id=self.ans1.id).exists())
        # 问题不受影响
        self.assertTrue(QaQuestion.objects.filter(id=self.q1.id).exists())


# ── v175：两级标签种子 / 读时同步 / 净化 h2·https / 审核 pending·approve·reject / records 筛选 ──

class QaV175TagSeedTests(QaBaseTestCase):
    def test_seed_qa_tags_generates_all_and_idempotent(self):
        from ..qa_seed import L2_TAGS, seed_qa_tags
        create_college("新闻传播学院", "xinwen")
        created = seed_qa_tags(QaTag, College)
        # L1 = 通用 + 新建学院；L2 = 固定 8 个
        # （通用与 8 个 L2 已由 migration 0024 种过 → 本次仅新增学院 1 条）
        self.assertEqual(QaTag.objects.filter(level=1).count(), 2)
        self.assertEqual(QaTag.objects.filter(level=2).count(), len(L2_TAGS))
        self.assertEqual(created, 1)
        # 幂等：再调不重复
        self.assertEqual(seed_qa_tags(QaTag, College), 0)
        self.assertEqual(QaTag.objects.filter(level=1).count(), 2)
        self.assertEqual(QaTag.objects.filter(level=2).count(), len(L2_TAGS))

    def test_readtime_sync_adds_new_college_l1(self):
        create_college("环境学院", "huanjing")
        # 基类已有「通用」，新建学院后阈值触发 api_qa_tags 读时补种
        r = self.client.get_json("/api/qa/tags/")
        self.assertEqual(r.status_code, 200)
        names = [t["name"] for t in r.json()["data"]["l1"]]
        self.assertIn("通用", names)
        self.assertIn("环境学院", names)
        # L2 带 description
        l2 = r.json()["data"]["l2"]
        self.assertGreaterEqual(len(l2), 8)
        self.assertTrue(all(t.get("description") for t in l2))

    def test_renumber_l1_order_pins_general_then_econ_then_law(self):
        from ..qa_seed import renumber_l1_order
        # 模拟修复前错乱排序：法学院负偏移排最前、通用与一堆学院同 sort_order=0
        QaTag.objects.create(name="经济与工商管理学院", level=1, sort_order=0)
        QaTag.objects.create(name="法学院", level=1, sort_order=-184)
        QaTag.objects.create(name="文学院", level=1, sort_order=2)
        changed = renumber_l1_order(QaTag)
        self.assertGreaterEqual(changed, 2)
        names = [t.name for t in QaTag.objects.filter(level=1).order_by("sort_order", "id")]
        self.assertEqual(names[:4], ["通用", "经济与工商管理学院", "法学院", "文学院"])


class QaV175SanitizerTests(QaBaseTestCase):
    def test_https_image_and_h2_kept_scripts_stripped(self):
        self.client.set_token(self.admin)
        dirty = ('<script>alert(1)</script><h2>小标题</h2><p>正文</p>'
                 '<img src="https://example.com/a.png"><img src="http://example.com/b.png">')
        r = self.client.post_json("/api/admin/qa/questions/", {
            "title": "净化v175", "content": dirty,
            "tag_l1": self.general.id, "tag_l2": self.t_life.id,
        })
        self.assertEqual(r.status_code, 200)
        q = QaQuestion.objects.get(title="净化v175")
        self.assertNotIn("<script", q.content)
        self.assertNotIn("javascript:", q.content)
        self.assertIn("<h2>小标题</h2>", q.content)
        self.assertIn('src="https://example.com/a.png"', q.content)
        self.assertIn('src="http://example.com/b.png"', q.content)

    def test_strip_html_counts_h2(self):
        from ..views.qa import _strip_html
        self.assertEqual(_strip_html("<p>abc</p><h2>小标题</h2>"), "abc小标题")


class QaV175ReviewTests(QaBaseTestCase):
    def _make_pending(self):
        q = QaQuestion.objects.create(
            title="待审问题", content="<p>x</p>", author=self.user,
            tag_l1=self.general, tag_l2=self.t_life, status=QaQuestion.Status.PENDING)
        a = QaAnswer.objects.create(
            question=q, author=self.user, content="<p>待审回答</p>",
            status=QaAnswer.Status.PENDING)
        return q, a

    def test_pending_list_returns_real_items(self):
        q, a = self._make_pending()
        self.client.set_token(self.qa_mod)
        r = self.client.get_json("/api/admin/qa/pending/")
        data = r.json()["data"]
        self.assertEqual(data["total"], 2)
        kinds = {i["kind"] for i in data["items"]}
        self.assertEqual(kinds, {"question", "answer"})
        self.assertTrue(any(i["kind"] == "question" and i["id"] == q.id for i in data["items"]))
        self.assertTrue(any(
            i["kind"] == "answer" and i["id"] == a.id and i["question_id"] == q.id
            for i in data["items"]))

    def test_approve_pending_and_dedup(self):
        q, _ = self._make_pending()
        self.client.set_token(self.qa_mod)
        r = self.client.post_json(f"/api/admin/qa/questions/{q.id}/approve/")
        self.assertEqual(r.status_code, 200)
        q.refresh_from_db()
        self.assertEqual(q.status, "published")
        # 重复 approve → 400 防双审
        r2 = self.client.post_json(f"/api/admin/qa/questions/{q.id}/approve/")
        self.assertEqual(r2.status_code, 400)
        # 通过后从 pending 消失
        r3 = self.client.get_json("/api/admin/qa/pending/")
        self.assertEqual(r3.json()["data"]["total"], 1)

    def test_approve_permission_matrix(self):
        q, _ = self._make_pending()
        # 普通版主 403
        self.client.set_token(self.mod)
        r = self.client.post_json(f"/api/admin/qa/questions/{q.id}/approve/")
        self.assertEqual(r.status_code, 403)
        # 匿名 401
        self.client.defaults.pop("HTTP_AUTHORIZATION", None)
        r = self.client.post_json(f"/api/admin/qa/questions/{q.id}/approve/")
        self.assertEqual(r.status_code, 401)

    def test_answer_approve_and_reject(self):
        _, a = self._make_pending()
        self.client.set_token(self.qa_mod)
        r = self.client.post_json(f"/api/admin/qa/answers/{a.id}/approve/")
        self.assertEqual(r.status_code, 200)
        a.refresh_from_db()
        self.assertEqual(a.status, "published")
        # 驳回回答
        q2, a2 = self._make_pending()
        r2 = self.client.post_json(f"/api/admin/qa/answers/{a2.id}/reject/", {"reason": "重复"})
        self.assertEqual(r2.status_code, 200)
        a2.refresh_from_db()
        self.assertEqual(a2.status, "rejected")

    def test_reject_with_reason_notifies_author(self):
        q, _ = self._make_pending()
        self.client.set_token(self.qa_mod)
        r = self.client.post_json(f"/api/admin/qa/questions/{q.id}/reject/", {"reason": "内容不合规"})
        self.assertEqual(r.status_code, 200)
        q.refresh_from_db()
        self.assertEqual(q.status, "rejected")
        notif = Notification.objects.filter(recipient=self.user, type=Notification.Type.OPERATION)
        self.assertTrue(notif.exists())
        self.assertIn("驳回原因：内容不合规", notif.first().message)

    def test_reject_without_reason_no_notification(self):
        q, _ = self._make_pending()
        self.client.set_token(self.qa_mod)
        r = self.client.post_json(f"/api/admin/qa/questions/{q.id}/reject/", {})
        self.assertEqual(r.status_code, 200)
        q.refresh_from_db()
        self.assertEqual(q.status, "rejected")
        self.assertFalse(Notification.objects.filter(recipient=self.user).exists())

    def test_records_status_filter(self):
        self._make_pending()
        self.client.set_token(self.qa_mod)
        # pending：仅待审 2 条
        r = self.client.get_json("/api/admin/qa/records/", {"status": "pending"})
        items = r.json()["data"]["items"]
        self.assertEqual(len(items), 2)
        self.assertTrue(all(i["status"] == "pending" for i in items))
        # published：基类发布数据
        r2 = self.client.get_json("/api/admin/qa/records/", {"status": "published"})
        items2 = r2.json()["data"]["items"]
        self.assertGreaterEqual(len(items2), 3)
        self.assertTrue(all(i["status"] == "published" for i in items2))

    def test_question_create_keeps_h2(self):
        self.client.set_token(self.admin)
        r = self.client.post_json("/api/admin/qa/questions/", {
            "title": "含小标题", "content": "<h2>第一步</h2><p>正文</p>",
            "tag_l1": self.general.id, "tag_l2": self.t_life.id,
        })
        self.assertEqual(r.status_code, 200)
        q = QaQuestion.objects.get(title="含小标题")
        self.assertIn("<h2>第一步</h2>", q.content)


# ═══════════════════════════════════════════════════════════════
# Phase 2 (v183)：站点开关 / 用户提交 / 编辑留痕 / 删除申请 / 采纳 / 热度 / 详情收紧 / 举报
# ═══════════════════════════════════════════════════════════════

class QaV183BaseTestCase(QaBaseTestCase):
    """v183 测试基类：重置站点开关单例 + 常用动作封装"""

    def setUp(self):
        super().setUp()
        # 站点开关单例跨测试隔离：默认关闭
        QaConfig.objects.filter(pk=1).delete()

    def _set_user_open(self, open_=True):
        cfg, _ = QaConfig.objects.get_or_create(pk=1)
        cfg.user_open = open_
        cfg.save(update_fields=["user_open"])

    def _toggle_config(self, user):
        if user:
            self.client.set_token(user)
        else:
            self.client.defaults.pop("HTTP_AUTHORIZATION", None)
        return self.client.post_json("/api/admin/qa/config/")

    def _user_post_question(self, user, **payload):
        self.client.set_token(user)
        data = {"title": "普通用户问题", "content": "<p>请问</p>",
                "tag_l1": self.general.id, "tag_l2": self.t_life.id}
        data.update(payload)
        return self.client.post_json("/api/qa/questions/", data)

    def _user_post_answer(self, user, qid, **payload):
        self.client.set_token(user)
        data = {"content": "<p>回答正文</p>"}
        data.update(payload)
        return self.client.post_json(f"/api/qa/questions/{qid}/answers/", data)

    def _open_create_user_question(self, user=None, **payload):
        """开关开 + 普通用户提问，返回创建的 QaQuestion 行"""
        user = user or self.user
        self._set_user_open(True)
        r = self._user_post_question(user, **payload)
        self.assertEqual(r.status_code, 200)
        return QaQuestion.objects.get(id=r.json()["data"]["id"])


# ── 站点开关（QaV183ConfigTests）──

class QaV183ConfigTests(QaV183BaseTestCase):
    def test_default_closed(self):
        r = self.client.get_json("/api/qa/config/")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()["data"]["user_open"])

    def test_toggle_requires_super_admin(self):
        # 匿名 401
        r = self._toggle_config(None)
        self.assertEqual(r.status_code, 401)
        # 普通用户 / 小版主 / 版主 / 问答区版主（非超管）一律 403
        for u in (self.user, self.sub_mod, self.mod, self.qa_mod):
            self.assertEqual(self._toggle_config(u).status_code, 403, u.username)

    def test_super_admin_toggle_persists(self):
        r = self._toggle_config(self.admin)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["data"]["user_open"])
        cfg = QaConfig.objects.get(pk=1)
        self.assertTrue(cfg.user_open)
        self.assertEqual(cfg.updated_by_id, self.admin.id)
        # 再切一次 → 关闭
        r = self._toggle_config(self.admin)
        self.assertFalse(r.json()["data"]["user_open"])
        # 状态端点反映
        self.client.set_token(self.admin)
        self.assertFalse(self.client.get_json("/api/qa/config/").json()["data"]["user_open"])


# ── 用户提交（QaV183UserSubmitTests）──

class QaV183UserSubmitTests(QaV183BaseTestCase):
    def test_question_closed_forbidden(self):
        r = self._user_post_question(self.user)
        self.assertEqual(r.status_code, 403)

    def test_answer_closed_forbidden(self):
        r = self._user_post_answer(self.user, self.q1.id)
        self.assertEqual(r.status_code, 403)

    def test_question_anonymous_401(self):
        self._set_user_open(True)
        self.client.defaults.pop("HTTP_AUTHORIZATION", None)
        r = self.client.post_json("/api/qa/questions/", {
            "title": "匿名", "content": "<p>x</p>",
            "tag_l1": self.general.id, "tag_l2": self.t_life.id})
        self.assertEqual(r.status_code, 401)

    def test_question_open_creates_pending(self):
        q = self._open_create_user_question(self.user)
        self.assertEqual(q.status, QaQuestion.Status.PENDING)
        self.assertFalse(q.is_pinned)
        self.assertEqual(q.author_id, self.user.id)

    def test_answer_open_creates_pending(self):
        self._set_user_open(True)
        r = self._user_post_answer(self.user, self.q1.id)
        self.assertEqual(r.status_code, 200)
        a = QaAnswer.objects.get(id=r.json()["data"]["id"])
        self.assertEqual(a.status, QaAnswer.Status.PENDING)
        self.assertEqual(a.question_id, self.q1.id)
        self.assertEqual(a.author_id, self.user.id)

    def test_question_validations(self):
        self._set_user_open(True)
        self.assertEqual(self._user_post_question(self.user, title="").status_code, 400)
        self.assertEqual(self._user_post_question(self.user, title="长" * 101).status_code, 400)
        self.assertEqual(self._user_post_question(self.user, content="").status_code, 400)
        self.assertEqual(self._user_post_question(self.user, content="<p>" + "长" * 1001 + "</p>").status_code, 400)
        self.assertEqual(self._user_post_question(self.user, tag_l1=999999).status_code, 400)
        self.assertEqual(self._user_post_question(self.user, tag_l2=999999).status_code, 400)

    def test_is_pinned_ignored_for_user(self):
        q = self._open_create_user_question(self.user, is_pinned=True)
        self.assertFalse(q.is_pinned)

    def test_content_sanitized(self):
        q = self._open_create_user_question(self.user, content='<script>alert(1)</script><p>安全</p>')
        self.assertNotIn("script", q.content)
        self.assertIn("安全", q.content)

    def test_submission_broadcasts_to_moderators(self):
        self._set_user_open(True)
        self._user_post_question(self.user)
        # 问答区版主 + 超管各收一条 NEW_PENDING（广播排除提交人自己）
        self.assertEqual(Notification.objects.filter(
            recipient=self.qa_mod, type=Notification.Type.NEW_PENDING).count(), 1)
        self.assertEqual(Notification.objects.filter(
            recipient=self.admin, type=Notification.Type.NEW_PENDING).count(), 1)


# ── 用户编辑留痕（QaV183UserEditTests）──

class QaV183UserEditTests(QaV183BaseTestCase):
    def test_owner_can_edit_own_question(self):
        q = self._open_create_user_question(self.user)
        self.client.set_token(self.user)
        r = self.client.put_json(f"/api/qa/questions/{q.id}/", {
            "title": "改后标题", "content": "<p>改后正文</p>"})
        self.assertEqual(r.status_code, 200)
        q.refresh_from_db()
        self.assertEqual(q.title, "改后标题")
        # 编辑留痕
        self.assertEqual(QaEditHistory.objects.filter(
            target_type="question", target_id=q.id).count(), 1)

    def test_edit_non_owner_403(self):
        q = self._open_create_user_question(self.user)
        self.client.set_token(self.admin)
        r = self.client.put_json(f"/api/qa/questions/{q.id}/", {"title": "劫持"})
        self.assertEqual(r.status_code, 403)

    def test_edit_rejected_back_to_pending(self):
        q = self._open_create_user_question(self.user)
        q.status = QaQuestion.Status.REJECTED
        q.save(update_fields=["status"])
        self.client.set_token(self.user)
        r = self.client.put_json(f"/api/qa/questions/{q.id}/", {"title": "重新提交"})
        self.assertEqual(r.status_code, 200)
        q.refresh_from_db()
        self.assertEqual(q.status, QaQuestion.Status.PENDING)

    def test_answer_owner_edit_writes_history(self):
        self._set_user_open(True)
        aid = self._user_post_answer(self.user, self.q1.id).json()["data"]["id"]
        self.client.set_token(self.user)
        r = self.client.put_json(f"/api/qa/answers/{aid}/", {"content": "<p>新回答</p>"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(QaEditHistory.objects.filter(
            target_type="answer", target_id=aid).count(), 1)

    def test_edit_published_keeps_published(self):
        q = QaQuestion.objects.create(
            title="用户已发布问题", content="<p>x</p>", author=self.user,
            tag_l1=self.general, tag_l2=self.t_life)
        self.client.set_token(self.user)
        r = self.client.put_json(f"/api/qa/questions/{q.id}/", {"title": "编辑已发布"})
        self.assertEqual(r.status_code, 200)
        q.refresh_from_db()
        self.assertEqual(q.status, QaQuestion.Status.PUBLISHED)
        self.assertEqual(q.title, "编辑已发布")


# ── 删除申请（QaV183DeleteRequestTests）──

class QaV183DeleteRequestTests(QaV183BaseTestCase):
    def _user_question(self, **extra):
        return QaQuestion.objects.create(
            title="用户的问题", content="<p>x</p>", author=self.user,
            tag_l1=self.general, tag_l2=self.t_life, **extra)

    def _delete_question(self, user, qid, reason="理由"):
        self.client.set_token(user)
        return self.client.delete_json(f"/api/qa/questions/{qid}/", {"reason": reason})

    def test_simple_question_auto_soft_delete(self):
        q = self._user_question()  # 无回答 → 自动批准直接软删
        r = self._delete_question(self.user, q.id)
        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertFalse(data["submitted"])
        self.assertEqual(data["status"], "deleted")
        q.refresh_from_db()
        self.assertEqual(q.status, QaQuestion.Status.DELETED)
        # 留痕：auto_approved 申请记录
        req = QaDeleteRequest.objects.get(target_type="question", target_id=q.id)
        self.assertTrue(req.auto_approved)
        self.assertEqual(req.reason, "理由")

    def test_question_with_answer_needs_approval(self):
        q = self._user_question()
        QaAnswer.objects.create(question=q, author=self.admin, content="<p>已有回答</p>")
        r = self._delete_question(self.user, q.id)
        self.assertEqual(r.status_code, 200)
        data = r.json()["data"]
        self.assertTrue(data["submitted"])
        self.assertEqual(data["status"], "pending")
        # 内容保持可见
        q.refresh_from_db()
        self.assertEqual(q.status, QaQuestion.Status.PUBLISHED)
        req = QaDeleteRequest.objects.get(target_type="question", target_id=q.id)
        self.assertFalse(req.auto_approved)
        self.assertEqual(req.status, QaDeleteRequest.Status.PENDING)

    def test_answer_with_like_needs_approval(self):
        a = QaAnswer.objects.create(
            question=self.q1, author=self.user, content="<p>我的回答</p>", like_count=1)
        self.client.set_token(self.user)
        r = self.client.delete_json(f"/api/qa/answers/{a.id}/", {"reason": "理由"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["data"]["submitted"])
        a.refresh_from_db()
        self.assertEqual(a.status, QaAnswer.Status.PUBLISHED)

    def test_answer_with_favorite_needs_approval(self):
        a = QaAnswer.objects.create(question=self.q1, author=self.user, content="<p>我的回答</p>")
        QaFavorite.objects.create(user=self.admin, question=self.q1, answer=a)
        self.client.set_token(self.user)
        r = self.client.delete_json(f"/api/qa/answers/{a.id}/", {"reason": "理由"})
        self.assertTrue(r.json()["data"]["submitted"])
        a.refresh_from_db()
        self.assertEqual(a.status, QaAnswer.Status.PUBLISHED)

    def test_answer_simple_auto_soft_delete(self):
        a = QaAnswer.objects.create(question=self.q1, author=self.user, content="<p>我的回答</p>")
        self.client.set_token(self.user)
        r = self.client.delete_json(f"/api/qa/answers/{a.id}/", {"reason": "理由"})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()["data"]["submitted"])
        a.refresh_from_db()
        self.assertEqual(a.status, QaAnswer.Status.DELETED)

    def test_delete_reason_required(self):
        q = self._user_question()
        self.client.set_token(self.user)
        r = self.client.delete_json(f"/api/qa/questions/{q.id}/", {})
        self.assertEqual(r.status_code, 400)

    def test_duplicate_pending_request_rejected(self):
        q = self._user_question()
        QaAnswer.objects.create(question=q, author=self.admin, content="<p>已有回答</p>")
        self.assertEqual(self._delete_question(self.user, q.id).status_code, 200)
        # 同一目标重复提交 → 400，且仅一条 PENDING 申请
        r = self._delete_question(self.user, q.id)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(QaDeleteRequest.objects.filter(
            target_type="question", target_id=q.id,
            status=QaDeleteRequest.Status.PENDING).count(), 1)

    def test_admin_approve_soft_deletes_and_notifies(self):
        q = self._user_question()
        QaAnswer.objects.create(question=q, author=self.admin, content="<p>已有回答</p>")
        self._delete_question(self.user, q.id)
        req = QaDeleteRequest.objects.get(target_type="question", target_id=q.id)
        # 非管理端 403
        self.assertEqual(self._delete_question.__wrapped__ if False else self.client.post_json(
            f"/api/admin/qa/delete-requests/{req.id}/approve/").status_code, 403)
        # 问答区版主批准 → 软删 + 通知申请人
        self.client.set_token(self.qa_mod)
        r = self.client.post_json(f"/api/admin/qa/delete-requests/{req.id}/approve/")
        self.assertEqual(r.status_code, 200)
        req.refresh_from_db()
        self.assertEqual(req.status, QaDeleteRequest.Status.APPROVED)
        q.refresh_from_db()
        self.assertEqual(q.status, QaQuestion.Status.DELETED)
        self.assertTrue(Notification.objects.filter(
            recipient=self.user, type=Notification.Type.OPERATION,
            title="你的删除申请已通过").exists())

    def test_admin_reject_keeps_content(self):
        q = self._user_question()
        QaAnswer.objects.create(question=q, author=self.admin, content="<p>已有回答</p>")
        self._delete_question(self.user, q.id)
        req = QaDeleteRequest.objects.get(target_type="question", target_id=q.id)
        self.client.set_token(self.qa_mod)
        r = self.client.post_json(f"/api/admin/qa/delete-requests/{req.id}/reject/",
                                  {"reason": "回答有保留价值"})
        self.assertEqual(r.status_code, 200)
        req.refresh_from_db()
        self.assertEqual(req.status, QaDeleteRequest.Status.REJECTED)
        q.refresh_from_db()
        self.assertEqual(q.status, QaQuestion.Status.PUBLISHED)
        n = Notification.objects.filter(
            recipient=self.user, type=Notification.Type.OPERATION,
            title="你的删除申请未通过").first()
        self.assertIsNotNone(n)
        self.assertIn("回答有保留价值", n.message)

    def test_delete_requests_visible_in_pending_and_records(self):
        q = self._user_question()
        QaAnswer.objects.create(question=q, author=self.admin, content="<p>已有回答</p>")
        self._delete_question(self.user, q.id)
        self.client.set_token(self.qa_mod)
        # pending 列表带 delete_requests
        r = self.client.get_json("/api/admin/qa/pending/")
        drs = r.json()["data"]["delete_requests"]
        self.assertEqual(len(drs), 1)
        self.assertEqual(drs[0]["target_id"], q.id)
        self.assertEqual(drs[0]["reason"], "理由")
        # 记录端点（含已处理）留痕
        r = self.client.get_json("/api/admin/qa/delete-requests/")
        self.assertEqual(r.json()["data"]["total"], 1)
        # 状态筛选
        r = self.client.get_json("/api/admin/qa/delete-requests/?status=approved")
        self.assertEqual(r.json()["data"]["total"], 0)


# ── 最佳回答采纳（QaV183AcceptTests）──

class QaV183AcceptTests(QaV183BaseTestCase):
    def _asker_question(self):
        return QaQuestion.objects.create(
            title="提问者的问题", content="<p>x</p>", author=self.user,
            tag_l1=self.general, tag_l2=self.t_life)

    def test_asker_can_accept_when_open(self):
        self._set_user_open(True)
        q = self._asker_question()
        a = QaAnswer.objects.create(question=q, author=self.admin, content="<p>好答案</p>")
        self.client.set_token(self.user)
        r = self.client.post_json(f"/api/qa/answers/{a.id}/accept/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["data"]["accepted"])
        a.refresh_from_db()
        self.assertTrue(a.is_accepted)
        # 详情 has_accepted
        d = self.client.get_json(f"/api/qa/questions/{q.id}/")
        self.assertTrue(d.json()["data"]["has_accepted"])

    def test_asker_blocked_when_closed(self):
        q = self._asker_question()
        a = QaAnswer.objects.create(question=q, author=self.admin, content="<p>答案</p>")
        self.client.set_token(self.user)
        r = self.client.post_json(f"/api/qa/answers/{a.id}/accept/")
        self.assertEqual(r.status_code, 403)

    def test_manager_can_accept_anytime(self):
        q = self._asker_question()
        a = QaAnswer.objects.create(question=q, author=self.admin, content="<p>答案</p>")
        self.client.set_token(self.qa_mod)
        r = self.client.post_json(f"/api/qa/answers/{a.id}/accept/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["data"]["accepted"])

    def test_non_asker_non_manager_403(self):
        q = self._asker_question()
        a = QaAnswer.objects.create(question=q, author=self.admin, content="<p>答案</p>")
        other = create_user("student2", role="user", first_name="学生乙")
        self.client.set_token(other)
        r = self.client.post_json(f"/api/qa/answers/{a.id}/accept/")
        self.assertEqual(r.status_code, 403)

    def test_only_one_accepted_per_question(self):
        q = self._asker_question()
        a1 = QaAnswer.objects.create(question=q, author=self.admin, content="<p>甲</p>")
        a2 = QaAnswer.objects.create(question=q, author=self.admin, content="<p>乙</p>")
        self.client.set_token(self.qa_mod)
        self.client.post_json(f"/api/qa/answers/{a1.id}/accept/")
        self.client.post_json(f"/api/qa/answers/{a2.id}/accept/")
        a1.refresh_from_db()
        a2.refresh_from_db()
        self.assertFalse(a1.is_accepted)
        self.assertTrue(a2.is_accepted)

    def test_accept_toggle_cancels(self):
        q = self._asker_question()
        a = QaAnswer.objects.create(question=q, author=self.admin, content="<p>答案</p>")
        self.client.set_token(self.qa_mod)
        self.client.post_json(f"/api/qa/answers/{a.id}/accept/")
        r = self.client.post_json(f"/api/qa/answers/{a.id}/accept/")
        self.assertFalse(r.json()["data"]["accepted"])
        a.refresh_from_db()
        self.assertFalse(a.is_accepted)

    def test_accept_notifies_author(self):
        self._set_user_open(True)
        q = self._asker_question()
        a = QaAnswer.objects.create(question=q, author=self.admin, content="<p>答案</p>")
        self.client.set_token(self.user)  # 提问者，非回答作者
        self.client.post_json(f"/api/qa/answers/{a.id}/accept/")
        self.assertTrue(Notification.objects.filter(
            recipient=self.admin, type=Notification.Type.OPERATION,
            title="你的回答被采纳为最佳回答").exists())


# ── 热度排序（QaV183HeatTests）──

class QaV183HeatTests(QaV183BaseTestCase):
    def test_view_increments_heat(self):
        self.assertEqual(self.q1.heat_score, 0)
        self.client.set_token(self.user)
        self.client.post_json(f"/api/qa/questions/{self.q1.id}/view/")
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.heat_score, 1)

    def test_favorite_toggles_heat(self):
        self.client.set_token(self.user)
        self.client.post_json(f"/api/qa/questions/{self.q1.id}/favorite/")
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.heat_score, 3)
        self.client.post_json(f"/api/qa/questions/{self.q1.id}/favorite/")
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.heat_score, 0)

    def test_like_toggles_heat(self):
        self.client.set_token(self.user)
        self.client.post_json(f"/api/qa/answers/{self.ans1.id}/like/")
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.heat_score, 2)
        self.client.post_json(f"/api/qa/answers/{self.ans1.id}/like/")
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.heat_score, 0)

    def test_answer_approve_bumps_heat(self):
        a = QaAnswer.objects.create(
            question=self.q1, author=self.user, content="<p>待审回答</p>",
            status=QaAnswer.Status.PENDING)
        self.client.set_token(self.qa_mod)
        self.client.post_json(f"/api/admin/qa/answers/{a.id}/approve/")
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.heat_score, 5)

    def test_heat_not_negative(self):
        # 取消收藏/点赞把热度打回 0 而非负数（防负护栏）
        self.client.set_token(self.user)
        self.client.post_json(f"/api/qa/questions/{self.q1.id}/favorite/")
        self.client.post_json(f"/api/qa/questions/{self.q1.id}/favorite/")
        self.client.post_json(f"/api/qa/answers/{self.ans1.id}/like/")
        self.client.post_json(f"/api/qa/answers/{self.ans1.id}/like/")
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.heat_score, 0)

    def test_sort_heat_order(self):
        # 直接铺热度（点赞/收藏的 +2/+3 已在上述用例覆盖），验证 sort=heat 排序
        QaQuestion.objects.filter(id=self.q1.id).update(heat_score=6)
        QaQuestion.objects.filter(id=self.q2.id).update(heat_score=2)
        r = self.client.get_json("/api/qa/questions/?sort=heat")
        titles = [i["title"] for i in r.json()["data"]["items"]]
        self.assertEqual(titles[0], self.q1.title)
        # 默认排序（created_at 新在前）不一定是 q1
        r2 = self.client.get_json("/api/qa/questions/")
        self.assertIn(self.q1.title, [i["title"] for i in r2.json()["data"]["items"]])


# ── 详情安全收紧（QaV183DetailTests）──

class QaV183DetailTests(QaV183BaseTestCase):
    def test_owner_sees_own_pending(self):
        q = self._open_create_user_question(self.user)
        self.client.set_token(self.user)
        r = self.client.get_json(f"/api/qa/questions/{q.id}/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["data"]["status"], "pending")

    def test_other_cannot_see_pending(self):
        q = self._open_create_user_question(self.user)
        other = create_user("student2", role="user", first_name="学生乙")
        self.client.set_token(other)
        self.assertEqual(self.client.get_json(f"/api/qa/questions/{q.id}/").status_code, 404)

    def test_anonymous_cannot_see_pending(self):
        q = self._open_create_user_question(self.user)
        self.client.defaults.pop("HTTP_AUTHORIZATION", None)
        self.assertEqual(self.client.get_json(f"/api/qa/questions/{q.id}/").status_code, 404)

    def test_manager_can_see_pending(self):
        q = self._open_create_user_question(self.user)
        self.client.set_token(self.qa_mod)
        self.assertEqual(self.client.get_json(f"/api/qa/questions/{q.id}/").status_code, 200)

    def test_detail_v183_fields(self):
        self.client.set_token(self.admin)
        r = self.client.get_json(f"/api/qa/questions/{self.q1.id}/")
        data = r.json()["data"]
        self.assertEqual(data["owner_id"], self.admin.id)
        self.assertFalse(data["qa_user_open"])
        self.assertFalse(data["has_accepted"])
        self.assertIn("is_accepted", data["answers"][0])
        self.assertIn("author_id", data["answers"][0])

    def test_rejected_only_owner_or_manager(self):
        q = self._open_create_user_question(self.user)
        q.status = QaQuestion.Status.REJECTED
        q.save(update_fields=["status"])
        other = create_user("student2", role="user", first_name="学生乙")
        self.client.set_token(other)
        self.assertEqual(self.client.get_json(f"/api/qa/questions/{q.id}/").status_code, 404)
        self.client.set_token(self.user)
        self.assertEqual(self.client.get_json(f"/api/qa/questions/{q.id}/").status_code, 200)

    def test_history_pending_owner_visible_other_forbidden(self):
        q = self._open_create_user_question(self.user)
        self.client.set_token(self.user)
        self.client.put_json(f"/api/qa/questions/{q.id}/", {"title": "历史1"})
        # 作者可读
        r = self.client.get_json(f"/api/admin/qa/questions/{q.id}/history/")
        self.assertEqual(r.status_code, 200)
        self.assertGreaterEqual(len(r.json()["data"]["items"]), 1)
        # 他人 403（防经 history 侧漏待审内容）
        other = create_user("student2", role="user", first_name="学生乙")
        self.client.set_token(other)
        self.assertEqual(self.client.get_json(f"/api/admin/qa/questions/{q.id}/history/").status_code, 403)


# ── 问答区举报（QaV183ReportTests）──

class QaV183ReportTests(QaV183BaseTestCase):
    def _report_question(self, user, qid, reasons=None):
        self.client.set_token(user)
        return self.client.post_json(f"/api/qa/questions/{qid}/report/",
                                     {"reasons": reasons or ["error"]})

    def test_question_report_created(self):
        r = self._report_question(self.user, self.q1.id, ["harassment", "error"])
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["data"]["reported"])
        rep = Report.objects.get(kind=Report.Kind.QUESTION, qa_question=self.q1)
        self.assertEqual(rep.qa_question_title, self.q1.title)
        self.assertEqual(rep.qa_question_pk, self.q1.id)
        self.assertEqual(rep.reasons, ["harassment", "error"])

    def test_answer_report_created(self):
        self.client.set_token(self.user)
        r = self.client.post_json(f"/api/qa/answers/{self.ans1.id}/report/", {"reasons": ["error"]})
        self.assertEqual(r.status_code, 200)
        rep = Report.objects.get(kind=Report.Kind.ANSWER, qa_answer=self.ans1)
        self.assertEqual(rep.qa_question_pk, self.q1.id)  # 冗余父问题
        self.assertEqual(rep.qa_question_title, self.q1.title)

    def test_cannot_report_own(self):
        q = self._create_question()  # 基类默认作者 = self.admin
        self.client.set_token(self.admin)
        r = self.client.post_json(f"/api/qa/questions/{q.id}/report/", {"reasons": ["error"]})
        self.assertEqual(r.status_code, 400)

    def test_duplicate_report_400(self):
        self._report_question(self.user, self.q1.id)
        r = self._report_question(self.user, self.q1.id)
        self.assertEqual(r.status_code, 400)

    def test_invalid_reason_400(self):
        r = self._report_question(self.user, self.q1.id, ["not_a_reason"])
        self.assertEqual(r.status_code, 400)

    def test_other_reason_requires_detail(self):
        self.client.set_token(self.user)
        r = self.client.post_json(f"/api/qa/questions/{self.q1.id}/report/", {"reasons": ["other"]})
        self.assertEqual(r.status_code, 400)
        r = self.client.post_json(f"/api/qa/questions/{self.q1.id}/report/",
                                  {"reasons": ["other"], "detail": "抄袭他人帖子"})
        self.assertEqual(r.status_code, 200)

    def test_anonymous_report_401(self):
        self.client.defaults.pop("HTTP_AUTHORIZATION", None)
        r = self.client.post_json(f"/api/qa/questions/{self.q1.id}/report/", {"reasons": ["error"]})
        self.assertEqual(r.status_code, 401)

    def test_report_quota_limit(self):
        from datetime import date
        prof = self.user.profile
        prof.daily_report_count = 15  # DAILY_REPORT_LIMIT
        prof.last_report_date = date.today()
        prof.save(update_fields=["daily_report_count", "last_report_date"])
        r = self._report_question(self.user, self.q1.id)
        self.assertEqual(r.status_code, 429)

    def test_report_status_endpoint(self):
        self._report_question(self.user, self.q1.id)
        self.client.set_token(self.user)
        st = self.client.get_json(f"/api/qa/questions/{self.q1.id}/report-status/")
        data = st.json()["data"]
        self.assertTrue(data["reported"])
        self.assertFalse(data["can_report"])

    def test_report_candidates_are_qa_moderators(self):
        self._report_question(self.user, self.q1.id)
        rep = Report.objects.get(kind=Report.Kind.QUESTION, qa_question=self.q1)
        cand_ids = set(rep.candidates.values_list("id", flat=True))
        self.assertIn(self.qa_mod.id, cand_ids)
        self.assertIn(self.admin.id, cand_ids)
        self.assertNotIn(self.user.id, cand_ids)

    def test_report_alert_notification(self):
        self._report_question(self.user, self.q1.id)
        self.assertTrue(Notification.objects.filter(
            recipient=self.qa_mod, type=Notification.Type.REPORT_ALERT).exists())
        self.assertTrue(Notification.objects.filter(
            recipient=self.admin, type=Notification.Type.REPORT_ALERT).exists())

    def test_pending_groups_include_qa(self):
        self._report_question(self.user, self.q1.id)
        self.client.set_token(self.qa_mod)
        r = self.client.get_json("/api/moderation/reports/pending/")
        qa_groups = r.json()["data"]["qa_groups"]
        self.assertEqual(len(qa_groups), 1)
        g = qa_groups[0]
        self.assertEqual(g["kind"], "question")
        self.assertEqual(g["target_id"], self.q1.id)
        self.assertEqual(g["target_title"], self.q1.title)
        self.assertIn("内容错误/误导", g["reason_labels"])

    def test_handle_true_deletes_and_notifies(self):
        self._report_question(self.user, self.q1.id)
        rep = Report.objects.get(kind=Report.Kind.QUESTION, qa_question=self.q1)
        self.client.set_token(self.qa_mod)
        r = self.client.post_json(f"/api/moderation/reports/{rep.id}/handle/",
                                  {"is_true": True})
        self.assertEqual(r.status_code, 200)
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.status, QaQuestion.Status.DELETED)
        rep.refresh_from_db()
        self.assertEqual(rep.status, Report.Status.HANDLED)
        self.assertEqual(rep.action, Report.Action.DELETE)
        # 举报人「举报已处理」+ 作者「被举报并删除」
        self.assertTrue(Notification.objects.filter(
            recipient=self.user, type=Notification.Type.REPORT_RESULT,
            title="举报已处理").exists())
        self.assertTrue(Notification.objects.filter(
            recipient=self.admin, type=Notification.Type.REPORT_RESULT,
            title="你的内容被举报并删除").exists())

    def test_handle_false_keeps_and_notifies(self):
        self._report_question(self.user, self.q1.id)
        rep = Report.objects.get(kind=Report.Kind.QUESTION, qa_question=self.q1)
        self.client.set_token(self.qa_mod)
        r = self.client.post_json(f"/api/moderation/reports/{rep.id}/handle/",
                                  {"is_true": False, "actual_situation": "未违规"})
        self.assertEqual(r.status_code, 200)
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.status, QaQuestion.Status.PUBLISHED)
        rep.refresh_from_db()
        self.assertEqual(rep.action, Report.Action.KEEP)
        self.assertTrue(Notification.objects.filter(
            recipient=self.user, type=Notification.Type.REPORT_RESULT).exists())

    def test_handle_false_requires_situation(self):
        self._report_question(self.user, self.q1.id)
        rep = Report.objects.get(kind=Report.Kind.QUESTION, qa_question=self.q1)
        self.client.set_token(self.qa_mod)
        r = self.client.post_json(f"/api/moderation/reports/{rep.id}/handle/",
                                  {"is_true": False})
        self.assertEqual(r.status_code, 400)

    def test_report_history_tracks_qa(self):
        self._report_question(self.user, self.q1.id)
        rep = Report.objects.get(kind=Report.Kind.QUESTION, qa_question=self.q1)
        self.client.set_token(self.qa_mod)
        self.client.post_json(f"/api/moderation/reports/{rep.id}/handle/", {"is_true": True})
        r = self.client.get_json("/api/moderation/reports/history/")
        rows = r.json()["data"]["items"]
        self.assertGreaterEqual(len(rows), 1)
        self.assertEqual(rows[0]["qa_question_title"], self.q1.title)
        self.assertEqual(rows[0]["kind"], "question")
