"""Authenticated, same-origin public classroom queries. Personal schedules stay client-side."""
import datetime as dt
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from .utils import require_login
from ..services import classrooms as source


def _response(data, status=200):
    response = JsonResponse({'ok': status == 200, 'data': data} if status == 200 else
                            {'ok': False, 'error': data}, status=status)
    response['Cache-Control'] = 'private, no-store'
    if status == 429:
        response['Retry-After'] = '1'
    return response


@require_GET
@require_login
def api_classroom_context(request):
    now = dt.datetime.now(source.TZ)
    date, period, _ = source.now_target(now)
    return _response({'status': 'ok', 'now': now.isoformat(timespec='seconds'),
                      'today': now.date().isoformat(), 'target_date': date.isoformat(), 'period': period})


def _params(request, required, optional=()):
    values = request.GET
    if set(values) - (set(required) | set(optional)) or any(len(values.getlist(k)) != 1 for k in values):
        raise ValueError('查询参数不合法。')
    if any(k not in values for k in required):
        raise ValueError('缺少查询条件。')
    return values


@require_GET
@require_login
def api_classroom_catalog(request):
    try:
        values = _params(request, ('building',))
        return _response(source.lookup('catalog', building=values['building']))
    except ValueError as error:
        return _response(str(error), 400)
    except source.QueryBusy as error:
        return _response(str(error), 429)
    except source.SourceError as error:
        return _response(str(error), 502)


@require_GET
@require_login
def api_classroom_query(request):
    try:
        values = _params(request, ('date', 'period', 'duration'), ('periods', 'force'))
        date = dt.date.fromisoformat(values['date'])
        period, duration = int(values['period']), int(values['duration'])
        force = values.get('force', '0')
        if force not in ('0', '1'):
            raise ValueError('刷新参数不合法。')
        periods = None
        if 'periods' in values:
            raw = values['periods'].split(',')
            if len(raw) > 12 or any(not p.isascii() or not p.isdigit() for p in raw):
                raise ValueError('请选择有效的课节。')
            periods = [int(p) for p in raw]
        return _response(source.lookup('query', date=date, period=period, duration=duration,
                                       periods=periods, force=force == '1'))
    except (ValueError, OverflowError) as error:
        return _response(str(error), 400)
    except source.QueryBusy as error:
        return _response(str(error), 429)
    except source.SourceError as error:
        return _response(str(error), 502)
