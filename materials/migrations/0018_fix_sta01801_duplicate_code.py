# v=158：修复 STA01801 课程名漂移
# 根因：seed_chemistry.py 中化学学院-化学（励耘项目与强基计划）专业基础课的
# STA01801 应为「统计学导论A」，但 DB 里被误写成「概率论与数理统计」，导致：
#   - 搜索 STA01801 时按 code 去重取先入库的记录，显示错误的课程名；
#   - 而另一门 STA01801（统计学院）本名就是「统计学导论A」。
# 修复：把该 Course 及其 CourseCategory 节点的名字改回「统计学导论A」。
from django.db import migrations


def fix_sta01801_name(apps, schema_editor):
    Course = apps.get_model("materials", "Course")
    CourseCategory = apps.get_model("materials", "CourseCategory")
    # 仅当「统计学导论A」这条正主存在时才处理，避免数据异常时误改
    if not Course.objects.filter(code="STA01801", name="统计学导论A").exists():
        return
    for c in Course.objects.filter(code="STA01801", name="概率论与数理统计"):
        c.name = "统计学导论A"
        c.save(update_fields=["name"])
        # 同步所属分类节点的显示名（课程树叶子节点显示的是 cat.name）
        CourseCategory.objects.filter(course=c, name="概率论与数理统计").update(
            name="统计学导论A"
        )


def rollback(apps, schema_editor):
    pass  # 数据修复不可自动回滚


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0017_coursecreationrequest_auto_approved"),
    ]

    operations = [
        migrations.RunPython(fix_sta01801_name, rollback),
    ]
