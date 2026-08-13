"""问答区标签池种子（v175）：migrate 时自动种 L1（通用+学院）+ L2（8 个固定分类）。

根治 v174「生产没跑 seed_qa.py → 标签显示不出来」。幂等 get_or_create；
只种标签不种示例帖子（避免生产自动灌假内容）。后台后续新增学院由 api_qa_tags
读时同步兜底（见 views/qa.py _ensure_qa_l1_tags）。
"""

from django.db import migrations

from ..qa_seed import seed_qa_tags


def seed_tags(apps, schema_editor):
    QaTag = apps.get_model("materials", "QaTag")
    College = apps.get_model("materials", "College")
    seed_qa_tags(QaTag, College, using=schema_editor.connection.alias)


class Migration(migrations.Migration):
    dependencies = [
        ("materials", "0023_qaaskclickdaily_qatag_userprofile_can_moderate_qa_and_more"),
    ]

    operations = [
        migrations.RunPython(seed_tags, migrations.RunPython.noop),
    ]
