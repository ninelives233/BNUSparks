"""
BNU Sparks · 木铎星火 — 共享辅助函数

供 views/ 下各功能模块引用，避免跨模块循环依赖。
"""

from django.db.models import Q, Sum, F

from ..models import (
    College, Course, CourseType, Material, MaterialType,
    CourseCategory, UserProfile, Notification, ReviewComment,
    Favorite, DownloadRecord, DeletionRecord, FolderOperation, Announcement,
    _bump_user_public_gen,
)

# v=179：共享辅助函数按领域拆分为 6 个子模块，本文件为薄 facade，
# 显式重导出全部顶层符号，保持 `from .utils import X` 的既有调用面不变。
from .utils_security import (
    _BLOCKED_UPLOAD_EXTS, _blocked_upload_ext, _safe_dir_name, _safe_int,
    _sanitize_filename_part, _strip_exif,
)
from .utils_auth import (
    _err, _generate_download_token, _generate_portable_download_token,
    _get_or_create_profile, _get_user,
    _identity_can_edit, _jwt_decode, _jwt_encode, _normalize_identity, _ok,
    _request_client_ip, _verify_download_token, _verify_portable_download_token,
    require_login, require_role,
)
from .utils_course_tree import (
    _build_tree_node, _clear_category_preload, _college_node_of,
    _find_existing_course, _find_leaf_under_parent,
    _find_nodes_containing_course, _get_category_preload,
    _get_courses_in_category, _get_courses_in_category_preloaded,
    _node_contains_course, _node_under, _thread_local, _unique_college_names,
)
from .utils_trash import (
    TRASH_RETENTION, TrashStageError, _perform_soft_delete, _purge_expired_trash,
    _restore_staged_file, _stage_file_to_trash, _trash_dir,
)
from .utils_quota import (
    DAILY_DOWNLOAD_LIMIT, DAILY_REPORT_LIMIT, ENFORCE_UPLOAD_SCOPE,
    _check_download_quota, _check_report_quota,
)
from .utils_moderation import (
    _all_super_admins, _check_auto_approve, _check_moderator_access,
    _create_notification, _find_moderators_for_course,
    _find_moderators_for_course_scoped, _get_managed_sections_display,
    _get_moderated_material_qs, _get_subordinate_covered_course_ids,
    _get_visible_deletion_records, _report_candidates, _review_candidates,
    _user_can_edit_material, _user_covers_course,
)
