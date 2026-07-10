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
    path("files/<int:file_id>/delete/", views.api_file_delete, name="api_file_delete"),

    # 通知 & 个人资料
    path("auth/notifications/", views.api_notifications, name="api_notifications"),
    path("auth/notifications/<int:nid>/read/", views.api_notification_read, name="api_notification_read"),
    path("auth/profile/", views.api_profile, name="api_profile"),
    path("user/uploads/", views.api_my_uploads, name="api_my_uploads"),

    # 搜索 & 统计
    path("search/", views.api_search, name="api_search"),
    path("stats/", views.api_stats, name="api_stats"),
    path("colleges/", views.api_colleges, name="api_colleges"),

    # 审核（Iter 3）
    path("moderation/pending/", views.api_moderation_pending, name="api_moderation_pending"),
    path("moderation/<int:file_id>/approve/", views.api_moderation_approve, name="api_moderation_approve"),
    path("moderation/<int:file_id>/reject/", views.api_moderation_reject, name="api_moderation_reject"),
    path("moderation/<int:file_id>/reassign/", views.api_moderation_reassign, name="api_moderation_reassign"),
    path("moderation/<int:file_id>/comments/", views.api_review_comments, name="api_review_comments"),
    path("moderation/history/", views.api_moderation_history, name="api_moderation_history"),
    path("moderation/stats/", views.api_moderation_stats, name="api_moderation_stats"),

    # 用户管理（Iter 3 — 仅 super_admin）
    path("admin/users/", views.api_admin_users, name="api_admin_users"),
    path("admin/users/<int:uid>/role/", views.api_admin_set_role, name="api_admin_set_role"),
    path("admin/sections/", views.api_admin_sections, name="api_admin_sections"),
    path("admin/users/<int:uid>/auto-approve/", views.api_admin_auto_approve_toggle, name="api_admin_auto_approve_toggle"),
]
