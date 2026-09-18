from django.core.management.base import BaseCommand, CommandError

from ...monitoring_events import RAW_RETENTION_DAYS, aggregate_monitoring_events


class Command(BaseCommand):
    help = "将超过保留期的行为事件聚合为小时/日桶，并清理原始事件"

    def add_arguments(self, parser):
        parser.add_argument(
            "--retention-days", type=int, default=RAW_RETENTION_DAYS,
            help=f"原始事件保留天数（默认 {RAW_RETENTION_DAYS}）",
        )
        parser.add_argument(
            "--dry-run", action="store_true",
            help="只统计将要聚合/删除的记录，不写入或删除",
        )

    def handle(self, *args, **options):
        retention_days = options["retention_days"]
        if retention_days < 1 or retention_days > 3650:
            raise CommandError("--retention-days 必须在 1 到 3650 之间")
        result = aggregate_monitoring_events(
            retention_days=retention_days,
            dry_run=options["dry_run"],
        )
        mode = "（试运行，未写入）" if result["dry_run"] else ""
        self.stdout.write(
            self.style.SUCCESS(
                f"监测事件聚合完成{mode}：小时桶 {result['hourly']}，"
                f"日桶 {result['daily']}，清理原始事件 {result['deleted']}。"
            )
        )
