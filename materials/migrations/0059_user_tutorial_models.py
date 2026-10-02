"""使用教程：新增推荐状态（UserTutorialState）与分镜已看记录（UserTutorialLesson），
并把迁移时点已存在的全部用户（含尚无 profile 的账号）回填为 offer_state="exempt"。

上线顺序：标准 ``python3 manage.py migrate``；先部署读取新表的代码再执行迁移，
或先迁移再部署代码均可——新表只被新代码读写，两种顺序下旧代码都不受影响。
回滚兼容：旧代码回滚时这两张新增表可以暂留在库里，不阻碍旧功能运行；
无需立即反向迁移。

反向迁移风险：本迁移的 reverse_code 为 noop，反向执行仅删除两张新增表。
一旦执行反向迁移，用户的教程进度（推荐状态与已看分镜记录）将全部丢失且
无法恢复；请仅在确认放弃进度数据后执行。
"""

from django.db import migrations, models
from django.db.models import Max, Min

import django.db.models.deletion
from django.conf import settings


def backfill_existing_users_exempt(apps, schema_editor):
    """把存量用户（包括尚无 profile 的账号）建为 offer_state="exempt" 的状态行。

    按 pk 范围分批（每批 500）迭代，不一次性把全表载入内存；已存在状态行的
    用户跳过（幂等，迁移可安全重跑），bulk_create ignore_conflicts 兜底
    极端并发下的重复插入。
    """
    User = apps.get_model("auth", "User")
    UserTutorialState = apps.get_model("materials", "UserTutorialState")

    BATCH = 500
    bounds = User.objects.aggregate(first=Min("id"), last=Max("id"))
    start, last = bounds["first"], bounds["last"]
    while start is not None and start <= last:
        end = start + BATCH - 1
        user_ids = list(
            User.objects.filter(id__gte=start, id__lte=end)
            .values_list("id", flat=True)
        )
        existing = set(
            UserTutorialState.objects.filter(user_id__in=user_ids)
            .values_list("user_id", flat=True)
        )
        UserTutorialState.objects.bulk_create(
            (
                UserTutorialState(user_id=uid, offer_state="exempt")
                for uid in user_ids
                if uid not in existing
            ),
            batch_size=BATCH,
            ignore_conflicts=True,
        )
        start = end + 1


class Migration(migrations.Migration):

    dependencies = [
        ('materials', '0058_materialtype_icon_default'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='UserTutorialState',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('offer_state', models.CharField(choices=[('pending', '待推荐'), ('offered', '已领取'), ('dismissed', '已关闭'), ('completed', '已完成'), ('exempt', '豁免')], default='pending', max_length=12, verbose_name='推荐状态')),
                ('offered_at', models.DateTimeField(blank=True, null=True, verbose_name='领取时间')),
                ('dismissed_at', models.DateTimeField(blank=True, null=True, verbose_name='关闭时间')),
                ('completed_at', models.DateTimeField(blank=True, null=True, verbose_name='完成时间')),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='tutorial_state', to=settings.AUTH_USER_MODEL, verbose_name='用户')),
            ],
            options={
                'verbose_name': '使用教程状态',
                'verbose_name_plural': '使用教程状态',
            },
        ),
        migrations.CreateModel(
            name='UserTutorialLesson',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('lesson_id', models.CharField(max_length=32, verbose_name='分镜编号')),
                ('revision', models.PositiveIntegerField(verbose_name='内容版本')),
                ('seen_at', models.DateTimeField(auto_now_add=True, verbose_name='已看时间')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='tutorial_lessons', to=settings.AUTH_USER_MODEL, verbose_name='用户')),
            ],
            options={
                'verbose_name': '教程分镜已看记录',
                'verbose_name_plural': '教程分镜已看记录',
                'indexes': [models.Index(fields=['user', 'seen_at'], name='tutorial_lesson_user_seen')],
                'constraints': [models.UniqueConstraint(fields=('user', 'lesson_id', 'revision'), name='unique_user_tutorial_lesson')],
            },
        ),
        # reverse 为 noop：反向迁移只删表，教程进度随之丢失（见文件 docstring）。
        migrations.RunPython(backfill_existing_users_exempt, migrations.RunPython.noop),
    ]
