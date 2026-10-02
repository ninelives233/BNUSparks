"""使用教程 API、迁移回填与前后端分镜白名单一致性测试。"""

import importlib
import re
from pathlib import Path

from django.contrib.auth.models import User
from django.db import connection
from django.utils import timezone

from .helpers import BnuTestCase, create_user
from ..models import UserTutorialState, UserTutorialLesson
from ..views.tutorial import (
    CORE_LESSON_IDS, GROUP_ORDER, LESSON_GROUPS, LESSON_REVISIONS,
)

TUTORIAL_URL = "/api/auth/tutorial/"

# 前端分镜数据（只读，不修改）；后端白名单必须与它保持一致。
TUTORIAL_DATA_PATH = (
    Path(__file__).resolve().parents[2] / "public" / "js" / "tutorial-data.js"
)

MIGRATION_0059 = "materials.migrations.0059_user_tutorial_models"


def _mark(client, lesson_id, revision=1):
    return client.post_json(TUTORIAL_URL, {
        "action": "mark_seen", "lesson_id": lesson_id, "revision": revision,
    })


class TutorialApiTest(BnuTestCase):
    """GET / POST api_tutorial 的行为与并发语义（SQLite 上用连续请求建模竞态）。"""

    def test_get_creates_pending_once_and_idempotent(self):
        self.client.set_token(self.user)
        resp = self.client.get_json(TUTORIAL_URL)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()["data"]
        self.assertEqual(data["offer_state"], "pending")
        self.assertTrue(data["eligible"])
        self.assertEqual(data["seen"], [])
        self.assertEqual(UserTutorialState.objects.filter(user=self.user).count(), 1)

        # 再次 GET 幂等：不重复建行，状态不变
        resp = self.client.get_json(TUTORIAL_URL)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["data"]["offer_state"], "pending")
        self.assertEqual(UserTutorialState.objects.filter(user=self.user).count(), 1)

    def test_admin_read_not_eligible_and_cannot_claim(self):
        self.client.set_token(self.admin)
        data = self.client.get_json(TUTORIAL_URL).json()["data"]
        self.assertFalse(data["eligible"])

        resp = self.client.post_json(TUTORIAL_URL, {"action": "claim_offer"})
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()["data"]["claimed"])
        state = UserTutorialState.objects.get(user=self.admin)
        self.assertEqual(state.offer_state, "pending")
        self.assertIsNone(state.offered_at)

    def test_sub_moderator_not_eligible(self):
        self.client.set_token(self.sub_mod)
        data = self.client.get_json(TUTORIAL_URL).json()["data"]
        self.assertFalse(data["eligible"])

    def test_anonymous_get_and_post_401(self):
        resp = self.client.get_json(TUTORIAL_URL)
        self.assertEqual(resp.status_code, 401)
        self.assertFalse(resp.json()["ok"])
        resp = self.client.post_json(TUTORIAL_URL, {"action": "claim_offer"})
        self.assertEqual(resp.status_code, 401)
        # 匿名请求绝不污染会话数据
        self.assertEqual(UserTutorialState.objects.count(), 0)
        self.assertEqual(UserTutorialLesson.objects.count(), 0)

    def test_claim_twice_only_first_succeeds(self):
        """两个标签页先后 claim（建模并发竞态）：至多一个成功。"""
        self.client.set_token(self.user)
        resp = self.client.post_json(TUTORIAL_URL, {"action": "claim_offer"})
        self.assertTrue(resp.json()["data"]["claimed"])
        state = UserTutorialState.objects.get(user=self.user)
        self.assertEqual(state.offer_state, "offered")
        self.assertIsNotNone(state.offered_at)

        resp = self.client.post_json(TUTORIAL_URL, {"action": "claim_offer"})
        self.assertFalse(resp.json()["data"]["claimed"])
        state.refresh_from_db()
        self.assertEqual(state.offer_state, "offered")

    def test_claim_after_dismiss_fails(self):
        self.client.set_token(self.user)
        self.client.post_json(TUTORIAL_URL, {"action": "claim_offer"})
        self.client.post_json(TUTORIAL_URL, {"action": "dismiss_offer"})
        resp = self.client.post_json(TUTORIAL_URL, {"action": "claim_offer"})
        self.assertFalse(resp.json()["data"]["claimed"])
        state = UserTutorialState.objects.get(user=self.user)
        self.assertEqual(state.offer_state, "dismissed")

    def test_dismiss_from_pending_and_idempotent(self):
        UserTutorialState.objects.create(user=self.user)  # 默认 pending
        self.client.set_token(self.user)
        resp = self.client.post_json(TUTORIAL_URL, {"action": "dismiss_offer"})
        self.assertTrue(resp.json()["data"]["dismissed"])
        state = UserTutorialState.objects.get(user=self.user)
        self.assertEqual(state.offer_state, "dismissed")
        dismissed_at = state.dismissed_at

        # 重复 dismiss 幂等：状态不变，dismissed_at 不再更新
        resp = self.client.post_json(TUTORIAL_URL, {"action": "dismiss_offer"})
        self.assertTrue(resp.json()["data"]["dismissed"])
        state.refresh_from_db()
        self.assertEqual(state.offer_state, "dismissed")
        self.assertEqual(state.dismissed_at, dismissed_at)

    def test_dismiss_does_not_downgrade_completed_or_exempt(self):
        UserTutorialState.objects.create(
            user=self.user,
            offer_state=UserTutorialState.OfferState.COMPLETED,
            completed_at=timezone.now(),
        )
        self.client.set_token(self.user)
        self.client.post_json(TUTORIAL_URL, {"action": "dismiss_offer"})
        state = UserTutorialState.objects.get(user=self.user)
        self.assertEqual(state.offer_state, "completed")

        UserTutorialState.objects.create(
            user=self.sub_mod, offer_state=UserTutorialState.OfferState.EXEMPT,
        )
        self.client.set_token(self.sub_mod)
        self.client.post_json(TUTORIAL_URL, {"action": "dismiss_offer"})
        state = UserTutorialState.objects.get(user=self.sub_mod)
        self.assertEqual(state.offer_state, "exempt")

    def test_mark_seen_writes_and_returns_authoritative_seen(self):
        self.client.set_token(self.user)
        resp = _mark(self.client, "find-search")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.json()["data"]["seen"],
            [{"lesson_id": "find-search", "revision": 1}],
        )
        self.assertEqual(
            UserTutorialLesson.objects.filter(user=self.user).count(), 1,
        )

        # 重复标记：唯一约束幂等，仍只有一行
        resp = _mark(self.client, "find-search")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            UserTutorialLesson.objects.filter(user=self.user).count(), 1,
        )
        self.assertEqual(len(resp.json()["data"]["seen"]), 1)

        # 两个不同分镜先后标记都保留
        _mark(self.client, "qa-accept")
        rows = UserTutorialLesson.objects.filter(user=self.user)
        self.assertEqual(rows.count(), 2)
        self.assertEqual(
            {(r.lesson_id, r.revision) for r in rows},
            {("find-search", 1), ("qa-accept", 1)},
        )

    def test_mark_seen_rejects_invalid_input(self):
        self.client.set_token(self.user)
        bad_bodies = [
            {},  # 缺 action
            {"action": "unknown_action"},  # 未知 action
            {"action": "mark_seen", "revision": 1},  # 缺 lesson_id
            {"action": "mark_seen", "lesson_id": "not-a-lesson", "revision": 1},
            {"action": "mark_seen", "lesson_id": "find-search"},  # 缺 revision
            {"action": "mark_seen", "lesson_id": "find-search", "revision": 0},
            {"action": "mark_seen", "lesson_id": "find-search", "revision": 2},
            {"action": "mark_seen", "lesson_id": "find-search", "revision": "1"},
            {"action": "mark_seen", "lesson_id": "find-search", "revision": True},
        ]
        for body in bad_bodies:
            resp = self.client.post_json(TUTORIAL_URL, body)
            self.assertEqual(resp.status_code, 400, f"应 400：{body}")
        self.assertEqual(UserTutorialLesson.objects.count(), 0)

    def test_unsupported_methods_405(self):
        self.client.set_token(self.user)
        self.assertEqual(self.client.put_json(TUTORIAL_URL, {}).status_code, 405)
        self.assertEqual(self.client.delete_json(TUTORIAL_URL, {}).status_code, 405)

    def test_core_completion_marks_completed(self):
        self.client.set_token(self.user)
        for lesson_id in CORE_LESSON_IDS:
            resp = _mark(self.client, lesson_id)
            self.assertEqual(resp.status_code, 200)
        state = UserTutorialState.objects.get(user=self.user)
        self.assertEqual(state.offer_state, "completed")
        self.assertIsNotNone(state.completed_at)

    def test_partial_core_does_not_complete(self):
        self.client.set_token(self.user)
        self.client.get_json(TUTORIAL_URL)  # 建 pending 行
        for lesson_id in ("find-search", "courses-import"):
            _mark(self.client, lesson_id)
        state = UserTutorialState.objects.get(user=self.user)
        self.assertEqual(state.offer_state, "pending")

    def test_replay_and_wrong_revision_do_not_fake_completion(self):
        self.client.set_token(self.user)
        self.client.get_json(TUTORIAL_URL)
        for lesson_id in ("find-search", "courses-import", "save-course"):
            self.assertEqual(_mark(self.client, lesson_id).status_code, 200)

        # 用非当前版本（revision=2）冒充新版进度 → 400，不计入完成
        resp = _mark(self.client, "share-text", revision=2)
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(
            UserTutorialLesson.objects.filter(
                user=self.user, lesson_id="share-text",
            ).exists()
        )
        state = UserTutorialState.objects.get(user=self.user)
        self.assertEqual(state.offer_state, "pending")

        # 重播（重复标记已看的核心分镜）不伪造完成
        self.assertEqual(_mark(self.client, "find-search").status_code, 200)
        state.refresh_from_db()
        self.assertEqual(state.offer_state, "pending")

    def test_completion_advances_dismissed_but_not_exempt(self):
        UserTutorialState.objects.create(
            user=self.user,
            offer_state=UserTutorialState.OfferState.DISMISSED,
            dismissed_at=timezone.now(),
        )
        self.client.set_token(self.user)
        for lesson_id in CORE_LESSON_IDS:
            _mark(self.client, lesson_id)
        state = UserTutorialState.objects.get(user=self.user)
        self.assertEqual(state.offer_state, "completed")

        UserTutorialState.objects.create(
            user=self.sub_mod, offer_state=UserTutorialState.OfferState.EXEMPT,
        )
        self.client.set_token(self.sub_mod)
        for lesson_id in CORE_LESSON_IDS:
            _mark(self.client, lesson_id)
        state = UserTutorialState.objects.get(user=self.sub_mod)
        self.assertEqual(state.offer_state, "exempt")


class TutorialBackfillTest(BnuTestCase):
    """迁移 0059 的存量用户 exempt 回填（经历史 apps 执行）。"""

    _historical_apps = None

    @classmethod
    def _historical_apps_registry(cls):
        if cls._historical_apps is None:
            from django.db.migrations.loader import MigrationLoader
            from django.db.migrations.state import ProjectState
            loader = MigrationLoader(connection)
            state = loader.project_state([("materials", "0059_user_tutorial_models")])
            cls._historical_apps = state.apps
        return cls._historical_apps

    def _run_backfill(self):
        migration = importlib.import_module(MIGRATION_0059)
        migration.backfill_existing_users_exempt(
            self._historical_apps_registry(), None,
        )

    def test_backfill_marks_existing_users_exempt_idempotent(self):
        # 无 profile 的裸账号（历史存量账号的可能形态）
        bare = User.objects.create_user(
            username="209990000001", email="bare@mail.bnu.edu.cn", password="x",
        )
        # 已有 pending 状态的账号应保留原状态
        kept = create_user("209990000002", role="user")
        UserTutorialState.objects.create(user=kept)

        self._run_backfill()

        self.assertEqual(
            UserTutorialState.objects.get(user=bare).offer_state, "exempt",
        )
        self.assertEqual(
            UserTutorialState.objects.get(user=kept).offer_state, "pending",
        )
        # setUp 里的 4 个用户（均无状态行）也被回填
        for user in (self.user, self.sub_mod, self.mod, self.admin):
            self.assertEqual(
                UserTutorialState.objects.get(user=user).offer_state, "exempt",
            )

        # 幂等：重复执行不出错、不新增行
        before = UserTutorialState.objects.count()
        self._run_backfill()
        self.assertEqual(UserTutorialState.objects.count(), before)


class TutorialFrontendContractTest(BnuTestCase):
    """后端分镜白名单与 public/js/tutorial-data.js 的一致性守门。"""

    def test_backend_whitelist_internal_consistency(self):
        union = {lid for ids in LESSON_GROUPS.values() for lid in ids}
        self.assertEqual(set(LESSON_REVISIONS), union)
        self.assertEqual(GROUP_ORDER, tuple(LESSON_GROUPS))
        self.assertTrue(set(CORE_LESSON_IDS) <= set(LESSON_REVISIONS))
        self.assertEqual(len(CORE_LESSON_IDS), 4)

    def test_matches_frontend_tutorial_data(self):
        self.assertTrue(
            TUTORIAL_DATA_PATH.exists(),
            f"前端分镜数据文件缺失：{TUTORIAL_DATA_PATH}——"
            "后端白名单需与 public/js/tutorial-data.js 保持一致，请确认文件位置",
        )
        text = TUTORIAL_DATA_PATH.read_text(encoding="utf-8")

        # 分镜条目形如：id: 'find-search', groupId: 'find', revision: 1,
        lessons = re.findall(
            r"id:\s*'([a-z0-9-]+)',\s*groupId:\s*'([a-z0-9-]+)',\s*revision:\s*(\d+)",
            text,
        )
        front_ids = [lid for lid, _gid, _rev in lessons]
        self.assertEqual(len(front_ids), 25, "前端分镜应为 25 个")
        self.assertEqual(len(front_ids), len(set(front_ids)), "前端分镜 ID 有重复")

        # 后端白名单与前端 ID 集合、revision 一一对应
        front_revisions = {lid: int(rev) for lid, _gid, rev in lessons}
        self.assertEqual(front_revisions, LESSON_REVISIONS)

        # GROUP_LESSONS 分组成员与顺序一致
        block = re.search(r"var GROUP_LESSONS = \{(.*?)\};", text, re.S)
        self.assertTrue(block, "无法解析前端 GROUP_LESSONS")
        front_groups = {
            gid: re.findall(r"'([a-z0-9-]+)'", body)
            for gid, body in re.findall(r"(\w+): \[([^\]]*)\]", block.group(1))
        }
        self.assertEqual(
            list(front_groups), list(GROUP_ORDER),
            "前端 GROUP_LESSONS 组顺序应与后端一致",
        )
        for gid in GROUP_ORDER:
            self.assertEqual(front_groups[gid], list(LESSON_GROUPS[gid]))
        # 前端分组成员并集 == 正式分镜集合
        self.assertEqual(
            {lid for ids in front_groups.values() for lid in ids},
            set(front_ids),
        )

        # GROUPS 组顺序（find/courses/save/share/qa）
        groups_block = re.search(r"var GROUPS = \[(.*?)\];", text, re.S)
        self.assertTrue(groups_block, "无法解析前端 GROUPS")
        front_group_order = re.findall(r"id:\s*'(\w+)'", groups_block.group(1))
        self.assertEqual(front_group_order, list(GROUP_ORDER))

        # CORE_IDS：与后端一致，且都属于正式分镜集合
        core_block = re.search(r"var CORE_IDS = \[([^\]]*)\]", text)
        self.assertTrue(core_block, "无法解析前端 CORE_IDS")
        front_core = re.findall(r"'([a-z0-9-]+)'", core_block.group(1))
        self.assertEqual(len(front_core), len(set(front_core)), "前端核心 ID 有重复")
        self.assertEqual(set(front_core), set(CORE_LESSON_IDS))
        self.assertTrue(set(front_core) <= set(front_ids))

    def test_backfill_function_signature_and_reverse(self):
        """回填函数保持 RunPython 约定签名，且迁移声明了反向（noop）。"""
        migration = importlib.import_module(MIGRATION_0059)
        import inspect
        signature = inspect.signature(migration.backfill_existing_users_exempt)
        self.assertEqual(
            list(signature.parameters), ["apps", "schema_editor"],
        )
        self.assertIs(migration.Migration.operations[-1].reversible, True)
