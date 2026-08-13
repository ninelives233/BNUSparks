"""
BNU Sparks · 木铎星火 — 问答区（新生指南）API

Phase 1：管理员/问答区版主（can_moderate_qa）发布图文问题与回答；
已认证学生及通过 2026 门控的未注册新生浏览、搜索、收藏、点赞。
Phase 2 预留（仅字段/枚举，不实现）：用户提问/回答、最佳回答采纳、通知、热度排序。
"""

# 问答区按功能拆分为 4 个子模块（qa_helpers / qa_public / qa_admin / qa_tasks），
# 本文件为薄 facade，显式重导出全部顶层符号，保持 `from .qa import X` 的既有调用面不变。
from .qa_helpers import (
    _QA_ALLOWED_TAGS,
    _QA_ATTRS,
    _QaSanitizer,
    _can_manage_qa,
    _ensure_qa_l1_tags,
    _json_body,
    _nickname,
    _qa_answer_item,
    _qa_moderator_audience,
    _qa_question_summary,
    _sanitize_html,
    _strip_html,
    require_qa_manager,
)
from .qa_public import (
    _ensure_question_fav,
    api_qa_answer_favorite,
    api_qa_answer_like,
    api_qa_ask_click,
    api_qa_guest_verify,
    api_qa_question_detail,
    api_qa_question_favorite,
    api_qa_question_view,
    api_qa_questions,
    api_qa_tags,
    api_qa_user_favorites,
)
from .qa_admin import (
    _QA_PIN_LIMIT,
    _pinned_count,
    _qa_approve_answer,
    _qa_approve_question,
    _qa_reject_answer,
    _qa_reject_question,
    api_qa_admin_answer_approve,
    api_qa_admin_answer_create,
    api_qa_admin_answer_delete,
    api_qa_admin_answer_history,
    api_qa_admin_answer_reject,
    api_qa_admin_answer_rollback,
    api_qa_admin_answer_update,
    api_qa_admin_pending,
    api_qa_admin_question_approve,
    api_qa_admin_question_create,
    api_qa_admin_question_delete,
    api_qa_admin_question_history,
    api_qa_admin_question_reject,
    api_qa_admin_question_rollback,
    api_qa_admin_question_update,
    api_qa_admin_records,
    api_qa_admin_upload_image,
)
from .qa_tasks import (
    _purge_expired_qa,
    _send_daily_qa_report,
)
