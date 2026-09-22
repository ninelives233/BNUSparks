from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("materials", "0056_userprofile_first_upload_email"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="campus_links_mode",
            field=models.CharField(
                choices=[("featured", "管理员精选"), ("personal", "我的入口")],
                default="featured",
                max_length=8,
                verbose_name="校园入口显示模式",
            ),
        ),
        migrations.CreateModel(
            name="UserCampusLink",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=40, verbose_name="入口名称")),
                ("url", models.URLField(max_length=500, verbose_name="网址")),
                ("order", models.PositiveIntegerField(default=0, verbose_name="排序")),
                ("is_enabled", models.BooleanField(default=True, verbose_name="启用")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="campus_links", to=settings.AUTH_USER_MODEL, verbose_name="用户")),
            ],
            options={
                "verbose_name": "用户校园快捷入口",
                "verbose_name_plural": "用户校园快捷入口",
                "ordering": ["order", "id"],
                "indexes": [models.Index(fields=["user", "order"], name="user_campus_link_order")],
            },
        ),
    ]
