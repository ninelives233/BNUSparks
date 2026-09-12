from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0039_campuslink"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="mobile_nav",
            field=models.CharField(
                blank=True, default="",
                choices=[("bottom", "底部导航"), ("burger", "汉堡菜单")],
                max_length=10, verbose_name="移动端导航方式",
            ),
        ),
    ]
