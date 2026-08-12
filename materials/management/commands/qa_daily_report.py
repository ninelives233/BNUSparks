"""「我要提问」点击量日报的管理命令（v=174）。

聚合 QaAskClickDaily 当日 + 累积点击，经 Notification 通知全体超管 + 问答区版主。
供服务器 crontab 每日执行（DEPLOY.md 备份 cron 为模板）。

用法：python manage.py qa_daily_report
"""

from django.core.management.base import BaseCommand

from ...views.qa import _send_daily_qa_report


class Command(BaseCommand):
    help = "生成「我要提问」点击量日报并通知超管/问答区版主（配合 cron 每日执行）"

    def handle(self, *args, **options):
        sent = _send_daily_qa_report()
        self.stdout.write(self.style.SUCCESS(f"日报已发送给 {sent} 位管理员"))
