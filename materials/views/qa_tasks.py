"""
BNU Sparks · 木铎星火 — 问答区定时任务（每日「我要提问」埋点报表 / 48h 硬删）
"""

from datetime import date, timedelta

from django.db.models import Q, Sum
from django.utils import timezone

from ..models import (
    Notification,
    QaAnswer,
    QaAskClickDaily,
    QaEditHistory,
    QaFavorite,
    QaQuestion,
)
from .qa_helpers import _qa_moderator_audience
from .utils import _create_notification

# ═══════════════════════════════════════════════════════════════
# 每日「我要提问」埋点报表（管理命令 qa_daily_report 调用）
# ═══════════════════════════════════════════════════════════════

def _send_daily_qa_report(today=None):
    """聚合当日 + 累积点击，通知全体超管 + 问答区版主。返回通知数。"""
    today = today or date.today()
    row = QaAskClickDaily.objects.filter(date=today).first()
    today_count = row.count if row else 0
    total = QaAskClickDaily.objects.aggregate(s=Sum("count"))["s"] or 0
    audience = _qa_moderator_audience()
    sent = 0
    for u in audience:
        _create_notification(
            recipient=u, type=Notification.Type.OPERATION,
            title="「我要提问」点击量日报",
            message=f"今日 {today_count} 次，累计 {total} 次。若点击持续增多，可考虑提前开放提问功能。",
        )
        sent += 1
    return sent


# ═══════════════════════════════════════════════════════════════
# 48h 硬删（管理命令 qa_purge 调用，镜像 _purge_expired_trash）
# ═══════════════════════════════════════════════════════════════

def _purge_expired_qa(retention_hours=48):
    """硬删软删除超过 retention_hours 的问答区问题/回答，并清理孤儿留痕。

    - 回答真删：级联清 QaAnswerLike + 回答级 QaFavorite
    - 问题真删：级联清 QaAnswer/QaViewLog/问题级 QaFavorite（含其下回答的点赞与收藏）
    - 兜底清理：QaEditHistory 是 target_type/target_id 无 FK，硬删内容后需按现存 id 收尾；
      QaFavorite 正常路径已级联，仅防 SQLite FK 未强制时的残留。
    返回 (硬删问题数, 硬删回答数)。
    """
    now = timezone.now()
    cutoff = now - timedelta(hours=retention_hours)

    expired_answers = QaAnswer.objects.filter(
        status=QaAnswer.Status.DELETED, deleted_at__lt=cutoff)
    answer_count = expired_answers.count()
    expired_answers.delete()

    expired_questions = QaQuestion.objects.filter(
        status=QaQuestion.Status.DELETED, deleted_at__lt=cutoff)
    question_count = expired_questions.count()
    expired_questions.delete()

    # 孤儿编辑留痕（无 FK，硬删后 target 已不存在 → 删除，保留 target 仍存在的）
    QaEditHistory.objects.exclude(
        Q(target_type="question", target_id__in=QaQuestion.objects.values("id"))
        | Q(target_type="answer", target_id__in=QaAnswer.objects.values("id"))
    ).delete()
    # 兜底：孤儿收藏（正常路径 FK 级联已清，防 SQLite 未强制 FK 时残留）
    QaFavorite.objects.exclude(question_id__in=QaQuestion.objects.values("id")).delete()
    return question_count, answer_count
