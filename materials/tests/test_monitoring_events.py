import json
from datetime import timedelta

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from .helpers import AuthClient, create_user
from ..models import MonitoringAggregate, MonitoringEvent, UserProfile
from ..monitoring_events import anonymous_actor_hash


class MonitoringEventsTest(TestCase):
    def setUp(self):
        self.client = AuthClient()
        self.user = create_user("event_student", role=UserProfile.Role.USER)
        self.admin = create_user("event_admin", role=UserProfile.Role.SUPER_ADMIN)

    def _batch(self, events, *, user=None, visitor="visitor-day-a"):
        self.client.defaults.clear()
        if user is not None:
            self.client.set_token(user)
        return self.client.post(
            "/api/monitoring/events/",
            data=json.dumps({"events": events}),
            content_type="application/json",
            HTTP_X_BNU_VISITOR=visitor,
        )

    def test_anonymous_batch_hashes_and_retry_is_idempotent(self):
        events = [
            {"id": "anon-view-1", "name": "view.open", "view_name": "unknown-view", "anonymous_id": "raw-anon-token"},
            {"id": "anon-search-1", "name": "search.execute", "anonymous_id": "raw-anon-token", "query": "不应落库"},
        ]
        first = self._batch(events)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["data"]["accepted"], 2)
        self.assertEqual(MonitoringEvent.objects.count(), 2)
        row = MonitoringEvent.objects.get(event_id="anon-view-1")
        self.assertEqual(row.audience, MonitoringEvent.Audience.ANONYMOUS)
        self.assertEqual(row.view_name, "other")
        self.assertNotEqual(row.actor_hash, "raw-anon-token")
        self.assertEqual(len(row.actor_hash), 64)
        self.assertFalse(hasattr(row, "query"))

        retry = self._batch(events)
        self.assertEqual(retry.json()["data"]["accepted"], 0)
        self.assertEqual(MonitoringEvent.objects.count(), 2)

    def test_same_user_is_one_dau_but_event_count_is_preserved(self):
        now = timezone.now().isoformat()
        response = self._batch([
            {"id": "user-view-1", "name": "view.open", "view_name": "home", "occurred_at": now},
            {"id": "user-view-2", "name": "view.open", "view_name": "explorer", "occurred_at": now},
            {"id": "user-search-1", "name": "search.execute", "occurred_at": now},
        ], user=self.user)
        self.assertEqual(response.status_code, 200)
        self.client.set_token(self.admin)
        data = self.client.get("/api/admin/monitoring/?section=events&period=day").json()["data"]
        self.assertEqual(data["selected"]["logged_in"], 1)
        self.assertEqual(data["selected"]["anonymous"], 0)
        self.assertEqual(data["selected"]["all"], 1)
        self.assertEqual(data["selected"]["event_count"], 3)
        self.assertEqual(sum(item["count"] for item in data["composition"]), 3)

    def test_daily_anonymous_digest_rotates(self):
        first = anonymous_actor_hash("same-browser", timezone.now().date())
        second = anonymous_actor_hash("same-browser", timezone.now().date() + timedelta(days=1))
        self.assertNotEqual(first, second)
        self.assertEqual(len(first), 64)

    def test_event_batch_does_not_require_login_but_dashboard_does(self):
        response = self._batch([{"id": "public-view-1", "name": "view.open", "view_name": "home"}])
        self.assertEqual(response.status_code, 200)
        denied = self.client.get("/api/admin/monitoring/?section=events&period=day")
        self.assertEqual(denied.status_code, 401)
        self.client.set_token(self.user)
        forbidden = self.client.get("/api/admin/monitoring/?section=events&period=day")
        self.assertEqual(forbidden.status_code, 403)

    def test_event_endpoint_caps_batch_size(self):
        events = [{"id": f"too-many-{i}", "name": "view.open", "view_name": "home"} for i in range(51)]
        response = self._batch(events)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(MonitoringEvent.objects.count(), 0)

    def test_login_success_and_failure_events_do_not_store_account_value(self):
        self.client.defaults.clear()
        success = self.client.post(
            "/api/auth/login/",
            data=json.dumps({"username": self.user.username, "password": "testpass123"}),
            content_type="application/json",
            HTTP_X_BNU_VISITOR="login-browser-day",
        )
        self.assertEqual(success.status_code, 200)
        self.assertTrue(MonitoringEvent.objects.filter(event_name=MonitoringEvent.EventName.LOGIN_SUCCESS, user=self.user).exists())

        self.client.defaults.clear()
        failure = self.client.post(
            "/api/auth/login/",
            data=json.dumps({"username": self.user.username, "password": "wrong-password"}),
            content_type="application/json",
            HTTP_X_BNU_VISITOR="login-browser-day",
        )
        self.assertEqual(failure.status_code, 400)
        row = MonitoringEvent.objects.get(event_name=MonitoringEvent.EventName.LOGIN_FAILURE)
        self.assertIsNone(row.user_id)
        self.assertNotIn(self.user.username, row.actor_hash)

    def test_upload_validation_failure_is_recorded_without_file_metadata(self):
        self.client.defaults.clear()
        self.client.set_token(self.user)
        response = self.client.post(
            "/api/files/upload/",
            {"course_code": "MISSING"},
            HTTP_X_BNU_VISITOR="logged-browser-day",
        )
        self.assertEqual(response.status_code, 400)
        self.assertTrue(MonitoringEvent.objects.filter(
            event_name=MonitoringEvent.EventName.UPLOAD_FAILURE,
            user=self.user,
        ).exists())

    def test_cleanup_command_moves_old_events_to_long_term_aggregates(self):
        old = timezone.now() - timedelta(days=31)
        old_day = old.date()
        MonitoringEvent.objects.create(
            event_id="old-event-1", event_name=MonitoringEvent.EventName.VIEW_OPEN,
            audience=MonitoringEvent.Audience.USER, user=self.user, day=old_day,
            occurred_at=old, view_name="home",
        )
        call_command("aggregate_monitoring_events", retention_days=30)
        self.assertFalse(MonitoringEvent.objects.filter(event_id="old-event-1").exists())
        self.assertTrue(MonitoringAggregate.objects.filter(
            granularity=MonitoringAggregate.Granularity.DAY,
            event_name=MonitoringEvent.EventName.VIEW_OPEN,
        ).exists())

    def test_long_term_daily_dau_does_not_sum_same_user_per_event(self):
        old = timezone.now() - timedelta(days=31)
        for suffix, name in (("view", MonitoringEvent.EventName.VIEW_OPEN), ("search", MonitoringEvent.EventName.SEARCH_EXECUTE)):
            MonitoringEvent.objects.create(
                event_id=f"old-{suffix}", event_name=name,
                audience=MonitoringEvent.Audience.USER, user=self.user,
                day=old.date(), occurred_at=old, view_name="home" if suffix == "view" else "",
            )
        call_command("aggregate_monitoring_events", retention_days=30, verbosity=0)
        self.client.set_token(self.admin)
        payload = self.client.get("/api/admin/monitoring/?section=events&period=all").json()["data"]
        self.assertEqual(payload["daily"][0]["logged_in"], 1)
        self.assertEqual(payload["daily"][0]["event_count"], 2)
