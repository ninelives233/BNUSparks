from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0040_userprofile_mobile_nav"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="default_view",
            field=models.CharField(
                blank=True,
                choices=[("home", "首页"), ("timetable", "我的课程")],
                default="",
                max_length=10,
                verbose_name="打开时进入",
            ),
        ),
    ]
