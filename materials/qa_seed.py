"""问答区（新生指南）标签池种子 — 幂等 get_or_create，零 model import。

三处复用（模型类由调用方传入，避免 migration 依赖真实 model）：
1. migration 0024 —— 传 apps.get_model() 历史模型，migrate 时自动执行
2. scripts/seed_qa.py —— 传真模型，示例内容逻辑保留在脚本内
3. api_qa_tags 读时同步 —— 后台后续新增学院时自动补 L1 兜底
"""

from django.db.models import Max

L2_TAGS = [
    ("日常学习", "平时上课与期中/期末相关问题，或其他分类未涵盖的学业相关的问题"),
    ("校园生活", "衣食住用、图书馆、校园网、交通医疗、社团活动，以及其他分类未涵盖的生活相关问题"),
    ("科研竞赛", "科研、竞赛、导师"),
    ("转专业", "转专业相关问题"),
    ("选课咨询", "选课操作、退补选、辅修，大类招生的疑惑"),
    ("保研升学", "保本校、保外校、考研、留学申请等"),
    ("就业实习", "考公、考编、国企、私企、实习，校招、简历、职业发展建议等"),
    ("行政事务", "评奖评优、学生工作、请假、毕业、档案"),
]

# 一级标签固定在最前的前缀（用户拍板：通用 → 经济与工商管理学院 → 法学院 → 其余按 id）
SPECIAL_L1_ORDER = ["通用", "经济与工商管理学院", "法学院"]


def seed_qa_tags(QaTag, College, using=None):
    """幂等生成两级标签池：L1 = 通用 + 全部学院，L2 = 8 个固定分类（含括号解释）。

    v175.1：新学院不再用 College.order 当 sort_order（含课程树负偏移，导致法学院排最前）。
    改为追加在现有 L1 尾部；「通用→经济→法学院」固定前缀由 migration 0025 的
    renumber_l1_order 保障（也供脚本手动重排）。

    参数：
      QaTag / College — 模型类（migration 传历史模型，脚本/视图传真模型）
      using — 数据库别名；migration 传 schema_editor.connection.alias，其余默认 None
    返回新增标签数。
    """
    qa_mgr = QaTag.objects.using(using) if using else QaTag.objects
    col_mgr = College.objects.using(using) if using else College.objects
    created = 0

    if not qa_mgr.filter(level=1, name="通用").exists():
        qa_mgr.create(name="通用", level=1, sort_order=0)
        created += 1

    # 新学院标签接在现有 L1 尾部（max+1），避免与「通用=0」及特殊前缀冲突
    max_so = qa_mgr.filter(level=1).aggregate(m=Max("sort_order"))["m"] or 0
    next_so = max_so + 1
    for college in col_mgr.order_by("id"):
        if not qa_mgr.filter(level=1, name=college.name).exists():
            qa_mgr.create(name=college.name, level=1, sort_order=next_so)
            next_so += 1
            created += 1

    for i, (name, desc) in enumerate(L2_TAGS, start=1):
        if not qa_mgr.filter(level=2, name=name).exists():
            qa_mgr.create(name=name, level=2, sort_order=i, description=desc)
            created += 1

    return created


def renumber_l1_order(QaTag, using=None):
    """按「通用 → 经济与工商管理学院 → 法学院 → 其余按 id」重排一级标签 sort_order。

    用户拍板：一级标签默认顺序 = 通用置顶、经济与工商管理学院、法学院、其余按创建序。
    通过 sort_order 实现（不动主键/外键）；migration 0025 与脚本共用。
    """
    qa_mgr = QaTag.objects.using(using) if using else QaTag.objects
    ordered = []
    pinned = [qa_mgr.filter(level=1, name=n).first() for n in SPECIAL_L1_ORDER]
    pinned_ids = {t.id for t in pinned if t}
    for t in pinned:
        if t:
            ordered.append(t)
    for t in qa_mgr.filter(level=1).order_by("id"):
        if t.id not in pinned_ids:
            ordered.append(t)
    changed = 0
    for i, t in enumerate(ordered):
        if t.sort_order != i:
            qa_mgr.filter(pk=t.pk).update(sort_order=i)
            changed += 1
    return changed
