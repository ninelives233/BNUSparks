"""Public teaching-room source adapter; validated GBK reports and shared cache."""
import datetime as dt
import json
import re
import fcntl
import os
from contextlib import contextmanager
from contextvars import ContextVar
from django.conf import settings
from django.core.cache import cache
import hashlib
import time
import urllib.error
import urllib.parse
import urllib.request
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo('Asia/Shanghai')
UPSTREAM = 'http://zyfw.prsc.bnu.edu.cn'
PERIODS = [('08:00', '08:45'), ('08:55', '09:40'), ('10:00', '10:45'), ('10:55', '11:40'),
           ('13:30', '14:15'), ('14:25', '15:10'), ('15:30', '16:15'), ('16:25', '17:10'),
           ('18:00', '18:45'), ('18:55', '19:40'), ('19:50', '20:35'), ('20:45', '21:30')]
MAX_BYTES = 1_500_000
CACHE_SECONDS = 30 * 60
def _cache_key(namespace, key):
    raw = json.dumps(key, ensure_ascii=False, sort_keys=True).encode('utf-8')
    return 'classrooms:v1:' + namespace + ':' + hashlib.sha256(raw).hexdigest()


class SharedCache:
    def __init__(self, namespace, ttl):
        self.namespace, self.ttl = namespace, ttl

    def get(self, key):
        return cache.get(_cache_key(self.namespace, key))

    def __setitem__(self, key, value):
        cache.set(_cache_key(self.namespace, key), value, self.ttl)


CACHE = SharedCache('query', CACHE_SECONDS)
CATALOG_CACHE = SharedCache('catalog', 86400)
DATE_CACHE = SharedCache('date', 300)


class QueryBusy(Exception):
    pass


@contextmanager
def source_lock():
    # Local disk and SQLite are shared by this deployment's Gunicorn workers.
    # flock cannot be culled by the shared Django cache and is released on worker exit.
    folder = Path(getattr(settings, 'CLASSROOM_LOCK_DIR', settings.BASE_DIR / 'data' / 'classroom-lock'))
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(folder / 'upstream.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    acquired = False
    try:
        # Do not occupy both synchronous web workers while another query runs.
        deadline = time.monotonic() + 0.1
        while not acquired:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise QueryBusy('查询排队中，请稍后重试。')
                time.sleep(0.025)
        token = _SOURCE_FD.set(fd)
        try:
            yield fd
        finally:
            _SOURCE_FD.reset(token)
    finally:
        if acquired:
            fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


_SOURCE_FD = ContextVar("classroom_source_fd", default=None)



class SourceError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise SourceError('教务返回跳转页面，暂无法确认名单。')


def request_source(path, fields):
    """No user URL, cookies, credentials or environment proxy; fixed public host."""
    port = getattr(settings, 'CLASSROOM_SOURCE_TUNNEL_PORT', 0)
    if type(port) is not int or not 0 <= port <= 65535:
        raise SourceError('教务连接配置不合法。')
    fd = _SOURCE_FD.get()
    if fd is None:
        raise RuntimeError('Upstream calls require the process-shared source lock')
    os.lseek(fd, 0, os.SEEK_SET)
    try:
        last = float(os.read(fd, 64) or b'0')
    except ValueError:
        last = 0
    delay = min(1.0, max(0, 1.0 - (time.monotonic() - last)))
    if delay:
        time.sleep(delay)
    os.lseek(fd, 0, os.SEEK_SET)
    os.write(fd, str(time.monotonic()).encode('ascii'))
    os.ftruncate(fd, os.lseek(fd, 0, os.SEEK_CUR))
    data = urllib.parse.urlencode(fields).encode('ascii')
    # Only the transport can change: the logical upstream and Host remain fixed.
    target = f'http://127.0.0.1:{port}' if port else UPSTREAM
    req = urllib.request.Request(target + path, data=data, headers={
        'Host': urllib.parse.urlsplit(UPSTREAM).netloc,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'BNUSparks-Classrooms/1.0',
    })
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(req, timeout=12) as response:
            if response.status != 200:
                raise SourceError('教务返回异常状态，请稍后重试。')
            body = response.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise SourceError('教务响应异常过大，已停止解析。')
            return body
    except (OSError, urllib.error.URLError, TimeoutError) as exc:
        raise SourceError('无法连接教务公开查询。请确认网络可访问教务站点后重试。') from exc


def text_only(html):
    return re.sub(r'\s+', ' ', unescape(re.sub(r'<[^>]*>', ' ', html))).strip()


class ReportTables(HTMLParser):
    """Tolerates the report's unclosed tr/td without third-party HTML libraries."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.stack = [], []
        self.row = self.cell = None

    def flush_cell(self):
        if self.cell is not None and self.row is not None:
            self.row.append(re.sub(r'\s+', ' ', ''.join(self.cell)).strip())
        self.cell = None

    def flush_row(self):
        self.flush_cell()
        if self.row and self.stack:
            self.stack[-1].append(self.row)
        self.row = None

    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            self.flush_row()
            self.stack.append([])
        elif tag == 'tr' and self.stack:
            self.flush_row()
            self.row = []
        elif tag in ('td', 'th') and self.row is not None:
            self.flush_cell()
            self.cell = []

    def handle_endtag(self, tag):
        if tag == 'table' and self.stack:
            self.flush_row()
            self.tables.append(self.stack.pop())
        elif tag == 'tr':
            self.flush_row()
        elif tag in ('td', 'th'):
            self.flush_cell()

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)


def parse_report(body, query):
    try:
        html = body.decode('gbk')
    except UnicodeDecodeError as exc:
        raise SourceError('教务报表编码异常，未将其解释为空名单。') from exc
    text = text_only(html)
    if any(s in html for s in ['凭证已失效', '请重新登录', "window.location.href", '统一身份认证']):
        raise SourceError('教务返回登录或跳转页面，未获取到有效名单。')
    term = query['term']
    year = re.search(r'(20\d{2})\s*[-—]\s*(20\d{2})\s*学年', text)
    week = re.search(r'第\s*(\d+)\s*周', text)
    weekday = re.search(r'星期\s*([1-7])', text)
    periods = re.search(r'第\s*([\d\s,，、;；\-~至]+)\s*节', text)
    if not (year and week and weekday and periods and '校区：本部' in text.replace(' ', '')):
        raise SourceError('教务返回空壳或缺少查询范围，无法确认结果。')
    echoed_periods = [int(x) for x in re.findall(r'\d+', periods.group(1))]
    if ('-' in periods.group(1) or '至' in periods.group(1) or '~' in periods.group(1)) and len(echoed_periods) == 2:
        echoed_periods = list(range(echoed_periods[0], echoed_periods[1] + 1))
    if ([int(year[1]), int(year[2])] != [term['xn'], term['xn'] + 1]
            or int(week[1]) != query['week'] or int(weekday[1]) != query['day']
            or echoed_periods != query['periods'] or term['name'] not in text):
        raise SourceError('教务回显与所选日期/节次不符，已拒绝展示。')
    count = re.search(r'空闲教室数\s*[：:]\s*(\d+)', text)
    if not count:
        raise SourceError('教务没有返回可靠的名单条数。')
    parser = ReportTables()
    parser.feed(html)
    required = ['教学楼', '教室', '教室类型', '容量']
    tables = [t for t in parser.tables if t and all(h in t[0] for h in required)]
    if not tables:
        # Empty shells never reach here. Require an explicit scope + count + empty marker.
        if int(count[1]) == 0 and any(x in text for x in ['没有检索到记录', '暂无数据']):
            return []
        raise SourceError('教务报表结构变化，未将其解释为零间教室。')
    table = min(tables, key=lambda t: sum(map(len, t)))
    indexes = [table[0].index(h) for h in required]
    rows, seen = [], set()
    for row in table[1:]:
        if len(row) <= max(indexes):
            raise SourceError('教务存在不完整的教室行，已停止展示。')
        building, room, kind, capacity = [row[i] for i in indexes]
        ident = (building, room)
        if not building or not room or ident in seen:
            raise SourceError('教务返回重复或缺失教室标识，已停止展示。')
        if capacity and not re.fullmatch(r'\d{1,5}', capacity):
            raise SourceError('教务容量字段异常，未生成候选。')
        seen.add(ident)
        rows.append([building, room, kind, int(capacity) if capacity else None])
    if len(rows) != int(count[1]):
        raise SourceError('报表条数与实际教室记录不符，已拒绝展示。')
    return rows


def directory_items(name, params):
    try:
        data = json.loads(request_source('/frame/droplist/getDropLists.action', {
            'comboBoxName': name, 'paramValue': params,
            'isYXB': 'false', 'isCDDW': 'false', 'isXQ': 'false',
        }).decode('utf-8'))
    except (ValueError, UnicodeError) as exc:
        raise SourceError('教务目录格式异常，未获取到可靠目录。') from exc
    if (not isinstance(data, list) or len(data) > 5000
            or any(not isinstance(x, dict) or not isinstance(x.get('code'), str)
                   or not isinstance(x.get('name'), str) or not x['code'] or not x['name']
                   for x in data)):
        raise SourceError('教务目录结构变化，未获取到可靠目录。')
    if len({x['code'] for x in data}) != len(data) or len({x['name'] for x in data}) != len(data):
        raise SourceError('教务目录有重复标识，已停止展示。')
    return data


def room_catalog(building):
    if not isinstance(building, str) or not building.strip() or len(building) > 120:
        raise ValueError('请选择教学楼。')
    now = time.monotonic()
    cached = CATALOG_CACHE.get(('rooms', building))
    if cached and now - cached[0] < 86400:
        return {**cached[1], 'cache_hit': True}
    buildings = CATALOG_CACHE.get('_buildings')
    if not buildings or now - buildings[0] >= 86400:
        items = directory_items('MsSchoolArea_PUBLIC_LF', 'ssxq=0&sybm_m=00')
        if not items:
            raise SourceError('教务未返回教学楼目录，请稍后重试。')
        CATALOG_CACHE['_buildings'] = (now, items)
    else:
        items = buildings[1]
    match = next((x for x in items if x['name'] == building), None)
    if not match:
        raise ValueError('教务目录中没有这栋教学楼。')
    values = directory_items('MsSchoolArea_PUBLIC_LF_JS', urllib.parse.urlencode({
        'xq_m': '0', 'ssjzw_m': match['code'], 'jslx_m': '', 'sybm_m': '00',
    }))
    rooms = []
    for item in values:
        parsed = re.fullmatch(r'\[(\d{1,5})\](.+)\[([^\[\]]+)\]', item['name'])
        if not parsed or not parsed[2].strip() or not parsed[3].strip():
            raise SourceError('教务教室目录字段变化，未生成不完整名单。')
        rooms.append([building, parsed[2].strip(), parsed[3].strip(), int(parsed[1])])
    if len({(r[0], r[1]) for r in rooms}) != len(rooms):
        raise SourceError('教务目录存在重复教室名称。')
    fetched = dt.datetime.now(TZ)
    result = {'status': 'ok', 'building': building, 'buildings': [x['name'] for x in items],
              'rooms': rooms, 'count': len(rooms), 'cache_hit': False,
              'fetched_at': fetched.isoformat(timespec='seconds'),
              'expires_at': (fetched + dt.timedelta(days=1)).isoformat(timespec='seconds'),
              'meaning': '教务教室目录，不表示空闲或自习准入。'}
    CATALOG_CACHE[('rooms', building)] = (time.monotonic(), result)
    return result


def current_term():
    term_cache = cache.get('classrooms:v1:term')
    if term_cache:
        return term_cache
    try:
        raw = json.loads(request_source('/jw/common/showYearTerm.action', {}).decode('utf-8'))
        xn, semester, name = int(raw['xn']), str(raw['xqM']), str(raw['xqName'])
        if not (2000 <= xn <= 2100 and semester in ('0', '1', '2') and re.fullmatch(r'[\u4e00-\u9fff]{2,12}', name)):
            raise ValueError('invalid term')
    except (ValueError, TypeError, KeyError, UnicodeError) as exc:
        raise SourceError('无法确认教务当前学期，请稍后重试。') from exc
    term = {'xn': xn, 'xq_m': semester, 'name': name, 'label': f'{xn}–{xn+1} {name}'}
    cache.set('classrooms:v1:term', term, 300)
    return term


def resolve_date(date):
    today = dt.datetime.now(TZ).date()
    if abs((date - today).days) > 120:
        raise ValueError('请选择今天前后 120 天内、属于当前学期的日期。')
    term = current_term()
    date_key = (term['xn'], term['xq_m'], date.isoformat())
    cached = DATE_CACHE.get(date_key)
    if cached and time.monotonic() - cached[0] < 300:
        return term, cached[1], cached[2]
    body = request_source('/public/getTeachingWeekByDate.action', {
        'xn': str(term['xn']), 'xq_m': term['xq_m'], 'hdrq': date.isoformat(), 'hidOption': 'getWeek',
    }).decode('utf-8').strip()
    match = re.fullmatch(r'(\d{1,2})@([1-7])', body)
    if not match or not 1 <= int(match[1]) <= 30 or int(match[2]) != date.isoweekday():
        raise SourceError('教务没有确认该日期的有效教学周，暂不查询。')
    DATE_CACHE[date_key] = (time.monotonic(), int(match[1]), int(match[2]))
    return term, int(match[1]), int(match[2])


def now_target(now=None):
    now = now or dt.datetime.now(TZ)
    clock = now.strftime('%H:%M')
    for i, (start, finish) in enumerate(PERIODS, 1):
        if clock < start:
            return now.date(), i, '当前不在上课时段，默认查看下一节；不推断课间或午休开放。'
        if start <= clock < finish:
            return now.date(), i, '当前节次 · 查询的是教务名单，非现场座位。'
    return now.date() + dt.timedelta(days=1), 1, '今天的教学节次已结束，默认查看明天第 1 节。'


def normalize_periods(period, duration, periods=None):
    if periods is None:
        if not 1 <= period <= 12 or not 1 <= duration <= 12 or period + duration - 1 > 12:
            raise ValueError('节次或时长不合法，连续查询不能超出当天第 12 节。')
        periods = list(range(period, period + duration))
    else:
        if (not isinstance(periods, (list, tuple)) or not 1 <= len(periods) <= 12
                or any(type(p) is not int or not 1 <= p <= 12 for p in periods)
                or len(set(periods)) != len(periods)):
            raise ValueError('请选择不重复的第1–12节，至少一节。')
        periods = sorted(periods)
        if period != periods[0] or duration != len(periods):
            raise ValueError('起始节次、数量与所选节次不符。')
    return periods


def cached_query(date, periods, force=False, started=None):
    cached = CACHE.get((date.isoformat(), tuple(periods)))
    if not cached or time.monotonic() - cached[0] >= CACHE_SECONDS:
        return None
    if force and (started is None or cached[0] < started):
        return None
    return {**cached[1], 'cache_hit': True}


def query_rooms(date, period, duration, force=False, periods=None):
    periods = normalize_periods(period, duration, periods)
    cache_key = (date.isoformat(), tuple(periods))
    cached = cached_query(date, periods, force)
    if cached is not None:
        return cached
    term, week, day = resolve_date(date)
    ps = [f'{p:02}' for p in periods]
    fields = [('xn', str(term['xn'])), ('xn1', str(term['xn'] + 1)), ('xq_m', term['xq_m']),
              ('sel_zc', f'{week:02}'), ('hidweeks', str(day)), ('chkXq', str(day)), ('hidjcs', ','.join(ps)),
              ('selXQ', '0'), ('selLF', ''), ('selJSLX', ''), ('selJSI', ''), ('sybm_m', '00'),
              ('hidMIN', '0'), ('hidMAX', '800'), ('min', '0'), ('max', '800'),
              ('selGS', '2'), ('chkBHSZWLYDJS', 'on')] + [('chkjc', p) for p in ps]
    body = request_source('/public/dykb.kxjsi_data.gs2.jsp', fields)
    query = {'date': date.isoformat(), 'period': period, 'duration': duration,
             'periods': periods, 'week': week, 'day': day, 'term': term}
    rooms = parse_report(body, query)
    fetched_at = dt.datetime.now(TZ)
    result = {'status': 'ok', 'query': query, 'rooms': rooms, 'count': len(rooms),
              'fetched_at': fetched_at.isoformat(timespec='seconds'),
              'expires_at': (fetched_at + dt.timedelta(minutes=35)).isoformat(timespec='seconds'),
              'cache_hit': False, 'source': UPSTREAM + '/public/dykb.kxjsi.html',
              'meaning': '同一间教室在全部所选节次均列入教务空闲名单；未选节次不作保证，不是现场座位或开门状态。'}
    CACHE[cache_key] = (time.monotonic(), result)
    return result



def lookup(kind, *, date=None, period=1, duration=1, periods=None, building=None, force=False):
    """Fast cache hits; one shared, rate-spaced upstream request sequence on a miss."""
    started = time.monotonic()
    if kind == 'catalog':
        if not isinstance(building, str) or not building.strip() or len(building) > 120:
            raise ValueError('请选择教学楼。')
        hit = CATALOG_CACHE.get(('rooms', building))
        if hit and time.monotonic() - hit[0] < 86400:
            return {**hit[1], 'cache_hit': True}
    else:
        if abs((date - dt.datetime.now(TZ).date()).days) > 120:
            raise ValueError('请选择今天前后120天内的日期。')
        periods = normalize_periods(period, duration, periods)
        hit = cached_query(date, periods, force, started)
        if hit is not None:
            return hit
    with source_lock():
        if kind == 'catalog':
            return room_catalog(building)
        hit = cached_query(date, periods, force, started)
        return hit if hit is not None else query_rooms(date, period, duration, force, periods)
