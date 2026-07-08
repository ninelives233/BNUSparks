"""
BNU Sparks — 主路由
"""

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import HttpResponse
from pathlib import Path


def frontend(request):
    """服务前端 index.html"""
    html = (Path(__file__).resolve().parent.parent / "public" / "index.html").read_text(encoding="utf-8")
    return HttpResponse(html)


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("materials.urls")),
    path("", frontend, name="frontend"),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
