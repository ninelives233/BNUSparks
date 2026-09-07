"""
BNU Sparks · 木铎星火 — views 包

直通重导出所有 api_xxx 函数，使 urls.py 的 `from . import views` 保持兼容。
"""

# 认证
from .auth import (
    api_register, api_resend_verification, api_verify_email, api_login, api_me,
    api_change_password, api_forgot_password, api_reset_password,
)

# 通知
from .notifications import api_notifications, api_notification_read

# 个人资料 / 用户
from .profile import (
    api_profile, api_avatar_upload,
    api_my_uploads, api_my_downloads,
    api_user_rankings, api_user_public,
)

# 课程 / 搜索 / 统计
from .courses import (
    api_courses, api_course_files, api_course_tree,
    api_search, api_stats, api_colleges,
)

# 文件操作
from .files import (
    api_file_upload, api_file_upload_text,
    api_download_token, api_file_download, api_file_delete,
    api_file_detail, api_zip_structure,
)

# 举报
from .reports import (
    api_file_report, api_file_report_status,
    api_qa_report, api_qa_report_status,
    api_report_pending, api_report_handle,
    api_report_finish, api_report_history,
)

# 收藏
from .favorites import (
    api_favorite_toggle, api_favorite_status, api_my_favorites,
    api_course_favorite_toggle, api_my_course_favorites,
)

# 我的课表（跨设备同步）
from .user_timetable import api_user_timetable

# 审核
from .moderation import (
    api_moderation_pending, api_moderation_batch_approve,
    api_moderation_approve, api_moderation_reject,
    api_moderation_reassign, api_moderation_assignable,
    api_review_comments, api_moderation_history, api_moderation_stats,
    api_deletion_records, api_auto_approve_toggle_self,
)

# 文件管理 / 文件夹 / 操作
from .operations import (
    api_file_update, api_file_pin, api_folder_create, api_folder_delete,
    api_folder_rename, api_folder_set_course,
    api_operations, api_folder_restore,
    api_restore_deletion,
    api_file_batch_delete, api_file_batch_edit,
)

# 新建课程申请
from .course_requests import (
    api_course_request_create, api_course_request_check,
    api_course_request_upload_file,
    api_course_request_delete,
    api_moderation_course_requests,
    api_moderation_course_request_approve, api_moderation_course_request_reject,
    api_moderation_course_requests_batch_approve,
)

# 管理员
from .admin import (
    api_admin_users, api_admin_set_role,
    api_admin_sections, api_admin_auto_approve_toggle,
)
from .admin_monitoring import api_admin_monitoring, api_admin_user_downloads

# 公告
from .announcements import api_announcements, api_announcement_delete

# 问答区（新生指南，Phase 1 + Phase 2 v183）
from .qa import (
    api_qa_tags, api_qa_questions, api_qa_question_detail,
    api_qa_question_view, api_qa_question_favorite,
    api_qa_answer_favorite, api_qa_answer_like, api_qa_user_favorites,
    api_qa_guest_verify, api_qa_ask_click,
    api_qa_config, api_qa_admin_config_toggle,
    api_qa_question_create_user, api_qa_question_edit_user,
    api_qa_answer_create_user, api_qa_answer_edit_user, api_qa_answer_accept,
    api_qa_admin_question_create, api_qa_admin_question_update,
    api_qa_admin_question_delete, api_qa_admin_question_history,
    api_qa_admin_question_rollback, api_qa_admin_answer_create,
    api_qa_admin_answer_update, api_qa_admin_answer_delete,
    api_qa_admin_answer_history, api_qa_admin_answer_rollback,
    api_qa_admin_records, api_qa_admin_pending, api_qa_admin_upload_image,
    api_qa_admin_question_approve, api_qa_admin_question_reject,
    api_qa_admin_answer_approve, api_qa_admin_answer_reject,
    api_qa_admin_delete_requests,
    api_qa_admin_delete_request_approve, api_qa_admin_delete_request_reject,
)

# ── 内部辅助函数（供测试套件引用）──
from .utils import (
    _review_candidates,
    _check_auto_approve,
    _check_download_quota,
    _check_report_quota,
    _report_candidates,
    _get_courses_in_category,
)
