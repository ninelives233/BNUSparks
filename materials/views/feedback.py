"""BNU Sparks · 木铎星火 — 意见反馈 API：用户意见直达总管理员消息中心"""

import json
from datetime import datetime, time, timedelta

from django.core.cache import cache
from django.views.decorators.csrf import csrf_exempt

from .utils import Notification, _err, _ok, require_login
from .utils_moderation import _all_super_admins

FEEDBACK_DAILY_LIMIT = 5
FEEDBACK_COOLDOWN_SECONDS = 60
FEEDBACK_MAX_LEN = 500


def _seconds_until_midnight():
    now = datetime.now()
    tomorrow = datetime.combine(now.date() + timedelta(days=1), time.min)
    return max(60, int((tomorrow - now).total_seconds()))


@csrf_exempt
@require_login
def api_feedback(request):
    """POST /api/feedback/ {message} — 用户意见反馈。

    广播给全部总管理员（Notification.Type.FEEDBACK，排除自己）。
    限流走缓存：60 秒冷却防连点 + 每日 5 条（到零点自然重置）。
    注意不能按 Notification 行数计数——一份反馈会按超管数复制成多行。
    """
    if request.method != "POST":
        return _err("不支持的操作", 405)
    try:
        body = json.loads(request.body.decode("utf-8") or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return _err("请求格式错误", 400)
    message = str(body.get("message") or "").strip()
    if not message:
        return _err("请先写下你想反馈的内容", 400)
    if len(message) > FEEDBACK_MAX_LEN:
        return _err(f"反馈最多 {FEEDBACK_MAX_LEN} 字，当前 {len(message)} 字", 400)

    uid = request.user.id
    if cache.get(f"feedback_cooldown_{uid}"):
        return _err("发送太频繁了，稍等一分钟再试", 429)
    day_key = f"feedback_day_{uid}"
    sent_today = cache.get(day_key) or 0
    if sent_today >= FEEDBACK_DAILY_LIMIT:
        return _err("今天已经反馈 5 次了，明天再来吧", 429)

    supers = [u for u in _all_super_admins() if u.id != uid]
    Notification.objects.bulk_create([
        Notification(
            recipient=sa,
            type=Notification.Type.FEEDBACK,
            title=f"意见反馈 · {request.user.username}",
            message=message,
            triggered_by=request.user,
        )
        for sa in supers
    ])
    cache.set(f"feedback_cooldown_{uid}", 1, FEEDBACK_COOLDOWN_SECONDS)
    cache.set(day_key, sent_today + 1, _seconds_until_midnight())
    return _ok({"message": "已送达总管理员"})
