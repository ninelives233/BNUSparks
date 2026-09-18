# v=270：删除「三自选项课程」历史遗留目录
# 根因：体育与健康类下存在一个 course_text='GEN01203-GEN01250' 的区段目录，
# 课表链接的区段兜底匹配会把它当成 GEN01203~GEN01250 全部体育课的落点，
# 且它在树中排在各门真实体育课（女子形体 GEN01201、武术与强身避险 GEN01242、
# 男子健身健美 GEN01202 等）之前，导致「所有体育课都链接到三自选项课程」。
# 各门体育课如今都有独立目录，该区段目录已无存在价值，直接删除：
#   - CourseCategory：course_text='GEN01203-GEN01250'（名字「三自选项课程」）
#   - Course：code='GEN01203'、名字含「三自选项」的占位记录
#     （仅当其下没有已审核资料时才删，防止误删真实资料）
# 配套前端修复：ttFindPathByCode 中精确/别名代码优先于区段匹配（timetable.js）。
from django.db import migrations


def remove_sanzhi_legacy(apps, schema_editor):
    Course = apps.get_model("materials", "Course")
    CourseCategory = apps.get_model("materials", "CourseCategory")
    # 区段目录（长短两种写法都认，防各环境录入不一致）
    CourseCategory.objects.filter(
        course_text__in=["GEN01203-GEN01250", "GEN01203-01250"]
    ).delete()
    # 占位课程：仅无已审核资料时删除（待审垃圾测试上传随级联清理）
    Course.objects.filter(
        code="GEN01203", name__contains="三自选项"
    ).exclude(materials__is_approved=True).delete()


def rollback(apps, schema_editor):
    pass  # 数据清理不可自动回滚


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0045_userprofile_campus"),
    ]

    operations = [
        migrations.RunPython(remove_sanzhi_legacy, rollback),
    ]
