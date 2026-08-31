"""
BNU Sparks · 木铎星火 — 软删除暂存辅助（D18：48h 暂存 + 硬删清理）
"""

import shutil
import time
import uuid
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.db import transaction

from ..models import DeletionRecord

# ═══════════════════════════════════════════════════════════════
# 软删除暂存（D18）：删除时物理文件移入 data/trash/，48h 内可恢复，超期硬删
# ═══════════════════════════════════════════════════════════════

# 暂存保留时长：与「恢复窗口」一致（48h）。暂存文件超过该时长即被硬删。
TRASH_RETENTION = timedelta(hours=48)


class TrashStageError(OSError):
    """物理文件存在但无法移入暂存区；此时不得继续删除数据库记录。"""


def _trash_dir():
    """暂存目录（MEDIA_ROOT/trash），相对路径语义与 Material.file_path 一致。"""
    d = Path(settings.MEDIA_ROOT) / "trash"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _stage_file_to_trash(material):
    """把 material 的物理文件移入暂存区。

    返回 MEDIA_ROOT 相对路径（如 "trash/123_ab12cd34_xxx.pdf"）；
    原文件缺失返回 ""（兼容历史幽灵记录）；文件存在但移动失败则抛出
    TrashStageError，调用方必须终止数据库删除。
    """
    if not material.file_path:
        return ""
    src = Path(settings.MEDIA_ROOT) / material.file_path
    if not src.is_file():
        return ""
    name = f"{material.id}_{uuid.uuid4().hex[:8]}_{src.name}"
    dst = _trash_dir() / name
    try:
        shutil.move(str(src), str(dst))
    except OSError as exc:
        raise TrashStageError("文件无法移入暂存区") from exc
    return f"trash/{name}"


def _restore_staged_file(trash_rel, original_rel):
    """数据库事务失败时，将已暂存文件补偿移回原路径。"""
    if not trash_rel or not original_rel:
        return
    staged = Path(settings.MEDIA_ROOT) / trash_rel
    original = Path(settings.MEDIA_ROOT) / original_rel
    if not staged.is_file():
        return
    original.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(staged), str(original))


def _purge_expired_trash():
    """硬删暂存区中超过 TRASH_RETENTION 的文件（幂等，无文件时静默跳过）。"""
    d = Path(settings.MEDIA_ROOT) / "trash"
    if not d.is_dir():
        return
    now = time.time()
    for f in d.iterdir():
        try:
            if f.is_file() and now - f.stat().st_mtime > TRASH_RETENTION.total_seconds():
                f.unlink()
        except OSError:
            pass


def _perform_soft_delete(material, deleted_by, delete_reason=""):
    """软删除单一资料（举报处理 action=delete 路径复用）。

    建 DeletionRecord（含冗余字段）→ 物理文件移入暂存 → material.delete()。
    返回 (record, trash_rel)。物理文件本就缺失时 trash_rel=""；文件存在但
    移动失败会抛错并保留 Material。material.delete() 触发
    post_delete 信号自动失效课程树/统计缓存并 bump 上传者公开页代际。
    """
    # v=182：原子提交，杜绝「记录已建但行未删」的幽灵残留。
    # 文件系统不参与 DB 事务，提交失败时还需显式移回原文件。
    trash_rel = ""
    original_rel = material.file_path
    try:
        with transaction.atomic():
            dr = DeletionRecord.objects.create(
                material_id=material.id,
                title=material.title,
                file_name=material.file_name,
                file_size=material.file_size,
                course_code=material.course.code if material.course else "",
                course_name=material.course.name if material.course else "",
                college_id=material.course.college_id if material.course and material.course.college else None,
                uploader_name=material.uploader_name or (material.uploader.first_name if material.uploader else "匿名"),
                deleted_by=deleted_by,
                delete_reason=delete_reason,
            )
            trash_rel = _stage_file_to_trash(material)
            if trash_rel:
                dr.trash_path = trash_rel
                dr.save(update_fields=["trash_path"])
            material.delete()
    except Exception:
        if trash_rel:
            try:
                _restore_staged_file(trash_rel, original_rel)
            except OSError:
                pass
        raise
    return dr, trash_rel
