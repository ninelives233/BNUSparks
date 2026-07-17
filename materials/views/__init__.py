"""
BNU Sparks · 木铎星火 — views 包

直通重导出所有 api_xxx 函数，使 urls.py 的 `from . import views` 保持兼容。
"""

# 认证
from .auth import (
    api_register, api_verify_email, api_login, api_me,
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
)

# 审核
from .moderation import (
    api_moderation_pending, api_moderation_batch_approve,
    api_moderation_approve, api_moderation_reject,
    api_moderation_reassign, api_review_comments,
    api_moderation_history, api_moderation_stats,
    api_deletion_records,
)

# 文件管理 / 文件夹 / 操作
from .operations import (
    api_file_update, api_folder_create, api_folder_delete,
    api_operations, api_folder_restore,
    api_restore_deletion,
    api_file_batch_delete, api_file_batch_edit,
)

# 管理员
from .admin import (
    api_admin_users, api_admin_set_role,
    api_admin_sections, api_admin_auto_approve_toggle,
)

# 公告
from .announcements import api_announcements, api_announcement_delete

# ── 内部辅助函数（供测试套件引用）──
from .utils import (
    _calculate_review_assignment,
    _check_auto_approve,
    _check_download_quota,
    _get_courses_in_category,
)
