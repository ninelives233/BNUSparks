#!/usr/bin/env python3
"""
批量导入本地资料到 BNU Sparks 数据库

从 data/大一上/ 和 data/大一下/ 读取文件夹和文件，
映射到对应课程，复制文件到 data/materials/，创建数据库记录。
"""

import os
import uuid
import shutil
from pathlib import Path

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "bnushare.settings")
django.setup()

from django.contrib.auth.models import User
from materials.models import College, Course, Material

BASE = Path(__file__).resolve().parent / "data"
MATERIALS_DIR = BASE / "materials"

# ── 文件夹 → 课程映射 ─────────────────────────────────
FOLDER_MAP = {
    "大一上": {
        "世界金融史":       {"code": "ECO21001", "type": "major", "college": "经济与工商管理学院", "name": "世界金融史"},
        "微观经济学原理":   {"code": "ECO01001", "type": "major", "college": "经济与工商管理学院", "name": "微观经济学原理"},
        "教育学":           {"code": "GEN06120", "type": "general", "college": None, "name": "教育学"},
        "现代教育技术":     {"code": "GEN06122", "type": "general", "college": None, "name": "现代教育技术", "skip": True},
        "社会主义经济理论": {"code": "ECO11001", "type": "major", "college": "经济与工商管理学院", "name": "社会主义经济理论"},
        "通用英语进阶":     {"code": "GEN02122", "type": "general", "college": None, "name": "通用英语进阶"},
    },
    "大一下": {
        "会计学":           {"code": "ECO12002", "type": "major", "college": "经济与工商管理学院", "name": "会计学"},
        "军事理论":         {"code": "GEN01108", "type": "general", "college": None, "name": "军事理论"},
        "博雅英语听说":     {"code": "GEN02123", "type": "general", "college": None, "name": "博雅英语听说"},
        "宏观经济学原理":   {"code": "ECO01002", "type": "major", "college": "经济与工商管理学院", "name": "宏观经济学原理"},
        "微积分ll":         {"code": "MAT01007", "type": "major", "college": "经济与工商管理学院", "name": "微积分II"},
        "教育心理学":       {"code": "GEN06121", "type": "general", "college": None, "name": "教育心理学"},
    },
}

# 上传者（使用 admin 账号）
uploader_name = "admin"


def get_or_create_course(info):
    """获取或创建课程记录"""
    try:
        return Course.objects.get(code=info["code"])
    except Course.DoesNotExist:
        college = None
        if info.get("college"):
            college, _ = College.objects.get_or_create(name=info["college"])
        course = Course.objects.create(
            code=info["code"],
            name=info["name"],
            course_type=info["type"],
            college=college,
        )
        print(f"  ✨ 创建课程: {info['code']} {info['name']}")
        return course


def import_folder(semester, folder_name, info):
    """导入一个文件夹中的所有文件"""
    src_dir = BASE / semester / folder_name
    if not src_dir.exists():
        print(f"  ⚠ 目录不存在: {src_dir}")
        return 0

    # 收集所有文件（递归，跳过 .DS_Store）
    files = []
    for root, _, filenames in os.walk(src_dir):
        for f in filenames:
            if f == ".DS_Store" or f.startswith("._"):
                continue
            full_path = Path(root) / f
            files.append(full_path)

    if not files:
        # 可能是空文件夹或者 skip 标记
        if info.get("skip"):
            print(f"  ⏭ {folder_name}: 标记为跳过")
        else:
            print(f"  ⚠ {folder_name}: 无文件")
        return 0

    course = get_or_create_course(info)
    course_code = info["code"]

    count = 0
    for src_path in sorted(files, key=lambda p: p.name):
        # 生成目标路径
        ext = src_path.suffix
        # 从文件名推断标题（去掉扩展名和序号前缀）
        stem = src_path.stem
        title = stem
        # 如果文件名以数字序号开头（如 "第10讲"、"1_导论"），保留原样
        # 生成安全的存储文件名
        safe_name = f"{uuid.uuid4().hex[:12]}_{stem[:40]}{ext}"
        dest_dir = MATERIALS_DIR / course_code
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_path = dest_dir / safe_name

        # 复制文件
        try:
            shutil.copy2(src_path, dest_path)
        except Exception as e:
            print(f"  ❌ 复制失败: {src_path.name} → {e}")
            continue

        file_size = dest_path.stat().st_size

        # 判断文件类型
        ext_lower = ext.lower()
        if ext_lower in (".pdf",):
            file_type_name = "PDF"
        elif ext_lower in (".pptx", ".ppt"):
            file_type_name = "课件"
        elif ext_lower in (".doc", ".docx"):
            file_type_name = "文档"
        elif ext_lower in (".xls", ".xlsx"):
            file_type_name = "表格"
        elif ext_lower in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
            file_type_name = "图片"
        elif ext_lower in (".md", ".txt"):
            file_type_name = "文本"
        else:
            file_type_name = "其他"

        # 创建 Material 记录
        material = Material.objects.create(
            course=course,
            title=title,
            description="",
            file_name=src_path.name,
            file_path=f"{course_code}/{safe_name}",
            file_size=file_size,
            file_type=file_type_name,
            uploader_name=uploader_name,
            is_approved=True,
        )

        count += 1
        # 每 10 个文件输出一次进度
        if count % 10 == 0:
            print(f"  ✓ 已导入 {count} 个文件...")

    print(f"  ✅ {folder_name}: 导入 {count} 个文件")
    return count


# ── 主流程 ─────────────────────────────────────

def main():
    total = 0
    for semester in ["大一上", "大一下"]:
        print(f"\n{'='*50}")
        print(f"📂 {semester}")
        print(f"{'='*50}")
        folders = FOLDER_MAP.get(semester, {})
        for folder_name, info in folders.items():
            print(f"\n📁 {folder_name} ({info['code']})")
            count = import_folder(semester, folder_name, info)
            total += count

    print(f"\n{'='*50}")
    print(f"🎉 导入完成！共导入 {total} 个文件")
    print(f"{'='*50}")
    print(f"\n文件存储在: data/materials/")
    print(f"数据库记录已创建，可直接在网站访问。")


if __name__ == "__main__":
    main()
