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
        # 徽标轮询只取未读，减少负载（?unread_only=1）
        if request.GET.get("unread_only") == "1":
            notifs = notifs.filter(is_read=False)
        unread = notifs.filter(is_read=False).count()
        # v=164.1：分页（每页 20）。抽屉仍取第 1 页，但用 total/unread_count 保证总数正确
        try:
            page = int(request.GET.get("page", "1"))
        except (TypeError, ValueError):
            page = 1
        per_page = 20
        total = notifs.count()
        total_pages = max(1, (total + per_page - 1) // per_page)
        page = max(1, min(page, total_pages))
        start = (page - 1) * per_page
        return _ok({
            "unread_count": unread,
            "total": total,
            "page": page,
            "total_pages": total_pages,
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
            } for n in notifs[start:start + per_page]],
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
