from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0047_college_campus"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="material",
            index=models.Index(fields=["created_at"], name="material_created_at"),
        ),
        migrations.AddIndex(
            model_name="downloadrecord",
            index=models.Index(fields=["created_at"], name="download_created_at"),
        ),
        migrations.AddIndex(
            model_name="downloadrecord",
            index=models.Index(fields=["activity_type", "created_at"], name="download_activity_created"),
        ),
    ]
