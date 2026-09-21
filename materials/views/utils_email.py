"""面向用户的主动邮件辅助。"""

import logging

from django.conf import settings
from django.core.mail import EmailMessage
from django.utils import timezone

from ..models import UserProfile


logger = logging.getLogger(__name__)


def send_first_upload_thanks(user, material, profile=None):
    """首份资料成功落库后发送一次感谢邮件；邮件失败不影响上传结果。"""
    if profile is None:
        profile, _ = UserProfile.objects.get_or_create(
            user=user, defaults={"role": UserProfile.Role.USER},
        )

    claimed_at = timezone.now()
    claimed = UserProfile.objects.filter(
        pk=profile.pk,
        first_upload_email_sent_at__isnull=True,
    ).update(first_upload_email_sent_at=claimed_at)
    if not claimed:
        return False

    recipient = (user.email or "").strip()
    if not recipient:
        _release_first_upload_email_claim(profile.pk, claimed_at)
        return False

    sender = (
        getattr(settings, "EMAIL_HOST_USER", "")
        or getattr(settings, "DEFAULT_FROM_EMAIL", "bnusparks@163.com")
    )
    display_name = (user.first_name or user.username or "同学").strip()
    course_name = material.course.name if material.course_id else "新建课程申请"
    body = (
        f"你好，{display_name}：\n\n"
        f"感谢你在 BNU Sparks 上传了第一份资料「{material.title}」！\n"
        f"课程：{course_name}\n\n"
        "资料共享离不开每一位同学的参与。如果你愿意继续上传课程资料，或参与资料审核、课程目录整理、问答区维护等社区工作，\n"
        "欢迎直接回复这封邮件告诉我们你的想法。我们会与你联系，并根据实际参与情况为你添加相应的管理员权限。\n\n"
        "再次感谢你的贡献，也欢迎把你觉得值得分享的资料带来这里。\n\n"
        "BNU Sparks · 木铎星火\n"
        "（直接回复本邮件即可）"
    )

    try:
        message = EmailMessage(
            subject="感谢你为 BNU Sparks 上传资料",
            body=body,
            from_email=sender,
            to=[recipient],
            reply_to=[sender],
        )
        if message.send(fail_silently=False) != 1:
            raise RuntimeError("邮件后端未接受首份资料感谢邮件")
    except Exception:
        logger.exception("首份资料感谢邮件发送失败：user_id=%s", user.pk)
        _release_first_upload_email_claim(profile.pk, claimed_at)
        return False
    return True


def _release_first_upload_email_claim(profile_id, claimed_at):
    """发送失败时释放领取标记，让用户下一次成功上传时可以重试。"""
    UserProfile.objects.filter(
        pk=profile_id,
        first_upload_email_sent_at=claimed_at,
    ).update(first_upload_email_sent_at=None)
