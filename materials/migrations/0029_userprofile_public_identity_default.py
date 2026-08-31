from django.db import migrations, models


def make_identity_public_by_default(apps, schema_editor):
    """身份标签公开开关原本默认关闭，统一迁移到新的默认公开策略。"""
    UserProfile = apps.get_model("materials", "UserProfile")
    UserProfile.objects.filter(show_college_public=False).update(show_college_public=True)
    UserProfile.objects.filter(show_major_public=False).update(show_major_public=True)


class Migration(migrations.Migration):
    dependencies = [
        ("materials", "0028_userprofile_identity_college_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="userprofile",
            name="show_college_public",
            field=models.BooleanField(
                default=True,
                help_text="默认公开，用户可手动关闭",
                verbose_name="公开资料显示学院",
            ),
        ),
        migrations.AlterField(
            model_name="userprofile",
            name="show_major_public",
            field=models.BooleanField(
                default=True,
                help_text="默认公开，用户可手动关闭",
                verbose_name="公开资料显示专业",
            ),
        ),
        migrations.RunPython(make_identity_public_by_default, migrations.RunPython.noop),
    ]
