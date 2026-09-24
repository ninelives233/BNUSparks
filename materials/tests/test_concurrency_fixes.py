"""性能审查修复的并发/原子性回归（2026-09-20）

对应 docs/performance-review-2026-09-19.md 的 F01（课表 revision）、
F02（举报限额原子化）、F03（PDF 预览发布竞争）、F05（通知 count-only）。
把审查探针观察到的缺陷现象转换为正确行为断言。
"""

import threading
import tempfile
from datetime import date, timedelta
from io import BytesIO
from unittest import mock

from .helpers import BnuTestCase, create_user
from ..models import UserTimetable, UserProfile

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


class ReportQuotaAtomicTest(BnuTestCase):
    """F02：检查与递增合并为条件 UPDATE——14→15 边界、跨天重置、退款。"""

    def setUp(self):
        self.user = create_user("209911900101")
        from ..views.utils import _check_report_quota, _refund_report_quota
        self.check = _check_report_quota
        self.refund = _refund_report_quota

    def _count(self):
        return UserProfile.objects.get(user=self.user).daily_report_count

    def test_boundary_14_to_15(self):
        """两个请求都预读到旧计数 14 时，也只有 15 个请求能获准。"""
        profile = UserProfile.objects.get(user=self.user)
        profile.daily_report_count = 14
        profile.last_report_date = date.today()
        profile.save()
        allowed1, remaining1, _ = self.check(self.user)
        assert allowed1 is True
        assert self._count() == 15
        allowed2, remaining2, msg = self.check(self.user)
        assert allowed2 is False
        assert remaining2 == 0
        assert self._count() == 15, "被拒请求不得越过上限"

    def test_same_day_no_rezero_by_stale_snapshot(self):
        """同一天内的后续请求不得把已递增的计数按旧快照清零。"""
        self.check(self.user)
        assert self._count() == 1
        self.check(self.user)
        assert self._count() == 2, "第二次调用按旧逻辑会再次清零后记 1"

    def test_cross_day_reset(self):
        """跨零点：旧日期+超限计数在次日首笔请求重置后放行。"""
        profile = UserProfile.objects.get(user=self.user)
        profile.daily_report_count = 20
        profile.last_report_date = date.today() - timedelta(days=1)
        profile.save()
        allowed, remaining, _ = self.check(self.user)
        assert allowed is True
        assert self._count() == 1

    def test_over_limit_same_day_denied(self):
        profile = UserProfile.objects.get(user=self.user)
        profile.daily_report_count = 15
        profile.last_report_date = date.today()
        profile.save()
        allowed, remaining, msg = self.check(self.user)
        assert allowed is False

    def test_refund_floors_at_zero(self):
        assert self.check(self.user)[0] is True
        assert self._count() == 1
        self.refund(self.user)
        assert self._count() == 0
        self.refund(self.user)  # 空退不减成负数
        assert self._count() == 0

    def test_admin_exempt(self):
        admin = create_user("209911900102", role="super_admin")
        allowed, remaining, _ = self.check(admin)
        assert allowed is True
        assert remaining == -1


class TimetableRevisionTest(BnuTestCase):
    """F01：服务端 revision 条件更新 + 有界重试。"""

    def setUp(self):
        from .helpers import AuthClient
        self.user = create_user("209911900201")
        self.client = AuthClient()
        self.client.set_token(self.user)

    def test_revision_advances_on_accepted_writes(self):
        resp = self.client.put_json("/api/user/timetable/", {"data": DATA})
        assert resp.json()["data"]["accepted"] is True
        assert UserTimetable.objects.get(user=self.user).revision == 0
        older = dict(DATA, importedAt=DATA["importedAt"] + 1)
        resp = self.client.put_json("/api/user/timetable/", {"data": older})
        assert resp.json()["data"]["accepted"] is True
        assert UserTimetable.objects.get(user=self.user).revision == 1

    def test_stale_version_rejected_keeps_revision(self):
        self.client.put_json("/api/user/timetable/", {"data": DATA})
        newer = UserTimetable.objects.get(user=self.user)
        newer_data = newer.data
        stale = dict(DATA, importedAt=DATA["importedAt"] - 1000)
        resp = self.client.put_json("/api/user/timetable/", {"data": stale})
        body = resp.json()
        assert body["data"]["accepted"] is False
        assert body["data"]["data"] == newer_data, "拒绝时应回传云端现版本"
        row = UserTimetable.objects.get(user=self.user)
        assert row.revision == newer.revision, "被拒写入不得推进修订号"

    def test_operational_error_retries_then_succeeds(self):
        from django.db import OperationalError
        from ..views import user_timetable as vt
        payload = {"updated_at": "2026-09-20T00:00:00.000001", "accepted": True, "import_recorded": False}
        with mock.patch.object(vt, "_timetable_put_once", side_effect=[OperationalError("locked"), payload]), \
             mock.patch.object(vt.time, "sleep"):
            resp = self.client.put_json("/api/user/timetable/", {"data": DATA})
        assert resp.json()["data"]["accepted"] is True

    def test_persistent_operational_error_returns_503(self):
        from django.db import OperationalError
        from ..views import user_timetable as vt
        with mock.patch.object(vt, "_timetable_put_once", side_effect=OperationalError("locked")), \
             mock.patch.object(vt.time, "sleep"):
            resp = self.client.put_json("/api/user/timetable/", {"data": DATA})
        assert resp.status_code == 503

    def test_import_event_recorded_once_despite_retry(self):
        from django.db import OperationalError
        from ..views import user_timetable as vt
        from ..models import TimetableImportRecord
        payload = {"updated_at": "2026-09-20T00:00:00.000001", "accepted": True, "import_recorded": True}
        with mock.patch.object(vt, "_timetable_put_once", side_effect=[OperationalError("locked"), payload]), \
             mock.patch.object(vt.time, "sleep"):
            event = {"type": "import", "id": "tti-retry-1"}
            resp = self.client.put_json("/api/user/timetable/", {"data": DATA, "event": event})
        assert resp.json()["data"]["import_recorded"] is True
        assert TimetableImportRecord.objects.filter(user=self.user, event_id="tti-retry-1").count() == 1


class PdfPreviewPublishTest(BnuTestCase):
    """F03：唯一临时文件、锁下复查、无残留 .tmp、锁文件保留。"""

    def _publish(self, cache_path, content=b"pdf-bytes"):
        from ..views.files_download import _publish_pdf_preview
        return _publish_pdf_preview(cache_path, BytesIO(content))

    def test_publish_then_hit_no_rewrite_no_tmp(self):
        import os
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "preview.pdf"
            assert self._publish(cache_path, b"AAA") is True
            first = open(cache_path, "rb").read()
            mtime = os.stat(cache_path).st_mtime_ns
            assert self._publish(cache_path, b"BBB") is True, "已发布时第二请求应命中"
            assert open(cache_path, "rb").read() == first, "命中不得覆盖已发布文件"
            assert os.stat(cache_path).st_mtime_ns == mtime
            assert open(cache_path, "rb").read() == b"AAA"
            leftovers = [f for f in os.listdir(tmp) if f.endswith(".tmp")]
            assert leftovers == [], "发布后不得残留临时文件"
            assert any(f.endswith(".lock") for f in os.listdir(tmp)), "锁文件保留以维持互斥"

    def test_concurrent_publish_single_winner(self):
        import os
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "shared.pdf"
            results = []
            barrier = threading.Barrier(8)

            def worker(i):
                barrier.wait()
                results.append(self._publish(cache_path, f"W{i}".encode()))

            threads = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            assert results == [True] * 8
            body = open(cache_path, "rb").read()
            assert body.startswith(b"W"), "最终文件必须是某一次完整发布的内容"
            assert not [f for f in os.listdir(tmp) if f.endswith(".tmp")]


class NotificationCountOnlyTest(BnuTestCase):
    """F05：徽章轮询 count-only 分支 + /auth/me 附带权威未读数。"""

    def setUp(self):
        from .helpers import AuthClient
        self.user = create_user("209911900301")
        self.client = AuthClient()
        self.client.set_token(self.user)
        from ..models import Notification
        self.Notification = Notification

    def test_count_only_branch(self):
        self.Notification.objects.create(recipient=self.user, type="operation", title="t", message="m")
        self.Notification.objects.create(recipient=self.user, type="operation", title="t2", message="m2", is_read=True)
        resp = self.client.get("/api/auth/notifications/?count_only=1")
        body = resp.json()
        assert body["ok"] is True
        assert body["data"]["unread_count"] == 1
        assert body["data"]["list"] == []

    def test_me_includes_unread_count(self):
        resp = self.client.get("/api/auth/me/")
        body = resp.json()
        assert body["ok"] is True
        assert body["data"]["unread_count"] == 0
        self.Notification.objects.create(recipient=self.user, type="operation", title="t", message="m")
        resp = self.client.get("/api/auth/me/")
        assert resp.json()["data"]["unread_count"] == 1
