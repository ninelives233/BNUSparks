from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0041_userprofile_default_view"),
    ]

    operations = [
        migrations.AlterField(
            model_name="userprofile",
            name="color_theme",
            field=models.CharField(
                blank=True,
                choices=[
                    ("warm", "暖色"),
                    ("cool", "冷色"),
                    ("dark", "暗色"),
                    ("system", "跟随系统"),
                ],
                default="",
                max_length=10,
                verbose_name="色彩主题",
            ),
        ),
    ]
