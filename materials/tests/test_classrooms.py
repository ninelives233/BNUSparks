"""Authenticated public classroom adapter: exact scope, shared caching and worker locking."""
import datetime as dt
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings

from materials.services import classrooms as source
from .helpers import AuthClient, create_user

TERM = {'xn': 2026, 'xq_m': '0', 'name': '秋季学期', 'label': '2026–2027 秋季学期'}
MEM_CACHE = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
                         'LOCATION': 'classroom-unit-tests'}}


def report(rows=(), count=None):
    return ('<div>2026-2027学年秋季学期 (第7周 星期1 第01节) 校区：本部 '
            f'空闲教室数：{len(rows) if count is None else count}</div>'
            '<table><tr><td>序号<td>教学楼<td>教室<td>教室类型<td>容量'
            + ''.join(f'<tr><td>{i}<td>{b}<td>{r}<td>多媒体教室<td>{c}'
                      for i, (b, r, c) in enumerate(rows, 1)) + '</table>').encode('gbk')


@override_settings(CACHES=MEM_CACHE)
class ClassroomSourceTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_public_report_checks_scope_and_preserves_building_identity(self):
        q = {'term': TERM, 'week': 7, 'day': 1, 'periods': [1]}
        rows = source.parse_report(report([('楼甲', '101', '50'), ('楼乙', '101', '80')]), q)
        self.assertEqual([r[:2] for r in rows], [['楼甲', '101'], ['楼乙', '101']])
        with self.assertRaises(source.SourceError):
            source.parse_report(report(), {**q, 'periods': [2]})
        with self.assertRaises(source.SourceError):
            source.parse_report(report().replace('本部'.encode('gbk'), '其他'.encode('gbk')), q)

    def test_invalid_or_partial_reports_are_errors_not_empty_rooms(self):
        q = {'term': TERM, 'week': 7, 'day': 1, 'periods': [1]}
        samples = [b'<html></html>', '请重新登录'.encode('gbk'),
                   report([('楼甲', '101', '50')], 2),
                   report([('楼甲', '101', '50'), ('楼甲', '101', '50')]),
                   report([('楼甲', '101', '不详')])]
        for body in samples:
            with self.subTest(body=body[:30]), self.assertRaises(source.SourceError):
                source.parse_report(body, q)
        self.assertEqual(source.parse_report(report(), q), [])

    def test_exact_disjoint_periods_never_expand_to_a_contiguous_window(self):
        self.assertEqual(source.normalize_periods(2, 3, [5, 2, 9]), [2, 5, 9])
        for args in [(1, 13, None), (12, 2, None), (2, 3, [2, 2, 5]), (2, 2, [2, 5, 9])]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                source.normalize_periods(*args)

    def test_cached_queries_are_shared_and_skip_upstream_lock(self):
        today = dt.datetime.now(source.TZ).date()
        payload = {'count': 0, 'rooms': [], 'cache_hit': False}
        source.CACHE[(today.isoformat(), (1, 3))] = (time.monotonic(), payload)
        another_worker_cache = source.SharedCache('query', source.CACHE_SECONDS)
        self.assertIsNotNone(another_worker_cache.get((today.isoformat(), (1, 3))))
        with patch.object(source, 'source_lock', side_effect=AssertionError('cache hit acquired lock')):
            self.assertTrue(source.lookup('query', date=today, period=1, duration=2, periods=[1, 3])['cache_hit'])
            with self.assertRaises(ValueError):
                source.lookup('query', date=today, period=1, duration=3, periods=[1, 3])
            with self.assertRaises(ValueError):
                source.lookup('query', date=today + dt.timedelta(days=121))

    def test_refreshes_started_before_the_same_result_are_coalesced(self):
        date = dt.datetime.now(source.TZ).date()
        now = time.monotonic()
        source.CACHE[(date.isoformat(), (1,))] = (now, {'rooms': [], 'count': 0})
        self.assertIsNone(source.cached_query(date, [1], force=True, started=now + 1))
        self.assertTrue(source.cached_query(date, [1], force=True, started=now - 1)['cache_hit'])

    def test_query_posts_exact_fields_and_failed_results_are_not_cached(self):
        date = dt.datetime.now(source.TZ).date()
        with patch.object(source, 'resolve_date', return_value=(TERM, 7, date.isoweekday())), \
                patch.object(source, 'request_source', return_value=b'report') as request, \
                patch.object(source, 'parse_report', return_value=[]) as parse:
            source.query_rooms(date, 2, 2, periods=[2, 9])
            fields = request.call_args.args[1]
            self.assertIn(('hidjcs', '02,09'), fields)
            self.assertEqual([v for k, v in fields if k == 'chkjc'], ['02', '09'])
            self.assertEqual(parse.call_args.args[1]['periods'], [2, 9])
        with patch.object(source, 'resolve_date', return_value=(TERM, 7, 1)), \
                patch.object(source, 'request_source', side_effect=source.SourceError('offline')):
            with self.assertRaises(source.SourceError):
                source.query_rooms(date, 4, 1)
        self.assertIsNone(source.CACHE.get((date.isoformat(), (4,))))

    def test_source_calls_require_the_global_lock(self):
        with self.assertRaises(RuntimeError):
            source.request_source('/public/example', {})

    def test_invalid_term_response_is_an_upstream_error(self):
        for body in [b'[]', b'null', b'{}', b'<html></html>']:
            with self.subTest(body=body), patch.object(source, 'request_source', return_value=body):
                with self.assertRaises(source.SourceError):
                    source.current_term()

    def test_upstream_spacing_and_fixed_host_do_not_forward_site_authentication(self):
        with tempfile.TemporaryDirectory() as folder, override_settings(CLASSROOM_LOCK_DIR=folder), \
                source.source_lock(), patch.object(source.urllib.request, 'build_opener') as build, \
                patch.object(source.time, 'monotonic', return_value=100), patch.object(source.time, 'sleep') as sleep:
            response = build.return_value.open.return_value.__enter__.return_value
            response.status = 200
            response.read.return_value = b'ok'
            source.request_source('/public/example', {'x': '1'})
            source.request_source('/public/example', {'x': '2'})
            sleep.assert_called_once_with(1.0)
            request = build.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, source.UPSTREAM + '/public/example')
            self.assertEqual(request.data, b'x=2')
            self.assertFalse(request.has_header('Authorization'))
            self.assertFalse(request.has_header('Cookie'))

    def test_lock_excludes_a_separate_python_worker_and_releases_on_exit(self):
        with tempfile.TemporaryDirectory() as folder, override_settings(CLASSROOM_LOCK_DIR=folder):
            script = ('from pathlib import Path;from django.conf import settings;'
                      'settings.configure(BASE_DIR=Path("."),CLASSROOM_LOCK_DIR=' + repr(folder) + ');'
                      'from materials.services.classrooms import source_lock;'
                      'print("waiting",flush=True);\nwith source_lock(): print("acquired",flush=True)')
            with source.source_lock():
                process = subprocess.Popen([sys.executable, '-c', script], stdout=subprocess.PIPE,
                                           stderr=subprocess.PIPE, text=True)
                self.assertEqual(process.stdout.readline().strip(), 'waiting')
                self.assertIsNone(process.poll())
            stdout, stderr = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 0, stderr)
            self.assertEqual(stdout.strip(), 'acquired')
            with source.source_lock():
                self.assertIsNotNone(source._SOURCE_FD.get())
            self.assertIsNone(source._SOURCE_FD.get())


class ClassroomApiTests(TestCase):
    def setUp(self):
        self.client = AuthClient()
        self.client.set_token(create_user('209911900090'))

    def test_all_endpoints_require_authentication_and_are_get_only(self):
        for name in ['context', 'catalog', 'query']:
            url = '/api/classrooms/' + name + '/'
            self.assertEqual(AuthClient().get(url).status_code, 401)
            self.assertEqual(self.client.post_json(url).status_code, 405)

    def test_context_uses_server_beijing_time_without_fetching_upstream(self):
        with patch.object(source, 'request_source', side_effect=AssertionError('unexpected source call')):
            response = self.client.get_json('/api/classrooms/context/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('+08:00', response.json()['data']['now'])
        self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_query_validates_unknown_duplicate_and_mismatched_parameters(self):
        base = '/api/classrooms/query/?date=2026-10-28&period=1&duration=1'
        for suffix in ['&period=2', '&url=http://example.com', '&force=true', '&periods=一', '&periods=']:
            with self.subTest(suffix=suffix), patch.object(source, 'lookup') as lookup:
                response = self.client.get(base + suffix)
                self.assertEqual(response.status_code, 400)
                lookup.assert_not_called()
        self.assertEqual(self.client.get('/api/classrooms/catalog/?building=a&building=b').status_code, 400)

    def test_api_passes_exact_periods_and_preserves_source_failure(self):
        with patch.object(source, 'lookup', return_value={'count': 0, 'rooms': []}) as lookup:
            r = self.client.get('/api/classrooms/query/?date=2026-10-28&period=2&duration=2&periods=2,9&force=1')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(lookup.call_args.kwargs['periods'], [2, 9])
        self.assertTrue(lookup.call_args.kwargs['force'])
        for error, status in [(source.SourceError('offline'), 502), (source.QueryBusy('busy'), 429)]:
            with patch.object(source, 'lookup', side_effect=error):
                r = self.client.get('/api/classrooms/catalog/?building=教七楼')
            self.assertEqual(r.status_code, status)
            self.assertFalse(r.json()['ok'])
            self.assertNotIn('rooms', r.json())
