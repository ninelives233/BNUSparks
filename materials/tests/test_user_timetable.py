"""我的课表同步 API：读写、覆盖、按用户隔离、格式校验、CSRF 豁免"""

import json
from urllib.parse import quote

from .helpers import AuthClient, BnuTestCase, _make_jwt, create_user
from ..models import TimetableImportRecord, UserTimetable


DATA = {
    "meta": {"semester": "2026-2027学年秋季学期", "studentName": "张三"},
    "courses": [
        {"code": "MAT02008", "name": "线性代数",
         "meetings": [{"ws": 1, "we": 16, "parity": 0, "day": 1, "ps": 3, "pe": 4, "room": "二208"}]},
    ],
    "pendingCodes": {},
    "start": "2026-09-07",
    "importedAt": 1700000000000,
}


class UserTimetableSyncTest(BnuTestCase):
    def setUp(self):
        self.user = create_user("209911900001")
        self.client = AuthClient()
        self.client.set_token(self.user)

    def test_get_empty(self):
        resp = self.client.get_json("/api/user/timetable/")


        assert resp.json()["ok"] is True
        assert resp.json()["data"]["data"] is None

    def test_put_then_get_roundtrip(self):
        resp = self.client.put_json("/api/user/timetable/", {"data": DATA})
        assert resp.json()["ok"] is True
        assert UserTimetable.objects.filter(user=self.user).count() == 1

        resp = self.client.get_json("/api/user/timetable/")
        body = resp.json()
        assert body["data"]["data"]["courses"][0]["code"] == "MAT02008"
        assert body["data"]["updated_at"] is not None

    def test_put_overwrites(self):
        self.client.put_json("/api/user/timetable/", {"data": DATA})
        changed = dict(DATA, courses=[])
        self.client.put_json("/api/user/timetable/", {"data": changed})
        assert UserTimetable.objects.get(user=self.user).data["courses"] == []

    def test_slots_envelope_roundtrip(self):
        """切换课表信封（活动表平铺 + slots/activeId）原样存取，后端不感知结构。
        切换课表功能依赖此契约：blob 内多出的 slots/activeId 字段不得被剥离或拒绝。"""
        envelope = dict(
            DATA,
            slots=[{
                "id": "ttsabc",
                "name": "2026-2027学年秋季学期",
                "savedAt": 1700000000000,
                "data": {"meta": DATA["meta"], "courses": DATA["courses"],
                         "pendingCodes": {}, "start": "2026-09-07", "importedAt": 1700000000000},
            }],
            activeId="ttsabc",
        )
        resp = self.client.put_json("/api/user/timetable/", {"data": envelope})
        assert resp.json()["ok"] is True
        got = UserTimetable.objects.get(user=self.user).data
        assert got["activeId"] == "ttsabc"
        assert got["slots"][0]["id"] == "ttsabc"
        assert got["slots"][0]["data"]["courses"][0]["code"] == "MAT02008"
        # 版本比较仍以顶层 importedAt 为准（切换课表靠 bump 它防云端回滚）
        assert got["importedAt"] == envelope["importedAt"]

    def test_import_event_is_recorded_idempotently(self):
        event = {"type": "import", "id": "tti-test-1"}
        self.client.put_json("/api/user/timetable/", {"data": DATA, "event": event})
        self.client.put_json("/api/user/timetable/", {"data": DATA, "event": event})
        record = TimetableImportRecord.objects.get(user=self.user, event_id="tti-test-1")
        assert record.course_count == 1
        assert TimetableImportRecord.objects.filter(user=self.user).count() == 1

    def test_get_since_returns_unchanged_without_payload(self):
        self.client.put_json("/api/user/timetable/", {"data": DATA})
        first = self.client.get_json("/api/user/timetable/").json()
        since = first["data"]["updated_at"]

        second = self.client.get_json(f"/api/user/timetable/?since={quote(since, safe='')}").json()
        assert second["ok"] is True
        assert second["data"]["unchanged"] is True
        assert second["data"]["data"] is None

    def test_older_upload_cannot_overwrite_newer_timetable(self):
        self.client.put_json("/api/user/timetable/", {"data": DATA})
        older = dict(DATA, courses=[], importedAt=DATA["importedAt"] - 1)
        response = self.client.put_json("/api/user/timetable/", {"data": older}).json()

        assert response["ok"] is True
        assert response["data"]["accepted"] is False
        assert UserTimetable.objects.get(user=self.user).data["courses"] == DATA["courses"]

    def test_rejects_bad_payload(self):
        resp = self.client.put_json("/api/user/timetable/", {"data": {"nope": 1}})
        assert resp.json()["ok"] is False
        resp = self.client.put_json("/api/user/timetable/", {})
        assert resp.json()["ok"] is False
        assert not UserTimetable.objects.filter(user=self.user).exists()

    def test_isolated_between_users(self):
        other = create_user("209911900002")
        other_client = AuthClient()
        other_client.set_token(other)
        self.client.put_json("/api/user/timetable/", {"data": DATA})
        resp = other_client.get_json("/api/user/timetable/")
        assert resp.json()["data"]["data"] is None

    def test_requires_login(self):
        anon = AuthClient()
        resp = anon.get_json("/api/user/timetable/")
        assert resp.status_code in (401, 403)

    def test_delete(self):
        self.client.put_json("/api/user/timetable/", {"data": DATA})
        resp = self.client.delete_json("/api/user/timetable/")
        assert resp.json()["ok"] is True
        assert not UserTimetable.objects.filter(user=self.user).exists()

    def test_put_view_is_csrf_exempt(self):
        # 回归护栏：视图必须 @csrf_exempt（JWT 认证无 cookie）。
        # 漏掉时 CsrfViewMiddleware 会让浏览器 PUT 吃 403，课表永远无法上传。
        # enforce_csrf_checks=True 会启用真实 CSRF 中间件链路。
        from django.test import Client

        strict = Client(enforce_csrf_checks=True)
        resp = strict.put(
            "/api/user/timetable/", data=json.dumps({"data": DATA}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {_make_jwt(self.user.id)}",
        )
        assert resp.status_code == 200, resp.content[:200]
        assert resp.json()["ok"] is True
