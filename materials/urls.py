"""
BNU Sparks — API 路由（/api/ 前缀）
"""

from django.urls import path
from . import views

urlpatterns = [
    # 认证
    path("auth/register/", views.api_register, name="api_register"),
    path("auth/login/", views.api_login, name="api_login"),
    path("auth/me/", views.api_me, name="api_me"),
    path("auth/change-password/", views.api_change_password, name="api_change_password"),
    path("auth/forgot-password/", views.api_forgot_password, name="api_forgot_password"),
    path("auth/reset-password/", views.api_reset_password, name="api_reset_password"),

    # 课程
    path("courses/", views.api_courses, name="api_courses"),
    path("courses/tree/", views.api_course_tree, name="api_course_tree"),
    path("courses/<str:course_code>/files/", views.api_course_files, name="api_course_files"),

    # 文件
    path("files/upload/", views.api_file_upload, name="api_file_upload"),
    path("files/<int:file_id>/download/", views.api_file_download, name="api_file_download"),

    # 搜索 & 统计
    path("search/", views.api_search, name="api_search"),
    path("stats/", views.api_stats, name="api_stats"),
]
