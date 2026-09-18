"""将现有硕士、博士账号的移动端导航统一为汉堡菜单。"""

from django.db import migrations


def set_grad_mobile_nav_to_burger(apps, schema_editor):
    UserProfile = apps.get_model("materials", "UserProfile")
    UserProfile.objects.filter(
        identity_education__in=["硕士", "博士"],
    ).update(mobile_nav="burger")


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0043_major"),
    ]

    operations = [
        migrations.RunPython(set_grad_mobile_nav_to_burger, migrations.RunPython.noop),
    ]
