"""BNU Sparks — 一次性的脏数据清理脚本
清理所有版主/小版主中间表中的残留数据。
只在部署 v=23 时运行一次，之后不需要再运行。
用法: python3 manage.py runscript ... 或 python3 scripts/clean_stale_data.py
"""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "bnusparks.settings_prod")

import django
django.setup()

from django.db import connection

with connection.cursor() as c:
    c.execute("DELETE FROM materials_userprofile_managed_majors")
    c.execute("DELETE FROM materials_userprofile_moderated_sections")

    c.execute("SELECT COUNT(*) FROM materials_userprofile_managed_majors")
    mm_count = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM materials_userprofile_moderated_sections")
    ms_count = c.fetchone()[0]

print(f"✅ 清理完成 — managed_majors: {mm_count} 行, moderated_sections: {ms_count} 行")
