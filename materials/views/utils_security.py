"""
BNU Sparks · 木铎星火 — 安全辅助（文件名/目录名清洗、扩展名黑名单、EXIF 清理）
"""

import io
import re
from pathlib import Path

from PIL import Image as PILImage

# ── 文件名/目录名清洗（防路径穿越，S1） ──

def _sanitize_filename_part(name, max_len=40):
    """清洗用户提供的文件名片段：消除路径穿越（/ \\ ..），截断长度，兜底空值。

    所有上传处拼接 safe_name 前必须经过本函数：
        safe_name = f"{uuid}_{_sanitize_filename_part(title)}{ext}"
    """
    if not name:
        return ""
    name = str(name).replace("\\", "/").rsplit("/", 1)[-1]
    if name in ("", ".", ".."):
        return ""
    name = re.sub(r"[\x00-\x1f\x7f]", "", name)
    if len(name) > max_len:
        name = name[:max_len]
    return name


def _safe_dir_name(name, fallback="default"):
    """清洗目录名：仅保留安全字符（字母/数字/-/_/*/中文），防目录穿越。

    course_code 用作 data/materials/ 下的目录名时使用；真实课程代码均为
    字母数字，清洗前后一致，仅对恶意输入（含 / \\ .. 等）生效。
    """
    if not name:
        return fallback
    name = str(name).replace("\\", "/").rsplit("/", 1)[-1]
    name = re.sub(r"[^A-Za-z0-9一-鿿\-_*]", "", name)
    return name.strip(".") or fallback


# ── 上传扩展名黑名单（S8）：可执行/活动内容一律拒绝 ──
# 材料平台用黑名单而非白名单：保留 caj/epub/mob 等生僻合法类型，仅拦截能在
# 源内执行或被当作程序的类型。与 nginx /media/ 移除、预览 inline 限制组合
# 成存储型 XSS 防线。
_BLOCKED_UPLOAD_EXTS = {
    '.html', '.htm', '.shtml', '.xhtml', '.svg',
    '.js', '.mjs', '.php', '.php3', '.php4', '.php5', '.php7', '.phar', '.phtml',
    '.asp', '.aspx', '.ashx', '.jsp', '.jspx', '.exe', '.com', '.bat', '.cmd',
    '.sh', '.bash', '.zsh', '.py', '.pyc', '.pyo', '.pl', '.rb', '.jar', '.dll',
    '.scr', '.vbs', '.ps1', '.msi', '.app', '.reg', '.lnk', '.hta', '.cpl',
    '.wsf', '.gadget', '.deb', '.rpm', '.apk', '.xap', '.swf',
}


def _blocked_upload_ext(ext):
    """扩展名是否在黑名单（小写匹配，含无点前缀容错）。"""
    if not ext:
        return False
    e = str(ext).strip().lower()
    if not e.startswith("."):
        e = "." + e
    return e in _BLOCKED_UPLOAD_EXTS


def _safe_int(value, default=1, lo=None, hi=None):
    """安全解析 int（防非法输入导致 500），越界收敛到 lo/hi。"""
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    if lo is not None and n < lo:
        n = lo
    if hi is not None and n > hi:
        n = hi
    return n


# ═══════════════════════════════════════════════════════════════
# EXIF 清理
# ═══════════════════════════════════════════════════════════════

def _strip_exif(file_path):
    """清除图片文件的 EXIF 元数据（GPS 位置信息等）

    仅处理 JPEG/PNG/WebP 格式，非图片文件静默跳过。
    失败时静默回退，不阻塞上传流程。
    """
    ext = Path(file_path).suffix.lower()
    if ext not in ('.jpg', '.jpeg', '.png', '.webp'):
        return
    try:
        img = PILImage.open(file_path)
        img.load()
        fmt = {'jpg': 'JPEG', 'jpeg': 'JPEG', 'png': 'PNG', 'webp': 'WEBP'}[ext.lstrip('.')]
        save_kwargs = {'format': fmt}
        if fmt == 'JPEG':
            save_kwargs['quality'] = 85
        buf = io.BytesIO()
        img.save(buf, **save_kwargs)
        with open(file_path, 'wb') as f:
            f.write(buf.getvalue())
    except Exception:
        pass


