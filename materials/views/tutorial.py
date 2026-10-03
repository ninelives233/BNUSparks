"""
BNU Sparks · 木铎星火 — 使用教程 API

GET  /api/auth/tutorial/   读取推荐状态与已看分镜（幂等建立 pending 状态行）
POST /api/auth/tutorial/   action=claim_offer / dismiss_offer / mark_seen

只处理当前认证用户，不接受任何目标 user_id 参数；匿名一律 401。
并发语义全部由数据库条件更新与唯一约束保证（SQLite 上不把
select_for_update 当作并发解）：两个标签页同时 claim 至多一个成功；
重复 mark_seen 靠唯一约束幂等，不会产生重复行。
分镜白名单与 public/js/tutorial-data.js 保持一致，由
materials/tests/test_tutorial.py 的一致性测试守门。
"""

import json

from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .utils_auth import _get_or_create_profile, _err, _ok, require_login
from ..models import UserTutorialState, UserTutorialLesson

# ── 分镜白名单（与前端 tutorial-data.js 的 LESSONS/GROUP_LESSONS 一致）──

LESSON_GROUPS = {
    "find": ("find-search", "find-filter", "find-same-name",
             "find-preview", "find-zip", "find-download"),
    "courses": ("courses-import", "courses-views", "courses-open",
                "courses-manual", "courses-terms"),
    "save": ("save-course", "save-file", "save-answer", "save-retrieve"),
    "share": ("share-file", "share-text", "share-course",
              "share-review", "share-resubmit"),
    "qa": ("qa-search", "qa-tags", "qa-ask", "qa-answer", "qa-accept"),
}
GROUP_ORDER = tuple(LESSON_GROUPS)

# 当前内容版本：修文案、调动画不提升 revision；操作入口/步骤实质变化才提升。
LESSON_REVISIONS = {
    "find-search": 2,
    "find-filter": 2,
    "find-same-name": 2,
    "find-preview": 2,
    "find-zip": 2,
    "find-download": 2,
    "courses-import": 2,
    "courses-views": 2,
    "courses-open": 2,
    "courses-manual": 2,
    "courses-terms": 2,
    "save-course": 2,
    "save-file": 2,
    "save-answer": 2,
    "save-retrieve": 2,
    "share-file": 2,
    "share-text": 2,
    "share-course": 2,
    "share-review": 2,
    "share-resubmit": 2,
    "qa-search": 2,
    "qa-tags": 2,
    "qa-ask": 2,
    "qa-answer": 2,
    "qa-accept": 2,
}

# 核心导览四幕（与前端 CORE_IDS 一致）：全部看完当前版本即 completed。
CORE_LESSON_IDS = ("find-search", "courses-import", "save-course", "share-text")


def _seen_payload(user):
    """当前用户的权威已看集合（全部行）。"""
    rows = UserTutorialLesson.objects.filter(user=user).order_by("id")
    return [{"lesson_id": row.lesson_id, "revision": row.revision} for row in rows]


def _tutorial_state_payload(user):
    state, _ = UserTutorialState.objects.get_or_create(user=user)
    profile = _get_or_create_profile(user)
    return _ok({
        "offer_state": state.offer_state,
        "eligible": (
            state.offer_state == UserTutorialState.OfferState.PENDING
            and profile.role == "user"
        ),
        "seen": _seen_payload(user),
    })


def _action_claim_offer(user):
    """领取展示：仅普通用户可把 pending 条件推进为 offered。

    管理员、历史 exempt、已领取/dismissed/completed 一律 claimed=False
    且不改状态；绝不先读再 save 的读改写。
    """
    profile = _get_or_create_profile(user)
    if profile.role != "user":
        return _ok({"claimed": False})
    # 尚无状态行的账号（迁移后新建用户跳过了 GET）按 pending 建行：
    # 依赖 OneToOne 唯一约束幂等，不触碰已存在的状态。
    UserTutorialState.objects.get_or_create(user=user)
    updated = UserTutorialState.objects.filter(
        user=user, offer_state=UserTutorialState.OfferState.PENDING,
    ).update(
        offer_state=UserTutorialState.OfferState.OFFERED,
        offered_at=timezone.now(),
    )
    return _ok({"claimed": updated == 1})


def _action_dismiss_offer(user):
    """关闭推荐：pending/offered → dismissed，重复调用幂等；
    completed/exempt 不降级。"""
    UserTutorialState.objects.filter(
        user=user,
        offer_state__in=[
            UserTutorialState.OfferState.PENDING,
            UserTutorialState.OfferState.OFFERED,
        ],
    ).update(
        offer_state=UserTutorialState.OfferState.DISMISSED,
        dismissed_at=timezone.now(),
    )
    return _ok({"dismissed": True})


def _action_mark_seen(user, body):
    """记录一个分镜已看；核心四幕的当前版本齐全时条件推进 completed。

    完成判定由服务端根据已看行计算，无需客户端另发“整组完成”请求；
    客户端也不允许把任意整组标成已看——每次只能标记白名单内的单个分镜，
    且 revision 必须等于当前版本。
    """
    lesson_id = body.get("lesson_id")
    revision = body.get("revision")
    # 类型/长度校验：lesson_id 必须在白名单内（天然限定长度），异常输入
    # 一律 400，不回显原始内容。
    if not isinstance(lesson_id, str) or lesson_id not in LESSON_REVISIONS:
        return _err("未知的分镜", 400)
    if (
        not isinstance(revision, int)
        or isinstance(revision, bool)
        or revision < 1
        or revision != LESSON_REVISIONS[lesson_id]
    ):
        return _err("无效的分镜版本", 400)

    # 唯一约束 (user, lesson_id, revision) 幂等去重；get_or_create 在并发
    # 撞唯一键时回读兜底，两个标签页的两次不同标记都会保留。
    UserTutorialLesson.objects.get_or_create(
        user=user, lesson_id=lesson_id, revision=revision,
    )

    # 保证状态行存在，核心完成的条件推进才有行可改（exempt 行不会被推进）。
    UserTutorialState.objects.get_or_create(user=user)
    core_seen = set(
        UserTutorialLesson.objects.filter(
            user=user, lesson_id__in=CORE_LESSON_IDS,
        ).values_list("lesson_id", "revision")
    )
    if all(
        (lid, LESSON_REVISIONS[lid]) in core_seen
        for lid in CORE_LESSON_IDS
    ):
        UserTutorialState.objects.filter(
            user=user,
            offer_state__in=[
                UserTutorialState.OfferState.PENDING,
                UserTutorialState.OfferState.OFFERED,
                UserTutorialState.OfferState.DISMISSED,
            ],
        ).update(
            offer_state=UserTutorialState.OfferState.COMPLETED,
            completed_at=timezone.now(),
        )
    return _ok({"seen": _seen_payload(user)})


@csrf_exempt
@require_login
def api_tutorial(request):
    """GET/POST /api/auth/tutorial/ — 使用教程状态与进度"""
    if request.method == "GET":
        return _tutorial_state_payload(request.user)
    if request.method == "POST":
        try:
            body = json.loads(request.body or b"{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            return _err("无效的请求体", 400)
        if not isinstance(body, dict):
            return _err("无效的请求体", 400)

        action = body.get("action")
        if action == "claim_offer":
            return _action_claim_offer(request.user)
        if action == "dismiss_offer":
            return _action_dismiss_offer(request.user)
        if action == "mark_seen":
            return _action_mark_seen(request.user, body)
        return _err("未知的操作类型", 400)
    return _err("仅支持 GET/POST", 405)
