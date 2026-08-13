"""一级标签排序修复（v175.1）：用户拍板默认顺序 = 通用 → 经济与工商管理学院 → 法学院 → 其余按 id。

根因：seed_qa_tags 曾把 College.order 直接当标签 sort_order（含课程树负偏移，
法学院 order=-184 排最前），导致「通用」落在第 2 位。本迁移用 renumber_l1_order
重排 sort_order（不动主键/外键）。幂等，可重复执行。
"""

from django.db import migrations

from ..qa_seed import renumber_l1_order


def fix_l1_order(apps, schema_editor):
    QaTag = apps.get_model("materials", "QaTag")
    renumber_l1_order(QaTag, using=schema_editor.connection.alias)


class Migration(migrations.Migration):
    dependencies = [
        ("materials", "0024_qa_tags_seed"),
    ]

    operations = [
        migrations.RunPython(fix_l1_order, migrations.RunPython.noop),
    ]
