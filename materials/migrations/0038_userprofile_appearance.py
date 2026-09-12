# Generated manually for the personal appearance preferences.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0037_timetableimportrecord"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="home_layout",
            field=models.CharField(
                blank=True,
                choices=[("loose", "松散首页"), ("compact", "紧凑首页")],
                default="",
                max_length=10,
                verbose_name="首页布局",
            ),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="color_theme",
            field=models.CharField(
                blank=True,
                choices=[("warm", "暖色"), ("cool", "冷色"), ("dark", "暗色")],
                default="",
                max_length=10,
                verbose_name="色彩主题",
            ),
        ),
    ]
