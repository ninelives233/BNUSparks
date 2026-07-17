"""BNU Sparks · 木铎星火 — 通知 API"""

from django.views.decorators.csrf import csrf_exempt

from django.shortcuts import get_object_or_404

from .utils import _err, _ok, require_login, Notification


@csrf_exempt
@require_login
def api_notifications(request):
    """GET /auth/notifications/ — 通知列表（返回 {list, unread_count}）
       POST /auth/notifications/ — 全部标为已读
       DELETE /auth/notifications/ — 清空所有通知"""
    if request.method == "GET":
        notifs = Notification.objects.filter(recipient=request.user).order_by("-created_at")
        unread = notifs.filter(is_read=False).count()
        return _ok({
            "unread_count": unread,
            "list": [{
                "id": n.id,
                "type": n.type,
                "title": n.title,
                "message": n.message,
                "is_read": n.is_read,
                "material_id": n.material_id,
                "course_code": n.course_code,
                "course_name": n.course_name,
                "created_at": n.created_at.strftime("%Y-%m-%d %H:%M"),
            } for n in notifs],
        })

    elif request.method == "POST":
        Notification.objects.filter(recipient=request.user, is_read=False).update(is_read=True)
        return _ok({"message": "全部已读"})

    elif request.method == "DELETE":
        Notification.objects.filter(recipient=request.user).delete()
        return _ok({"message": "已清空"})

    return _err("不支持的操作", 405)


@csrf_exempt
@require_login
def api_notification_read(request, nid):
    """POST /auth/notifications/{nid}/read/ — 单条标记已读
       DELETE /auth/notifications/{nid}/read/ — 单条删除"""
    notif = get_object_or_404(Notification, id=nid, recipient=request.user)
    if request.method == "POST":
        notif.is_read = True
        notif.save(update_fields=["is_read"])
        return _ok({"message": "已读"})
    elif request.method == "DELETE":
        notif.delete()
        return _ok({"message": "已删除"})
    return _err("不支持的操作", 405)
