"""回填用户校区：扫描全部已存课表，按上课地点关键词判定并写入 UserProfile.campus。

用法：python manage.py backfill_user_campus
幂等：unknown 判定不覆盖已有校区值。
"""

from django.core.management.base import BaseCommand

from materials.models import UserTimetable, UserProfile
from materials.views.utils_campus import detect_campus


class Command(BaseCommand):
    help = "根据课表上课地点关键词回填用户校区（beijing/zhuhai）"

    def handle(self, *args, **options):
        counts = {"zhuhai": 0, "beijing": 0, "unknown": 0}
        updated = 0
        for row in UserTimetable.objects.select_related("user__profile"):
            campus = detect_campus(row.data)
            counts[campus] += 1
            if campus == "unknown":
                continue
            profile = getattr(row.user, "profile", None)
            if profile is None:
                profile = UserProfile.objects.create(user=row.user)
            if profile.campus != campus:
                profile.campus = campus
                profile.save(update_fields=["campus"])
                updated += 1
        self.stdout.write(
            f"扫描课表 {sum(counts.values())} 份：北京 {counts['beijing']}、"
            f"珠海 {counts['zhuhai']}、未判定 {counts['unknown']}；更新 profile {updated} 条"
        )
