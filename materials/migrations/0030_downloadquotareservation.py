from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0029_userprofile_public_identity_default"),
    ]

    operations = [
        migrations.CreateModel(
            name="DownloadQuotaReservation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("quota_date", models.DateField()),
                ("material", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="materials.material")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        fields=("user", "material", "quota_date"),
                        name="uniq_download_quota_user_material_date",
                    ),
                ],
            },
        ),
    ]
