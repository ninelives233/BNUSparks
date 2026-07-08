#!/usr/bin/env python3
"""
批量导入压缩包资料到 BNU Sparks 数据库

从 data/资料的压缩包们/ 读取 zip/文件夹，
逐一解压 → 复制到 data/materials/<course_code>/ → 创建数据库记录。

用法: python3 import_archives.py
"""

import os
import re
import uuid
import shutil
import zipfile
import tempfile
from pathlib import Path

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "bnusparks.settings")
django.setup()

from materials.models import Course, Material

BASE = Path(__file__).resolve().parent / "data"
MATERIALS_DIR = BASE / "materials"
ZIP_SRC = BASE / "资料的压缩包们"

uploader_name = "admin"

# ═══════════════════════════════════════════════════════════════
# 课程映射：来源路径关键字 → 现有课程
# ═══════════════════════════════════════════════════════════════
COURSE_MAP = [
    # (路径关键字, 课程代码, 课程名, 类型)
    ("法理学导论",     "LAW01001", "法理学导论",       "major"),
    ("民法总论",       "LAW11002", "民法总论",         "major"),
    ("习近平法治思想", "LAW01003", "习近平法治思想概论", "major"),
    ("法治思想概论",     "LAW01003", "习近平法治思想概论", "major"),  # 简写别名
    ("债与合同法学",   "LAW11003", "债与合同法学",     "major"),
    ("计算思维导论",   "GEN04238", "计算思维导论",     "general"),
    ("教育心理学",     "GEN06121", "教育心理学",       "general"),
    ("军事理论",       "GEN01108", "军事理论",         "general"),
    ("军理",           "GEN01108", "军事理论",         "general"),  # 别名
]


def find_course(keyword):
    """根据关键字匹配课程，匹配整个关键字（支持长路径和文件名）"""
    best = None
    best_len = 0
    for kw, code, name, ctype in COURSE_MAP:
        if kw in keyword and len(kw) > best_len:
            best = (code, name, ctype)
            best_len = len(kw)
    if best:
        code, name, ctype = best
        try:
            return Course.objects.get(code=code)
        except Course.DoesNotExist:
            course = Course.objects.create(
                code=code, name=name, course_type=ctype,
            )
            print(f"  ✨ 创建课程: {code} {name}")
            return course
    return None


# ═══════════════════════════════════════════════════════════════
# Zip 解压（处理 GBK 编码）
# ═══════════════════════════════════════════════════════════════

def _try_decode_name(raw_name: str) -> str:
    """
    尝试将 ZipInfo 中的文件名正确解码。
    很多国内 zip 使用 GBK 编码但没有正确设置语言标志位，
    导致 Python zipfile 按 CP437 读取。
    """
    # 如果已经是可读的中文（含 CJK 字符），直接返回
    if re.search(r'[一-鿿]', raw_name):
        return raw_name

    # 尝试 CP437 → GBK 双转码
    try:
        cp437_bytes = raw_name.encode("cp437")
        decoded = cp437_bytes.decode("gbk")
        if re.search(r'[一-鿿]', decoded):
            return decoded
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass

    # 尝试 CP437 → UTF-8
    try:
        cp437_bytes = raw_name.encode("cp437")
        decoded = cp437_bytes.decode("utf-8")
        if re.search(r'[一-鿿]', decoded):
            return decoded
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass

    # 退回到原样
    return raw_name


def extract_zip(zip_path: Path) -> list[Path]:
    """解压 zip 到临时目录，返回文件列表（已正确处理编码）"""
    tmp = Path(tempfile.mkdtemp(prefix="bnusparks_"))

    try:
        with zipfile.ZipFile(zip_path, "r") as z:
            for info in z.infolist():
                if info.is_dir():
                    continue

                # 解码文件名
                decoded = _try_decode_name(info.filename)

                # 过滤
                base = decoded.split("/")[-1] if "/" in decoded else decoded
                if not base or base.startswith("._") or base == ".DS_Store":
                    continue
                if decoded.startswith("__MACOSX") or "/__MACOSX" in decoded:
                    continue

                dest = tmp / base
                if dest.exists():
                    stem, ext = dest.stem, dest.suffix
                    dest = tmp / f"{stem}_{uuid.uuid4().hex[:4]}{ext}"

                try:
                    with z.open(info) as src, open(dest, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                except Exception as e:
                    print(f"    ⚠ 提取失败: {info.filename} → {e}")
                    continue

        files = sorted(tmp.iterdir())
        if files:
            print(f"    ✅ 提取 {len(files)} 个文件")
            return files
        else:
            shutil.rmtree(tmp, ignore_errors=True)
            return []

    except Exception as e:
        print(f"    ❌ 解压失败: {e}")
        shutil.rmtree(tmp, ignore_errors=True)
        return []


# ═══════════════════════════════════════════════════════════════
# 文件导入单个课程
# ═══════════════════════════════════════════════════════════════

def import_files(course: Course, files: list[Path]) -> int:
    """将文件列表导入到指定课程，返回成功数"""
    course_code = course.code
    dest_dir = MATERIALS_DIR / course_code
    dest_dir.mkdir(parents=True, exist_ok=True)

    count = 0
    for src_path in files:
        if not src_path.exists():
            continue

        ext = src_path.suffix
        stem = src_path.stem

        # 生成安全的存储文件名
        safe_name = f"{uuid.uuid4().hex[:12]}_{stem[:40]}{ext}"
        dest_path = dest_dir / safe_name

        try:
            shutil.copy2(src_path, dest_path)
        except Exception as e:
            print(f"    ❌ 复制失败: {src_path.name} → {e}")
            continue

        file_size = dest_path.stat().st_size

        # 判断文件类型
        ext_lower = ext.lower()
        if ext_lower == ".pdf":
            file_type = "PDF"
        elif ext_lower in (".pptx", ".ppt"):
            file_type = "课件"
        elif ext_lower in (".doc", ".docx"):
            file_type = "文档"
        elif ext_lower in (".xls", ".xlsx"):
            file_type = "表格"
        elif ext_lower in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
            file_type = "图片"
        elif ext_lower in (".md", ".txt"):
            file_type = "文本"
        elif ext_lower in (".heic",):
            file_type = "图片"
        else:
            file_type = "其他"

        Material.objects.create(
            course=course,
            title=stem,
            description="",
            file_name=src_path.name,
            file_path=f"{course_code}/{safe_name}",
            file_size=file_size,
            file_type=file_type,
            uploader_name=uploader_name,
            is_approved=True,
        )
        count += 1

    print(f"    ✅ 导入 {count} 个文件到 [{course.code}] {course.name}")
    return count


# ═══════════════════════════════════════════════════════════════
# 主流程
# ═══════════════════════════════════════════════════════════════

def main():
    if not ZIP_SRC.exists():
        print(f"❌ 目录不存在: {ZIP_SRC}")
        return

    total = 0
    # 遍历所有 zip 和文件夹
    for root, dirs, files in os.walk(ZIP_SRC):
        rel = os.path.relpath(root, ZIP_SRC)
        if rel == ".":
            continue

        # 如果这个目录没有 zip 文件，跳过
        zips = sorted(f for f in files if f.endswith(".zip"))
        if not zips:
            continue

        # 目录级课程匹配
        dir_course = find_course(rel)

        print(f"\n📁 {rel}")

        # 逐文件处理——每个 zip 单独匹配课程
        for f in zips:
            zip_path = Path(root) / f
            zip_size = zip_path.stat().st_size // 1024

            # 先尝试文件级匹配，再退回目录级
            course = find_course(f)
            if course is None:
                course = dir_course

            if course is None:
                print(f"  ⚠ 跳过（未匹配课程）: {f}")
                continue

            print(f"  📦 {f} ({zip_size}KB) → [{course.code}] {course.name}")
            extracted = extract_zip(zip_path)
            if extracted:
                n = import_files(course, extracted)
                total += n
                # 清理临时文件
                parent = extracted[0].parent
                shutil.rmtree(parent, ignore_errors=True)

    print(f"\n{'='*50}")
    print(f"🎉 全部完成！共导入 {total} 个文件")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
