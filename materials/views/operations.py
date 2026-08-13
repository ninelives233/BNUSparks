"""
BNU Sparks · 木铎星火 — 文件管理 & 文件夹管理 API

file-update, folder-CRUD (3 types), rename, move, set-course,
operations, folder-restore, batch-delete/edit, restore-deletion

本文件为薄 facade：函数体已拆分到 operations_helpers / operations_folder /
operations_records / operations_batch / operations_manage 五个子模块。
此处保留原文件全部顶层导入并显式重导出全部函数与内部辅助符号，
保持既有调用面不变——views/__init__ 的 api_* 导入、
course_requests `from .operations import _can_create_under` 均继续可用。
"""

import json
import re
import shutil
from datetime import timedelta
from pathlib import Path

from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User
from django.db.models import Q, Max
from django.conf import settings
from django.utils import timezone

from .utils import (
    _err, _ok, _get_or_create_profile, _create_notification,
    _check_moderator_access, _get_courses_in_category,
    _get_category_preload, _safe_dir_name, _get_visible_deletion_records,
    _safe_int, _stage_file_to_trash, _purge_expired_trash,
    require_login, require_role,
    _find_existing_course, _find_leaf_under_parent,
    UserProfile, Material, Course, CourseCategory, College,
    Notification, FolderOperation, DeletionRecord,
)

from .operations_helpers import (
    _next_custom_code, _check_category_scope, _is_descendant,
    _find_college_node, _can_create_under, _managed_college_subtree_ids,
)
from .operations_folder import (
    api_folder_create, api_folder_delete,
)
from .operations_records import (
    api_operations, _folder_has_materials, api_folder_restore,
    api_restore_deletion,
)
from .operations_batch import (
    api_file_batch_delete, api_file_batch_edit,
)
from .operations_manage import (
    api_file_update, api_file_pin, api_folder_rename, api_folder_set_course,
)
