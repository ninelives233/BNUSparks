from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0038_userprofile_appearance"),
    ]

    operations = [
        migrations.CreateModel(
            name="CampusLink",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=40, verbose_name="入口名称")),
                ("url", models.URLField(max_length=500, verbose_name="网址")),
                ("order", models.PositiveIntegerField(default=0, verbose_name="排序")),
                ("is_enabled", models.BooleanField(default=True, verbose_name="启用")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "校园快捷入口",
                "verbose_name_plural": "校园快捷入口",
                "ordering": ["order", "id"],
            },
        ),
    ]
