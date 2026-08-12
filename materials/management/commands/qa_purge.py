"""问答区软删除超期硬删的管理命令（v=174，镜像 purge_trash）。

问题/回答软删除后保留 48h（可恢复），超过即真删并清理孤儿编辑留痕/收藏。
正常路径下软删除端点仅置 status=deleted；本命令供 cron/手动定期兜底硬删。

用法：python manage.py qa_purge
"""

from django.core.management.base import BaseCommand

from ...views.qa import _purge_expired_qa


class Command(BaseCommand):
    help = "硬删问答区软删除超过 48 小时的问题/回答（可配合 cron 定期执行）"

    def handle(self, *args, **options):
        q_count, a_count = _purge_expired_qa()
        self.stdout.write(self.style.SUCCESS(
            f"问答区清理完成：硬删问题 {q_count} 条、回答 {a_count} 条"))
