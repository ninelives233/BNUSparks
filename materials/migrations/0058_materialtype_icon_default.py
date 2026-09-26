from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0057_userprofile_campus_links_mode_and_usercampuslink"),
    ]

    operations = [
        migrations.AlterField(
            model_name="materialtype",
            name="icon",
            field=models.CharField(blank=True, default="", max_length=20, verbose_name="图标"),
        ),
    ]
