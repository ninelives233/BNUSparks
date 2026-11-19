"""修复学院表历史负排序偏移：经济与工商管理学院 order=-1 置顶，清理异常负 order。

此前仅在 qa_seed（0025）修复了问答标签 sort_order，未同步修正生产库
materials_college 中法学院的历史 order=-184，导致按 College.order 排序的
/api/colleges/、/api/majors/ 等接口把法学院排在经管前面。本迁移从数据源头
统一修正，前后端直接信任 College.order，不再各自打字符串补丁。
"""

from django.db import migrations


def fix_college_order(apps, schema_editor):
    College = apps.get_model("materials", "College")
    db = schema_editor.connection.alias
    College.objects.using(db).filter(name="经济与工商管理学院").update(order=-1)
    College.objects.using(db).filter(name="法学院", order__lt=0).update(order=2)
    College.objects.using(db).exclude(name="经济与工商管理学院").filter(order__lt=0).update(order=0)


class Migration(migrations.Migration):
    dependencies = [
        ("materials", "0062_coursecategory_education_level_and_more"),
    ]

    operations = [
        migrations.RunPython(fix_college_order, migrations.RunPython.noop),
    ]
