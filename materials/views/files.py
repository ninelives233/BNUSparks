"""
BNU Sparks · 木铎星火 — 文件 API（薄 facade）

file-upload, upload-text, download-token, download, delete, zip-structure
本文件为薄重导出层：全部实现拆入 files_upload / files_download / files_delete / files_zip。
显式重导出全部顶层符号（含下划线私有函数与常量），保持既有调用面不变
（urls.py、materials/views/__init__.py 与测试 `from materials.views import files` 均依赖本层）。
"""

# 文件上传
from .files_upload import (
    api_file_upload, api_file_upload_text,
)

# 文件下载 / 预览（含 X-Accel 文件服务）
from .files_download import (
    api_download_token, api_file_download,
    _INLINE_SAFE_MIME, _content_disposition_header,
    _serve_file_response, _increment_download,
    HAS_PYPDF,
)

# 文件删除 / 详情
from .files_delete import (
    api_file_delete, api_file_detail,
    _scope_matched_moderators,
)

# ZIP 结构预览 / 文件名解码 / 侧车缓存
from .files_zip import (
    api_zip_structure,
    _ZIP_CACHE_MAX, _ZIP_SCAN_MAX, _ZIP_MAX_DEPTH, _ZIP_NAME_ENCODINGS,
    _zip_name_score, _zip_utf8_trustworthy, _decode_zip_name,
    _is_zip_slip, _is_zip_metadata,
    _pdf_preview_cache_path, _zip_structure_cache_path,
)
