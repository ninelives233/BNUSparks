from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0030_downloadquotareservation"),
    ]

    operations = [
        migrations.AlterField(
            model_name="downloadrecord",
            name="material",
            field=models.ForeignKey(
                blank=True,
                help_text="资料删除后保留下载快照，material 置空",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                to="materials.material",
                verbose_name="关联资料",
            ),
        ),
    ]
