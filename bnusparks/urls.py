"""
BNU Sparks — 主路由
"""

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import HttpResponse, HttpResponseNotModified
from pathlib import Path


def frontend(request, *args, **kwargs):
    """服务前端 index.html（ETag + revalidate，未变返回 304，省 50KB 刷新重传）。
    no-store：SPA 入口绝不落盘，防止个别浏览器/WebView 无视 revalidation
    复活旧页面（部署新前端后"硬刷新也看不到新功能"的根因）。
    *args/**kwargs 兼容 catch-all 路由 <path:rest> 传入的 rest 关键字参数。"""
    html_path = Path(__file__).resolve().parent.parent / "public" / "index.html"
    st = html_path.stat()
    etag = f'"{int(st.st_mtime)}-{st.st_size}"'
    if request.headers.get("If-None-Match") == etag:
        return HttpResponseNotModified(headers={"ETag": etag, "Cache-Control": "no-cache, no-store, must-revalidate"})
    html = html_path.read_text(encoding="utf-8")
    return HttpResponse(html, headers={"Cache-Control": "no-cache, no-store, must-revalidate", "ETag": etag})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("materials.urls")),
    path("", frontend, name="frontend"),
    path("reset-password/", frontend, name="reset-password"),
    path("verify-email/", frontend, name="verify-email"),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT) + [
    # SPA 干净 URL 兜底（v=171）：/about /explorer/... /file/... 等深链刷新返回 index.html。
    # 必须放在 static() 之后，否则 dev 下 /media/ 会被吞掉；/api/ /admin/ /static/ 均在其前匹配。
    path("<path:rest>", frontend, name="frontend-fallback"),
]
