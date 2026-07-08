#!/usr/bin/env python3
"""
Seed: 课程导航树 — 从 public/js/app.js 读取 COURSE_TREE 并写入 CourseCategory DB

这是导航树的**唯一数据源**。以后改课程分类只需：
1. 修改本脚本中的 tree 字典（或重新从 app.js 提取）
2. 运行 python3 seed_tree.py

API /api/courses/tree 从 CourseCategory 表返回完整树，前端纯渲染。
"""

import re
import json
import django
import os
import sys

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "bnushare.settings")
django.setup()

from materials.models import Course, CourseCategory


# ═══════════════════════════════════════════════════════════════
# 从 app.js 提取并解析 COURSE_TREE
# ═══════════════════════════════════════════════════════════════

def js_to_json(js_str):
    """将 JS 对象/数组字面量转为 JSON"""
    # 1. 去掉行注释
    s = re.sub(r'//.*', '', js_str)

    # 2. 保护 C() 输出（已经是合法 JSON）
    markers = {}

    def protect_c(m):
        inner = m.group(1)
        parts = [p.strip().strip("'\" \t") for p in inner.split(",")]
        name = parts[0]
        code = parts[1] if len(parts) > 1 else ""
        hf = parts[2].strip() if len(parts) > 2 else ""
        has_files = hf == "true"
        obj = json.dumps(
            {"name": name, "courseId": code, "hasFiles": has_files},
            ensure_ascii=False,
        )
        mk = f"__C_{len(markers)}__"
        markers[mk] = obj
        return mk

    s = re.sub(r'\bC\s*\(([^)]+)\)', protect_c, s)

    # 3. 给未引用的 JS 属性名加双引号：{name: → {"name":
    #   这时字符串还是单引号，属性名是裸的
    #   匹配 [{,]\s*word\s*:
    s = re.sub(r'([{,]\s*)(\w[\w_]*)(\s*:)', r'\1"\2"\3', s)

    # 4. 把所有单引号换成双引号
    s = s.replace("'", '"')

    # 5. 恢复 C() 标记
    for mk, val in markers.items():
        s = s.replace(mk, val)

    # 6. 去掉尾逗号
    s = re.sub(r',\s*}', '}', s)
    s = re.sub(r',\s*]', ']', s)

    return s


def extract_const_assignments(text):
    """提取数据区所有 const NAME = value; 赋值"""
    assignments = {}
    # 找到 const NAME = 开始
    pattern = re.compile(r'\bconst\s+(\w+)\s*=\s*')

    idx = 0
    while True:
        m = pattern.search(text, idx)
        if not m:
            break
        name = m.group(1)
        val_start = m.end()

        # 跳过空白
        while val_start < len(text) and text[val_start] in ' \n\r\t':
            val_start += 1

        if val_start >= len(text):
            break

        first = text[val_start]
        if first not in ('[', '{'):
            # 简单值：找 ;
            val_end = text.index(';', val_start)
            assignments[name] = text[val_start:val_end].strip()
            idx = val_end + 1
            continue

        # 找匹配的 ]
        if first == '[':
            close = ']'
        else:
            close = '}'

        depth = 0
        val_end = val_start
        for i in range(val_start, len(text)):
            ch = text[i]
            if ch == first:
                depth += 1
            elif ch == close:
                depth -= 1
                if depth == 0:
                    val_end = i
                    break

        val_str = text[val_start:val_end+1]
        # 去掉结尾的 ;
        while val_end + 1 < len(text) and text[val_end + 1] in ' \t\n\r;':
            val_end += 1

        assignments[name] = val_str
        idx = val_end + 1

    return assignments


def resolve_refs(val, defs, seen=None):
    """递归替换常量引用"""
    if seen is None:
        seen = set()

    # Check if this value references other constants
    # Constants appear as bare words in the JS
    result = val

    # Multiple passes to handle chains (A→B→C)
    changed = True
    while changed:
        changed = False
        for ref_name, ref_val in list(defs.items()):
            if ref_name in seen:
                continue
            # Check if ref_name appears as a word in the result
            # We need to be careful - it could be a substring of another word
            # Pattern: preceded by [space,:,{,[,] and followed by [,space,\n,:,],},;
            pattern = re.compile(
                r'(?<=[\s,:\[\]{\}])\b' + re.escape(ref_name) + r'\b(?=[\s,\]\}:;])'
            )
            if pattern.search(result):
                result = pattern.sub(ref_val, result)
                changed = True

        if len(seen) > 100:  # safety
            break

    return result


def parse_and_build():
    """主入口：读取 app.js → 解析 COURSE_TREE → 写入 DB"""
    js_path = os.path.join(os.path.dirname(__file__), "public/js/app.js")

    with open(js_path) as f:
        js = f.read()

    # 定位数据区
    data_start = js.find("const TONGKE_CATS")
    data_end = js.find("const CARD_ICONS")
    data = js[data_start:data_end]

    # 提取所有常量定义
    raw_defs = extract_const_assignments(data)
    print(f"提取 {len(raw_defs)} 个常量: {', '.join(raw_defs.keys())}")

    # 转换 JS → JSON（每个定义单独转）
    json_defs = {}
    for name, val in raw_defs.items():
        json_defs[name] = js_to_json(val)

    # 解析 COURSE_TREE（需要先 resolve 所有引用）
    COURSE_TREE_str = json_defs.get("COURSE_TREE", "{}")
    resolved = resolve_refs(COURSE_TREE_str, json_defs)

    try:
        tree = json.loads(resolved)
        print(f"✓ COURSE_TREE 解析成功")
        return tree
    except json.JSONDecodeError as e:
        print(f"✗ JSON 解析失败: {e}")
        print(f"  请检查 resolved 内容前 500 字符:")
        print(resolved[:500])
        return None


# ═══════════════════════════════════════════════════════════════
# 写入 DB
# ═══════════════════════════════════════════════════════════════

def build_tree(tree_dict, parent=None):
    """递归创建 CourseCategory 记录"""
    count = 0

    if isinstance(tree_dict, list):
        items = tree_dict
    elif isinstance(tree_dict, dict):
        # 顶层对象：遍历 values
        items = []
        for name, val in tree_dict.items():
            node = {"name": name}
            if isinstance(val, dict) and "children" in val:
                node["children"] = val["children"]
            elif isinstance(val, list):
                node["children"] = val
            items.append(node)
    else:
        return 0

    for i, item in enumerate(items):
        if not isinstance(item, dict):
            continue

        if "divider" in item and item["divider"]:
            cat = CourseCategory.objects.create(
                parent=parent, order=i,
                is_divider=True,
            )
            count += 1
            continue

        cat = CourseCategory.objects.create(
            parent=parent,
            name=item.get("name", ""),
            icon_class=item.get("iconClass", ""),
            order=i,
            is_math_card=item.get("mathCard", False),
        )
        count += 1

        # 叶子节点：关联课程
        if "courseId" in item:
            code = item["courseId"]
            if "*" in code or "-" in code or code == "" or code == "None":
                # 通配符代码
                cat.course_text = code
                cat.save()
            else:
                try:
                    course = Course.objects.get(code=code)
                    cat.course = course
                    cat.save()
                except Course.DoesNotExist:
                    print(f"  ⚠ 课程不存在: {code}（{item.get('name','')}）")
                    cat.course_text = code
                    cat.save()
        elif "children" in item:
            count += build_tree(item["children"], parent=cat)

    return count


def main():
    print("🌳 重建课程导航树...")
    print()

    # 清空已有
    CourseCategory.objects.all().delete()
    print("  已清空旧树")

    # 解析
    tree = parse_and_build()
    if tree is None:
        sys.exit(1)

    print()

    # 写入 DB
    total = build_tree(tree)

    print(f"\n✅ 课程导航树重建完成！共 {total} 个节点")
    print(f"   数据库: CourseCategory 表共 {CourseCategory.objects.count()} 条记录")


if __name__ == "__main__":
    main()
