# 删除 UserProfile.campus（旧课表地点判定口径）：校区分布已改为按身份标签
# 学院在查询时映射 College.campus（见 admin_monitoring._identity_payload），
# 字段再无读取方。回滚本迁移会重建空列（旧判定值不可恢复），无功能影响。

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('materials', '0059_user_tutorial_models'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='userprofile',
            name='campus',
        ),
    ]
