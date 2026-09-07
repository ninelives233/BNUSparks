"""
BNU Sparks · 木铎星火 — 我的课表同步 API

课表数据由前端在浏览器本地解析教务导出文件后生成（JSON），此处仅做
按用户的云端存储以支持跨设备同步；数据互相隔离，仅本人可读写。

GET    /api/user/timetable/   读取（未导入时 data=null）
PUT    /api/user/timetable/   保存/覆盖（body: {"data": {...}}）
DELETE /api/user/timetable/   清除云端课表
"""

import json

from django.views.decorators.csrf import csrf_exempt

from .utils import _err, _ok, require_login
from ..models import UserTimetable

# 课表 JSON 体积很小（12 门课约 4KB）；上限仅防滥用
_MAX_BYTES = 200 * 1024


# csrf_exempt 必须作用于最终视图对象（放最外层）：JWT Bearer 认证不依赖
# cookie，CSRF 防护不适用，与 auth/files 等写接口同一模式；漏掉会令浏览器
# PUT 被 CsrfViewMiddleware 以 403 拒绝
@csrf_exempt
@require_login
def api_user_timetable(request):
    if request.method == "GET":
        row = UserTimetable.objects.filter(user=request.user).first()
        if not row:
            return _ok({"data": None, "updated_at": None})
        return _ok({"data": row.data, "updated_at": row.updated_at})

    if request.method in ("PUT", "POST"):
        try:
            body = json.loads(request.body or b"{}")
        except Exception:
            return _err("请求格式错误")
        data = body.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("courses"), list):
            return _err("课表数据格式不正确")
        if len(json.dumps(data, ensure_ascii=False)) > _MAX_BYTES:
            return _err("课表数据过大")
        row, _ = UserTimetable.objects.update_or_create(
            user=request.user, defaults={"data": data}
        )
        return _ok({"updated_at": row.updated_at})

    if request.method == "DELETE":
        deleted, _ = UserTimetable.objects.filter(user=request.user).delete()
        return _ok({"deleted": bool(deleted)})

    return _err("不支持的方法", 405)
