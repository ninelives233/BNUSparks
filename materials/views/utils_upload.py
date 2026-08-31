"""上传文件的大小校验、临时写入和失败清理辅助。"""

import os
import uuid
from pathlib import Path

from django.conf import settings


class UploadTooLarge(ValueError):
    """上传内容超过服务端硬限制。"""


def _max_upload_size():
    return int(getattr(settings, "MAX_UPLOAD_FILE_SIZE", 50 * 1024 * 1024))


def _check_declared_upload_size(uploaded_file):
    """先检查客户端声明的大小；流式写入时仍会再次累计，不能只信该值。"""
    size = getattr(uploaded_file, "size", None)
    if size is not None and size > _max_upload_size():
        raise UploadTooLarge("文件大小超过 50MB 限制")


def _atomic_write_chunks(uploaded_file, destination):
    """将上传流写入同目录临时文件，完整且未超限后再原子替换到最终路径。"""
    _check_declared_upload_size(uploaded_file)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path = destination.with_name(
        f".{destination.name}.{uuid.uuid4().hex}.uploading"
    )
    total = 0
    try:
        with open(temp_path, "xb") as handle:
            for chunk in uploaded_file.chunks():
                total += len(chunk)
                if total > _max_upload_size():
                    raise UploadTooLarge("文件大小超过 50MB 限制")
                handle.write(chunk)
        os.replace(temp_path, destination)
        return total
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def _atomic_write_text(content, destination):
    """UTF-8 文字录入按字节执行同一硬限制，并用临时文件原子落盘。"""
    payload = (content or "").encode("utf-8")
    if len(payload) > _max_upload_size():
        raise UploadTooLarge("文字内容生成的文件超过 50MB 限制")
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path = destination.with_name(
        f".{destination.name}.{uuid.uuid4().hex}.uploading"
    )
    try:
        with open(temp_path, "xb") as handle:
            handle.write(payload)
        os.replace(temp_path, destination)
        return len(payload)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def _remove_uploaded_file(path):
    """数据库落库失败时补偿删除已经完成原子替换的最终文件。"""
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        pass
