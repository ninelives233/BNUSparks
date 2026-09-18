from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0044_grad_mobile_nav_burger"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="campus",
            field=models.CharField(
                choices=[
                    ("unknown", "未判定"),
                    ("beijing", "北京校区"),
                    ("zhuhai", "珠海校区"),
                ],
                db_index=True,
                default="unknown",
                max_length=10,
                verbose_name="校区",
            ),
        ),
    ]
