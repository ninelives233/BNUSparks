"""硬删暂存区超期文件的管理命令（v=167 D18）。

软删除把物理文件移入 data/trash/，超过 TRASH_RETENTION（48h）即应硬删。
正常路径下各删除/恢复/列表端点已顺带清理；本命令供 cron/手动定期兜底。

用法：python manage.py purge_trash
"""

from django.core.management.base import BaseCommand

from ...views.utils import _purge_expired_trash


class Command(BaseCommand):
    help = "硬删 data/trash 下超过 48 小时的暂存文件（可配合 cron 定期执行）"

    def handle(self, *args, **options):
        _purge_expired_trash()
        self.stdout.write(self.style.SUCCESS("trash 清理完成（超期文件已硬删）"))
