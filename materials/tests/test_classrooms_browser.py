"""My Courses classroom integration against the real SPA (synthetic schedule/source).

BNU_BROWSER_TESTS=1 python3 manage.py test --settings=bnusparks.settings_test \\
    materials.tests.test_classrooms_browser
"""
import datetime as dt
import importlib.util
import json
import os
import unittest
from urllib.parse import parse_qs, urlsplit

from django.contrib.staticfiles.testing import StaticLiveServerTestCase

from materials.models import UserTimetable
from .helpers import AuthClient, _make_jwt, create_user

DATA = {'meta': {'semester': '2026-2027学年秋季学期'}, 'start': '2026-09-07',
        'importedAt': 1793160000000, 'courses': [
            {'id': 'onsite', 'code': 'MAT02008', 'name': '合成线性代数', 'meetings': [
                {'ws': 1, 'we': 16, 'parity': 0, 'day': 3, 'ps': 5, 'pe': 6, 'room': '七206'}]},
            {'id': 'next-day', 'code': 'GEN00002', 'name': '合成人工智能导论', 'meetings': [
                {'ws': 1, 'we': 16, 'parity': 0, 'day': 4, 'ps': 3, 'pe': 4, 'room': '九102'}]},
            {'id': 'next-day-later', 'code': 'GEN00003', 'name': '合成研讨课', 'meetings': [
                {'ws': 1, 'we': 16, 'parity': 0, 'day': 4, 'ps': 7, 'pe': 8, 'room': '九205'}]},
            {'id': 'next-day-other', 'code': 'GEN00004', 'name': '合成跨楼课程', 'meetings': [
                {'ws': 1, 'we': 16, 'parity': 0, 'day': 4, 'ps': 1, 'pe': 2, 'room': '二204'}]},
            {'id': 'past-day', 'code': 'GEN00005', 'name': '合成已结束课程', 'meetings': [
                {'ws': 1, 'we': 16, 'parity': 0, 'day': 2, 'ps': 3, 'pe': 4, 'room': '九204'}]},
            {'id': 'online', 'code': 'GEN00001', 'name': '合成线上课', 'meetings': [
                {'ws': 1, 'we': 16, 'parity': 0, 'day': 3, 'ps': 11, 'pe': 12, 'room': '网上自学'}]}]}
BUILDINGS = ['教二楼', '教三楼', '教四楼', '教七楼', '教八楼', '教九楼', '化学楼', '生地楼', '艺术楼', '电子楼']
ROOMS = [[b, prefix + str(200 + n), '多媒体教室', 30 + n * 10]
         for b, prefix in zip(BUILDINGS, ['二', '三', '四', '七', '八', '九', '化', '生', '艺', '电'])
         for n in range(1, 8)]
ROOMS += [['教九楼', '九101', '多媒体教室', 60], ['教九楼', '九102', '多媒体教室', 60]]
STAMP = '2026-10-28T14:00:00+08:00'


@unittest.skipUnless(os.environ.get('BNU_BROWSER_TESTS') == '1' and importlib.util.find_spec('playwright'),
                     '设置 BNU_BROWSER_TESTS=1 并安装 Playwright 后运行浏览器验收')
class ClassroomIntegrationBrowserTest(StaticLiveServerTestCase):
    def setUp(self):
        from playwright.sync_api import sync_playwright
        self.user = create_user('209911900091')
        self.other_user = create_user('209911900092')
        UserTimetable.objects.create(user=self.user, data=DATA)
        client = AuthClient()
        client.set_token(self.user)
        client.post_json('/api/auth/tutorial/', {'action': 'dismiss_offer'})
        client.set_token(self.other_user)
        client.post_json('/api/auth/tutorial/', {'action': 'dismiss_offer'})
        self.pw = sync_playwright().start()
        self.browser = getattr(self.pw, os.environ.get('BNU_BROWSER_ENGINE', 'chromium')).launch()
        self.context = self.browser.new_context(viewport={'width': 1440, 'height': 1000})
        self.page = self.context.new_page()
        self.errors, self.calls = [], []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.clock.set_fixed_time(dt.datetime.fromisoformat(STAMP))
        self.page.add_init_script("""(() => {
          const s = %s;
          sessionStorage.setItem('token', s.token);
          localStorage.setItem('bnusparks_user_id', String(s.uid));
          localStorage.setItem('bnusparks_timetable_view_u' + s.uid, 'list');
        })();""" % json.dumps({'uid': self.user.id, 'token': _make_jwt(self.user.id)}))
        self.page.route('**/api/classrooms/**', self.source)
        self.page.goto(self.live_server_url + '/timetable')
        self.page.wait_for_function('typeof ttSetView === "function" && ttState.data && currentUser')

    def tearDown(self):
        self.browser.close()
        self.pw.stop()
        self.assertEqual(self.errors, [])

    def source(self, route):
        url = urlsplit(route.request.url)
        self.assertIn('authorization', route.request.headers)
        params = {k: v[0] for k, v in parse_qs(url.query).items()}
        self.calls.append((url.path, params))
        if url.path.endswith('/context/'):
            data = {'status': 'ok', 'now': STAMP, 'today': '2026-10-28', 'target_date': '2026-10-28', 'period': 5}
        elif url.path.endswith('/catalog/'):
            rows = [r for r in ROOMS if r[0] == params['building']]
            data = {'status': 'ok', 'building': params['building'], 'buildings': BUILDINGS, 'rooms': rows,
                    'count': len(rows), 'fetched_at': STAMP, 'expires_at': '2026-10-29T14:00:00+08:00'}
        else:
            period, duration = int(params['period']), int(params['duration'])
            periods = list(map(int, params['periods'].split(','))) if 'periods' in params else list(range(period, period + duration))
            rows = [r for i, r in enumerate(ROOMS) if all((i + p) % 4 for p in periods)]
            data = {'status': 'ok', 'query': {'date': params['date'], 'period': period, 'duration': duration,
                    'periods': periods, 'week': 8, 'day': dt.date.fromisoformat(params['date']).isoweekday(), 'term': {'xn': 2026, 'xq_m': '0', 'name': '秋季学期'}},
                    'rooms': rows, 'count': len(rows), 'fetched_at': STAMP,
                    'expires_at': '2026-10-28T14:35:00+08:00', 'cache_hit': False}
        route.fulfill(json={'ok': True, 'data': data})

    def enter(self):
        self.page.locator('#ttViewSeg [data-view=classrooms]').click()
        self.page.wait_for_function('document.querySelector("#cr-sourceMessage").textContent.includes("12/12")')
        self.page.wait_for_selector('#cr-results .browse-table')

    def test_wide_view_uses_current_schedule_and_keeps_calendar_and_status_blocks(self):
        self.assertEqual(self.page.locator('#ttViewSeg button').count(), 3)
        self.enter()
        self.assertEqual(self.page.locator('#cr-roomsTitle').inner_text(), '教七楼 · 7间教室')
        self.assertIn('七206', self.page.locator('.browse-table tbody tr').first.inner_text())
        self.assertIn('本节教室', self.page.locator('.browse-table tbody tr').first.inner_text())
        self.assertIn('合成线性代数', self.page.locator('.lesson-band').inner_text())
        self.assertEqual(self.page.locator('.browse-table .lesson-head').get_attribute('colspan'), '2')
        self.assertEqual(self.page.locator('.browse-table .lesson-column .browse-status').count(), 14)
        self.assertNotIn('合成线上课', self.page.locator('#cr-timeAxis').inner_text())
        self.assertEqual(self.page.locator('#cr-buildingOverview .tilechart:visible').count(), 6)
        self.page.locator('.matrix-room').first.click()
        self.page.wait_for_selector('#cr-roomDialog[open]')
        self.page.wait_for_function('document.getElementById("cr-detailProgress").textContent.includes("12/12")')
        self.assertEqual(self.page.locator('#cr-roomDialog [data-detail-period]').count(), 12)
        self.assertEqual(self.page.locator('#cr-roomTitle').inner_text(), '七206')
        self.page.locator('#cr-roomDialog .close').click()
        self.page.locator('#cr-linkTimetable').uncheck()
        self.assertEqual(self.page.locator('.lesson-head').count(), 0)
        self.page.locator('#ttViewSeg [data-view=grid]').click()
        self.page.wait_for_selector('#ttGrid')
        self.page.locator('#ttViewSeg [data-view=list]').click()
        self.page.wait_for_selector('#ttList')

    def test_narrow_dropdown_keyboard_and_unselected_schedule_are_independent(self):
        self.enter()
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.assertFalse(self.page.locator('#ttViewSeg').is_visible())
        self.page.locator('#ttViewPicker').click()
        self.assertFalse(self.page.locator('#ttViewMenu').is_hidden())
        self.page.keyboard.press('Escape')
        self.assertTrue(self.page.locator('#ttViewMenu').is_hidden())
        self.page.locator('#ttViewPicker').click()
        self.page.locator('#ttViewMenu [data-view=grid]').click()
        self.page.wait_for_selector('#ttGrid')
        self.page.locator('#ttViewPicker').click()
        self.page.locator('#ttViewMenu [data-view=classrooms]').click()
        self.page.wait_for_selector('.browse-table')
        self.assertEqual(self.page.locator('#cr-timeAxis [aria-pressed=true]').count(), 0)
        self.assertEqual(self.page.locator('#cr-buildingOverview .tilechart:visible').count(), 0)
        self.assertTrue(self.page.evaluate('document.body.scrollWidth <= innerWidth'))
        self.page.locator('#cr-buildingOverview [data-building="教八楼"]').click()
        self.page.wait_for_function('document.getElementById("cr-roomsTitle").textContent.includes("教八楼")')
        self.assertTrue(self.page.locator('.lesson-head').is_visible())
        self.assertIn('lesson-away', self.page.locator('.lesson-head').get_attribute('class'))

    def test_exact_toggles_preferences_no_timetable_and_logout_cleanup(self):
        self.enter()
        self.page.locator('#cr-timeAxis [data-period="5"]').click()
        self.page.locator('#cr-timeAxis [data-period="7"]').click()
        self.assertEqual(self.page.locator('#cr-timeAxis [aria-pressed=true]').count(), 2)
        self.page.locator('#cr-timeAxis [data-period="5"]').click()
        self.assertEqual(self.page.locator('#cr-timeAxis [aria-pressed=true]').count(), 1)
        self.page.locator('#cr-clearPeriods').click()
        self.page.locator('#ttManageBtn').click()
        self.page.locator('#cr-scope').select_option('ten')
        self.page.locator('#cr-settingsDialog [data-close=settingsDialog]').first.click()
        self.assertEqual(self.page.locator('#cr-buildingOverview [data-building]').count(), 10)
        self.page.evaluate('ttState.data=null; ttRenderAll({animate:false})')
        self.assertTrue(self.page.locator('.cr-app').is_visible())
        self.assertEqual(self.page.locator('#ttViewSeg [data-view=classrooms]').get_attribute('aria-pressed'), 'true')
        self.page.evaluate('clearAuthToken()')
        self.assertEqual(self.page.locator('.cr-app > *').count(), 0)
        self.assertTrue(self.page.evaluate('(uid)=>!!localStorage.getItem("bnusparks_classrooms_v1_u"+uid)', self.user.id))
        self.assertIsNone(self.page.evaluate('localStorage.getItem("study-room-preferences")'))

    def test_theme_reduced_motion_and_account_preferences_are_isolated(self):
        self.enter()
        self.page.emulate_media(reduced_motion='reduce')
        self.page.evaluate('document.documentElement.dataset.bnuTheme="dark"')
        self.page.wait_for_function('document.querySelector(".cr-app").dataset.theme === "dark"')
        self.assertEqual(self.page.locator('.cr-app').get_attribute('data-bnu-theme'), 'dark')
        self.page.locator('#ttManageBtn').click()
        self.page.locator('#cr-scope').select_option('ten')
        self.page.locator('#cr-settingsDialog .close').click()
        self.page.evaluate('clearAuthToken()')
        second = self.page.context.new_page()
        second.add_init_script("""(() => {
          const s = %s;
          sessionStorage.setItem('token', s.token);
          localStorage.setItem('bnusparks_user_id', String(s.uid));
          localStorage.setItem('bnusparks_timetable_view_u' + s.uid, 'classrooms');
        })();""" % json.dumps({'uid': self.other_user.id, 'token': _make_jwt(self.other_user.id)}))
        second.route('**/api/classrooms/**', self.source)
        second.goto(self.live_server_url + '/timetable')
        second.wait_for_function('document.querySelector("#cr-sourceMessage")?.textContent.includes("12/12")')
        self.assertEqual(second.locator('#cr-buildingOverview [data-building]').count(), 6)
        self.assertEqual(second.locator('.lesson-band').count(), 0)
        self.assertEqual(second.locator('#cr-timeAxis [aria-pressed=true]').count(), 0)
        self.assertEqual(second.locator('#cr-scope').input_value(), 'common')
        second.close()

    def test_leaving_during_startup_and_logging_out_from_an_open_dialog_cancel_cleanly(self):
        waiting = []
        self.page.route('**/api/classrooms/context/', lambda route: waiting.append(route))
        self.page.locator('#ttViewSeg [data-view=classrooms]').click()
        self.page.wait_for_timeout(100)
        self.assertTrue(waiting)
        self.page.locator('#ttViewSeg [data-view=list]').click()
        self.page.wait_for_selector('#ttList')
        waiting[0].fulfill(json={'ok': True, 'data': {'status': 'ok', 'now': STAMP,
                            'today': '2026-10-28', 'target_date': '2026-10-28', 'period': 5}})
        self.page.wait_for_timeout(100)
        self.assertEqual(self.page.locator('.cr-app').count(), 0)
        self.page.unroute('**/api/classrooms/context/')
        self.enter()
        self.page.locator('#ttManageBtn').click()
        self.page.locator('#cr-scope').select_option('custom')
        self.page.wait_for_selector('#cr-customDialog[open]')
        self.page.evaluate('clearAuthToken()')
        self.page.wait_for_timeout(100)
        self.assertEqual(self.page.locator('.cr-app').count(), 0)

    def choose_date(self, date):
        self.page.locator('#cr-plan').click()
        self.page.locator('#cr-date').fill(date)
        self.page.locator('#cr-date').dispatch_event('change')
        self.page.wait_for_function('(date)=>document.getElementById("cr-date").value===date && !document.getElementById("cr-dateDialog").open', arg=date)

    def test_selected_date_course_rooms_are_pinned_without_a_current_class(self):
        self.enter()
        self.choose_date('2026-10-29')
        self.page.locator('#cr-buildingOverview [data-building="教九楼"]').click()
        self.page.wait_for_function('document.getElementById("cr-roomsTitle").textContent.includes("教九楼")')
        rows = self.page.locator('.browse-table tbody tr')
        self.assertEqual(rows.nth(0).locator('.matrix-room').inner_text(), '九102\n上课教室')
        self.assertEqual(rows.nth(1).locator('.matrix-room').inner_text(), '九205\n上课教室')
        self.assertEqual(rows.nth(2).locator('.matrix-room').inner_text(), '九101')
        self.page.locator('#cr-linkTimetable').uncheck()
        self.assertEqual(rows.first.locator('.matrix-room').inner_text(), '九101')
        self.assertEqual(self.page.locator('.current-course-room').count(), 0)
        self.page.locator('#cr-linkTimetable').check()
        self.page.wait_for_function('document.querySelector(".matrix-room")?.textContent.includes("九102")')
        self.choose_date('2026-10-27')
        self.page.wait_for_function('document.querySelector(".matrix-room")?.textContent.includes("九204")')
        self.assertEqual(rows.first.locator('.matrix-room').inner_text(), '九204\n上课教室')
        self.choose_date('2026-10-30')
        self.page.wait_for_function('document.querySelector(".matrix-room")?.textContent === "九101"')
        self.assertEqual(self.page.locator('.current-course-room').count(), 0)

    def test_all_buildings_keeps_groups_and_pins_course_rooms_within_each_building(self):
        self.enter()
        self.page.locator('#cr-browseAll').click()
        self.page.wait_for_function('document.querySelectorAll(".browse-table tbody tr").length === 44')
        groups = self.page.locator('.browse-table tbody tr').evaluate_all('(rows)=>[...new Set(rows.map(row=>row.dataset.rowBuilding))]')
        self.assertEqual(groups, BUILDINGS[:6])
        room = self.page.locator('.browse-table tbody tr[data-row-building="教七楼"]').first.locator('.matrix-room')
        self.assertEqual(room.inner_text(), '七206\n本节教室\n教七楼')
