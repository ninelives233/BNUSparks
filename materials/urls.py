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
    path("auth/verify-email/", views.api_verify_email, name="api_verify_email"),

    # 课程
    path("courses/", views.api_courses, name="api_courses"),
    path("courses/tree/", views.api_course_tree, name="api_course_tree"),
    path("courses/request/", views.api_course_request_create, name="api_course_request_create"),
    path("courses/request/check/", views.api_course_request_check, name="api_course_request_check"),
    path("courses/request/<int:request_id>/files/", views.api_course_request_upload_file, name="api_course_request_upload_file"),
    path("courses/request/<int:request_id>/", views.api_course_request_delete, name="api_course_request_delete"),
    path("courses/<str:course_code>/files/", views.api_course_files, name="api_course_files"),
    path("courses/<str:course_code>/favorite/", views.api_course_favorite_toggle, name="api_course_favorite_toggle"),

    # 文件
    path("files/upload/", views.api_file_upload, name="api_file_upload"),
    path("files/upload-text/", views.api_file_upload_text, name="api_file_upload_text"),
    path("files/<int:file_id>/download/", views.api_file_download, name="api_file_download"),
    path("files/<int:file_id>/download-token/", views.api_download_token, name="api_download_token"),
    path("files/<int:file_id>/delete/", views.api_file_delete, name="api_file_delete"),
    path("files/<int:file_id>/update/", views.api_file_update, name="api_file_update"),
    path("files/<int:file_id>/pin/", views.api_file_pin, name="api_file_pin"),
    path("files/batch-delete/", views.api_file_batch_delete, name="api_file_batch_delete"),
    path("files/batch-edit/", views.api_file_batch_edit, name="api_file_batch_edit"),
    path("files/<int:file_id>/report/", views.api_file_report, name="api_file_report"),
    path("files/<int:file_id>/report-status/", views.api_file_report_status, name="api_file_report_status"),

    # 收藏
    path("files/<int:file_id>/", views.api_file_detail, name="api_file_detail"),
    path("files/<int:file_id>/favorite/", views.api_favorite_toggle, name="api_favorite_toggle"),
    path("files/<int:file_id>/zip-structure/", views.api_zip_structure, name="api_zip_structure"),
    path("files/<int:file_id>/favorite-status/", views.api_favorite_status, name="api_favorite_status"),
    path("user/favorites/", views.api_my_favorites, name="api_my_favorites"),
    path("user/course-favorites/", views.api_my_course_favorites, name="api_my_course_favorites"),

    # 文件夹管理（管理模式编辑）
    path("folders/create/", views.api_folder_create, name="api_folder_create"),
    path("folders/<int:folder_id>/delete/", views.api_folder_delete, name="api_folder_delete"),
    path("folders/<int:folder_id>/rename/", views.api_folder_rename, name="api_folder_rename"),
    path("folders/<int:folder_id>/set-course/", views.api_folder_set_course, name="api_folder_set_course"),

    # 操作记录（Iter 6）
    path("operations/", views.api_operations, name="api_operations"),
    path("operations/<int:operation_id>/restore/", views.api_folder_restore, name="api_folder_restore"),

    # 通知 & 个人资料
    path("auth/notifications/", views.api_notifications, name="api_notifications"),
    path("auth/notifications/<int:nid>/read/", views.api_notification_read, name="api_notification_read"),
    path("auth/profile/", views.api_profile, name="api_profile"),
    path("auth/avatar/", views.api_avatar_upload, name="api_avatar_upload"),
    path("user/uploads/", views.api_my_uploads, name="api_my_uploads"),
    path("user/downloads/", views.api_my_downloads, name="api_my_downloads"),
    path("user/rankings/", views.api_user_rankings, name="api_user_rankings"),
    path("user/public/<int:uid>/", views.api_user_public, name="api_user_public"),

    # 公告（Iter 7）
    path("announcements/", views.api_announcements, name="api_announcements"),
    path("announcements/<int:aid>/", views.api_announcement_delete, name="api_announcement_delete"),

    # 搜索 & 统计
    path("search/", views.api_search, name="api_search"),
    path("stats/", views.api_stats, name="api_stats"),
    path("colleges/", views.api_colleges, name="api_colleges"),

    # 审核（Iter 3）
    path("moderation/pending/", views.api_moderation_pending, name="api_moderation_pending"),
    path("moderation/batch-approve/", views.api_moderation_batch_approve, name="api_moderation_batch_approve"),
    path("moderation/course-requests/", views.api_moderation_course_requests, name="api_moderation_course_requests"),
    path("moderation/course-requests/batch-approve/", views.api_moderation_course_requests_batch_approve, name="api_moderation_course_requests_batch_approve"),
    path("moderation/course-requests/<int:request_id>/approve/", views.api_moderation_course_request_approve, name="api_moderation_course_request_approve"),
    path("moderation/course-requests/<int:request_id>/reject/", views.api_moderation_course_request_reject, name="api_moderation_course_request_reject"),
    path("moderation/<int:file_id>/approve/", views.api_moderation_approve, name="api_moderation_approve"),
    path("moderation/<int:file_id>/reject/", views.api_moderation_reject, name="api_moderation_reject"),
    path("moderation/<int:file_id>/reassign/", views.api_moderation_reassign, name="api_moderation_reassign"),
    path("moderation/<int:file_id>/assignable/", views.api_moderation_assignable, name="api_moderation_assignable"),
    path("moderation/<int:file_id>/comments/", views.api_review_comments, name="api_review_comments"),
    path("moderation/history/", views.api_moderation_history, name="api_moderation_history"),
    path("moderation/auto-approve/", views.api_auto_approve_toggle_self, name="api_auto_approve_toggle_self"),
    path("moderation/deletions/", views.api_deletion_records, name="api_deletion_records"),
    path("moderation/deletions/<int:deletion_id>/restore/", views.api_restore_deletion, name="api_restore_deletion"),
    path("moderation/stats/", views.api_moderation_stats, name="api_moderation_stats"),
    path("moderation/reports/pending/", views.api_report_pending, name="api_report_pending"),
    path("moderation/reports/history/", views.api_report_history, name="api_report_history"),
    path("moderation/reports/<int:report_id>/handle/", views.api_report_handle, name="api_report_handle"),
    path("moderation/reports/<int:report_id>/finish/", views.api_report_finish, name="api_report_finish"),

    # 问答区（新生指南，Phase 1 + Phase 2 v183）
    path("qa/tags/", views.api_qa_tags, name="api_qa_tags"),
    path("qa/config/", views.api_qa_config, name="api_qa_config"),
    path("qa/questions/", views.api_qa_questions, name="api_qa_questions"),
    path("qa/questions/<int:qid>/", views.api_qa_question_detail, name="api_qa_question_detail"),
    path("qa/questions/<int:qid>/view/", views.api_qa_question_view, name="api_qa_question_view"),
    path("qa/questions/<int:qid>/favorite/", views.api_qa_question_favorite, name="api_qa_question_favorite"),
    path("qa/questions/<int:qid>/answers/", views.api_qa_answer_create_user, name="api_qa_answer_create_user"),
    path("qa/questions/<int:target_id>/report/", views.api_qa_report, {"kind": "questions"}, name="api_qa_question_report"),
    path("qa/questions/<int:target_id>/report-status/", views.api_qa_report_status, {"kind": "questions"}, name="api_qa_question_report_status"),
    path("qa/answers/<int:aid>/", views.api_qa_answer_edit_user, name="api_qa_answer_edit_user"),
    path("qa/answers/<int:aid>/accept/", views.api_qa_answer_accept, name="api_qa_answer_accept"),
    path("qa/answers/<int:target_id>/report/", views.api_qa_report, {"kind": "answers"}, name="api_qa_answer_report"),
    path("qa/answers/<int:target_id>/report-status/", views.api_qa_report_status, {"kind": "answers"}, name="api_qa_answer_report_status"),
    path("qa/answers/<int:aid>/favorite/", views.api_qa_answer_favorite, name="api_qa_answer_favorite"),
    path("qa/answers/<int:aid>/like/", views.api_qa_answer_like, name="api_qa_answer_like"),
    path("qa/user/favorites/", views.api_qa_user_favorites, name="api_qa_user_favorites"),
    path("qa/guest/verify/", views.api_qa_guest_verify, name="api_qa_guest_verify"),
    path("qa/ask-click/", views.api_qa_ask_click, name="api_qa_ask_click"),

    # 问答区管理（问答区版主 / 超管，Phase 1 + Phase 2 v183）
    path("admin/qa/config/", views.api_qa_admin_config_toggle, name="api_qa_admin_config_toggle"),
    path("admin/qa/delete-requests/", views.api_qa_admin_delete_requests, name="api_qa_admin_delete_requests"),
    path("admin/qa/delete-requests/<int:req_id>/approve/", views.api_qa_admin_delete_request_approve, name="api_qa_admin_delete_request_approve"),
    path("admin/qa/delete-requests/<int:req_id>/reject/", views.api_qa_admin_delete_request_reject, name="api_qa_admin_delete_request_reject"),
    path("admin/qa/questions/", views.api_qa_admin_question_create, name="api_qa_admin_question_create"),
    path("admin/qa/questions/<int:qid>/", views.api_qa_admin_question_update, name="api_qa_admin_question_update"),
    path("admin/qa/questions/<int:qid>/delete/", views.api_qa_admin_question_delete, name="api_qa_admin_question_delete"),
    path("admin/qa/questions/<int:qid>/history/", views.api_qa_admin_question_history, name="api_qa_admin_question_history"),
    path("admin/qa/questions/<int:qid>/rollback/", views.api_qa_admin_question_rollback, name="api_qa_admin_question_rollback"),
    path("admin/qa/questions/<int:qid>/answers/", views.api_qa_admin_answer_create, name="api_qa_admin_answer_create"),
    path("admin/qa/answers/<int:aid>/", views.api_qa_admin_answer_update, name="api_qa_admin_answer_update"),
    path("admin/qa/answers/<int:aid>/delete/", views.api_qa_admin_answer_delete, name="api_qa_admin_answer_delete"),
    path("admin/qa/answers/<int:aid>/history/", views.api_qa_admin_answer_history, name="api_qa_admin_answer_history"),
    path("admin/qa/answers/<int:aid>/rollback/", views.api_qa_admin_answer_rollback, name="api_qa_admin_answer_rollback"),
    path("admin/qa/records/", views.api_qa_admin_records, name="api_qa_admin_records"),
    path("admin/qa/pending/", views.api_qa_admin_pending, name="api_qa_admin_pending"),
    path("admin/qa/questions/<int:qid>/approve/", views.api_qa_admin_question_approve, name="api_qa_admin_question_approve"),
    path("admin/qa/questions/<int:qid>/reject/", views.api_qa_admin_question_reject, name="api_qa_admin_question_reject"),
    path("admin/qa/answers/<int:aid>/approve/", views.api_qa_admin_answer_approve, name="api_qa_admin_answer_approve"),
    path("admin/qa/answers/<int:aid>/reject/", views.api_qa_admin_answer_reject, name="api_qa_admin_answer_reject"),
    path("admin/qa/upload-image/", views.api_qa_admin_upload_image, name="api_qa_admin_upload_image"),

    # 用户管理（Iter 3 — 仅 super_admin）
    path("admin/users/", views.api_admin_users, name="api_admin_users"),
    path("admin/users/<int:uid>/role/", views.api_admin_set_role, name="api_admin_set_role"),
    path("admin/sections/", views.api_admin_sections, name="api_admin_sections"),
    path("admin/users/<int:uid>/auto-approve/", views.api_admin_auto_approve_toggle, name="api_admin_auto_approve_toggle"),
]
