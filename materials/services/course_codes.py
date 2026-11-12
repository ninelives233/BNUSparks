"""Internal codes for graduate courses and safe adoption of a teaching code."""
import hashlib
import re
import unicodedata

from django.db import OperationalError, transaction
from django.db.models import F

from ..models import Course

PREFIX = "BNUX"


def normalized_course_name(name):
    return "".join(unicodedata.normalize("NFKC", str(name)).split()).casefold()


def placeholder_code(college_id, name):
    normalized = normalized_course_name(name)
    digest = hashlib.sha256(f"{college_id}\0{normalized}".encode()).hexdigest()[:32].upper()
    return PREFIX + digest


def is_placeholder(code):
    return bool(re.fullmatch(r"BNUX[0-9A-F]{32}", str(code or "").upper()))


def adopt_course_code(course, supplied):
    """Replace an internal code without moving files or invalidating old links.

    The old code becomes an alias pointing at the same course. Existing material
    file_path values remain authoritative; future uploads use the new code.
    """
    supplied = str(supplied or "").strip().upper()
    if not supplied:
        return course
    if not re.fullmatch(r"[A-Z0-9]{1,50}", supplied) or supplied.startswith(PREFIX):
        raise ValueError("请输入教务系统中的完整课程代码")
    try:
        with transaction.atomic():
            # Acquire SQLite's write lock before the conflict check. Other writers
            # cannot interleave another code assignment inside this transaction.
            Course.objects.filter(pk=course.pk).update(code=F("code"))
            current = Course.objects.get(pk=course.pk)
            if current.code == supplied:
                return current
            if not is_placeholder(current.code):
                raise ValueError("课程代码已更新，请刷新后重试")
            if Course.objects.filter(code__iexact=supplied).exclude(pk=current.pk).exists():
                raise ValueError("该课程代码已有课程，请联系管理员核对后关联")
            old_code = current.code
            current.code = supplied
            current.save(update_fields=["code"])
            Course.objects.create(
                code=old_code, name=current.name, college_id=current.college_id,
                course_type=current.course_type, merged_into=current,
            )
            return current
    except OperationalError as exc:
        raise ValueError("课程信息正在更新，请稍后重试") from exc
