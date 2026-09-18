from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0048_admin_monitoring_indexes"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="timetable_text_align",
            field=models.CharField(
                blank=True,
                choices=[("left", "靠左"), ("center", "居中"), ("right", "靠右")],
                default="",
                max_length=6,
                verbose_name="课程卡片文字对齐",
            ),
        ),
    ]
