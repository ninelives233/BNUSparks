from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0031_alter_downloadrecord_material"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="identity_education",
            field=models.CharField(
                blank=True,
                choices=[("本科", "本科"), ("硕士", "硕士"), ("博士", "博士"), ("其他", "其他")],
                default="",
                max_length=10,
                verbose_name="培养层次",
            ),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="show_education_public",
            field=models.BooleanField(
                default=True,
                help_text="默认公开，用户可手动关闭",
                verbose_name="公开资料显示培养层次",
            ),
        ),
        migrations.AddField(
            model_name="downloadrecord",
            name="activity_type",
            field=models.CharField(
                choices=[("legacy", "旧下载记录"), ("download", "下载"), ("preview", "预览")],
                default="legacy",
                max_length=12,
                verbose_name="行为类型",
            ),
        ),
        migrations.AddField(
            model_name="downloadrecord",
            name="request_id",
            field=models.CharField(
                blank=True,
                help_text="同一短时下载令牌重复请求时用于幂等去重",
                max_length=64,
                null=True,
                unique=True,
                verbose_name="行为请求编号",
            ),
        ),
    ]
