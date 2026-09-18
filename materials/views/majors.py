"""BNU Sparks — 专业目录 API（v259 身份标签三级联动数据源；v267 本科条目带所属系）"""

from django.core.cache import cache

from .utils import _ok
from ..models import Major

# 目录结构版本：建库口径调整时 +1，让 600s 缓存立即失效
# v2：本科条目由字符串改为 {name, department?}
MAJORS_CATALOG_CACHE_KEY = "api_majors_data_v2"

_TRACK_FIELD = "track"
_DEPT_FIELD = "department"


def _build_catalog():
    """全量构建 层次→学院→专业 嵌套结构；学院按 College.order 排序。

    本科：条目为 {name, department?}（department=系建制，如文理学院中文系；
    仅建库时挂了系的学院才有该字段，前端无系平铺、有系按系 optgroup 分组）；
    硕博：条目为 {name, track}，track ∈ academic（学硕/学博）| professional（专硕/专博）。
    """
    result = {}
    grad_levels = set()
    majors = (
        Major.objects.filter(is_active=True)
        .select_related("college")
        .order_by("college__order", "college__id", "order", "id")
    )
    for major in majors:
        level_bucket = result.setdefault(major.level, {})
        entry = {"name": major.name}
        if major.level == Major.Level.UNDERGRADUATE:
            if major.department:
                entry[_DEPT_FIELD] = major.department
        else:
            grad_levels.add(major.level)
            entry[_TRACK_FIELD] = major.track or Major.Track.ACADEMIC
        level_bucket.setdefault(major.college.name, []).append(entry)
    # 硕博学位类型分组内排序：学硕（academic）在前、专硕（professional）在后
    for level in grad_levels:
        for entries in result[level].values():
            entries.sort(key=lambda e: 0 if e[_TRACK_FIELD] == Major.Track.ACADEMIC else 1)
    return result


def api_majors(request):
    """GET /api/majors/ — 身份标签选项目录（公开；缓存600s）。

    可选参数 level=本科|硕士|博士 只返回对应层次；缺省返回全部三层。
    """
    catalog = cache.get(MAJORS_CATALOG_CACHE_KEY)
    if catalog is None:
        catalog = _build_catalog()
        cache.set(MAJORS_CATALOG_CACHE_KEY, catalog, 600)

    level = request.GET.get("level", "")
    if level and level in Major.Level.values:
        return _ok({level: catalog.get(level, {})})
    return _ok(catalog)
