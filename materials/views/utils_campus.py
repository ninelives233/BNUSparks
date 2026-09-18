"""校区判定：从课表数据的上课地点关键词推断用户所在校区。

珠海校区教学楼：乐育楼、励教楼、丽泽楼、弘文楼、理工楼（理工N号楼）、
元白楼、风雨操场；励耘楼为原珠海分校时期建筑名，现仍只在珠海出现。
北京校区特征地点：昌平校区（教一/教二/教学综合楼）、邱季端体育馆、
后主楼、敬文讲堂（邱季端内）、教X楼全称、科技楼、生地楼等。
两边都命不中的（如「在线教学」「校内实践」）返回 unknown，不做猜测。
"""

import re

# 命中任一即判为珠海校区；理工N号楼用正则避免误伤其他含「理工」的地点
_ZHUHAI_PATTERNS = (
    re.compile(r"乐育"),
    re.compile(r"励耘"),
    re.compile(r"励教"),
    re.compile(r"丽泽"),
    re.compile(r"弘文"),
    re.compile(r"元白"),
    re.compile(r"风雨操场"),
    re.compile(r"理工\d+号楼"),
)

_BEIJING_PATTERNS = (
    re.compile(r"昌平"),
    re.compile(r"邱季端"),
    re.compile(r"后主楼"),
    re.compile(r"敬文"),
    re.compile(r"生地楼"),
    re.compile(r"化学楼"),
    re.compile(r"科技楼"),
    re.compile(r"京师"),
    re.compile(r"主楼"),
    re.compile(r"育荣"),
)


def _iter_location_texts(data):
    """汇总课表里所有可能含地点的文本：meetings.room 与 timeRaw。"""
    for course in (data or {}).get("courses", []) or []:
        if not isinstance(course, dict):
            continue
        raw = course.get("timeRaw")
        if isinstance(raw, str) and raw:
            yield raw
        for meeting in course.get("meetings", []) or []:
            if isinstance(meeting, dict):
                room = meeting.get("room")
                if isinstance(room, str) and room:
                    yield room


def detect_campus(data):
    """返回 'zhuhai' | 'beijing' | 'unknown'。珠海特征优先级最高。"""
    texts = list(_iter_location_texts(data))
    for pattern in _ZHUHAI_PATTERNS:
        if any(pattern.search(text) for text in texts):
            return "zhuhai"
    for pattern in _BEIJING_PATTERNS:
        if any(pattern.search(text) for text in texts):
            return "beijing"
    return "unknown"


def update_user_campus(user, data):
    """课表导入/覆盖后同步判定结果；unknown 不覆盖已有判定。"""
    if user is None:
        return
    campus = detect_campus(data)
    if campus == "unknown":
        return
    profile = getattr(user, "profile", None)
    if profile is None or profile.campus == campus:
        return
    profile.campus = campus
    profile.save(update_fields=["campus"])
