"""
BNU Sparks · 木铎星火 — ZIP 结构预览 / 文件名解码 / 预览缓存 API

zip-structure, zip 文件名多编码解码, PDF/zip 侧车缓存
"""

import hashlib
import json
import os
import unicodedata
from pathlib import Path

from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings

# 良性循环引用：files 为薄 facade，本模块经它读取可被测试 mock 的
# _ZIP_SCAN_MAX / _ZIP_MAX_DEPTH / _ZIP_CACHE_MAX（test_zip_structure 以
# files_views._ZIP_SCAN_MAX 打补丁）。仅运行时访问，无导入期属性依赖。
from . import files as _facade
from .utils import (
    _err, _ok, _get_user,
    _check_moderator_access,
    Material,
)


_ZIP_CACHE_MAX = 5000   # 单次响应条目上限（超过截断提示；正常课程资料远低于此）
_ZIP_SCAN_MAX = 20000   # 中央目录扫描硬上限（防超大压缩包/目录膨胀拖垮解析）
_ZIP_MAX_DEPTH = 32     # 最大目录层级（超深视为异常结构丢弃）
_ZIP_NAME_ENCODINGS = ("utf-8", "gb18030", "cp437", "iso-8859-1")


def _zip_name_score(text):
    """对非 UTF-8 候选的解码结果启发式打分，越高越像真实文件名。

    - U+FFFD 替换符（解码失败残留）→ 判死刑
    - 控制字符 → 强扣分
    - CJK 汉字 → 加分（中文课程资料主流）
    - Latin-1 重音/符号区 → 扣分（UTF-8 中文被 cp437/ISO 误读的乱码特征）
    - 希腊/西里尔等罕见脚本（U+0370–U+1FFF）→ 重扣分（GBK 字节被 UTF-8 误读的产物）
    """
    if "�" in text:
        return -100000
    cjk = ctrl = latin = rare = symbol = 0
    for ch in text:
        cat = unicodedata.category(ch)
        cp = ord(ch)
        if cat == "Cc":
            ctrl += 1
        elif "一" <= ch <= "鿿":
            cjk += 1
        elif 0x00A1 <= cp <= 0x024F:
            latin += 1
        elif 0x0370 <= cp <= 0x1FFF:
            rare += 1
        elif cat == "So":
            symbol += 1
    return cjk * 3 - ctrl * 100 - latin * 2 - rare * 30 - symbol


def _zip_utf8_trustworthy(text):
    """UTF-8 严格解码结果是否可信：无替换符/控制符/罕见脚本。

    GBK 归档的名字被当 UTF-8 严格解码时通常直接抛 UnicodeDecodeError，
    少数恰好合法的会解出西里尔/希腊等罕见脚本 —— 用此门把关，可信才采信。
    """
    if "�" in text:
        return False
    for ch in text:
        cp = ord(ch)
        if unicodedata.category(ch) == "Cc":
            return False
        if 0x0370 <= cp <= 0x1FFF:
            return False
    return True


def _decode_zip_name(info):
    """多编码候选解码 ZIP 文件名，修复 macOS/Windows 归档文件名乱码。

    zipfile 在 UTF-8 flag 未设置时按 cp437 解码（macOS 归档工具常不设 flag，
    但文件名实为 UTF-8），把中文解成 'τ¼öΦ«░' 这类乱码。cp437 解码是无损的
    （字节↔字符一一对应），可反解出原始字节，再依次尝试候选编码：
    UTF-8 → GB18030 → CP437 → ISO-8859-1，启发式评分选最优。
    """
    name = info.orig_filename
    if isinstance(name, bytes):
        raw = name  # 老版本 Python：直接是中央目录原始字节
    else:
        try:
            raw = name.encode("cp437")  # 从 cp437 无损反解 → 原始字节
        except UnicodeEncodeError:
            raw = name.encode("utf-8")  # 本就走 UTF-8（flag 已设），无需重建
    # 1) UTF-8 严格解码且可信 → 直接采信（UTF-8 成功是极强信号）
    try:
        utf8_text = raw.decode("utf-8")
    except UnicodeDecodeError:
        utf8_text = None
    if utf8_text is not None and _zip_utf8_trustworthy(utf8_text):
        return utf8_text
    # 2) 其余候选按启发式评分取最优
    best, best_score = "", -10**9
    for enc in ("gb18030", "cp437", "iso-8859-1"):
        try:
            text = raw.decode(enc)
        except UnicodeDecodeError:
            continue
        score = _zip_name_score(text)
        if score > best_score:
            best, best_score = text, score
    if best:
        return best
    return utf8_text if utf8_text is not None else raw.decode("cp437", errors="replace")


def _is_zip_slip(name):
    """检测路径穿越（..）与绝对路径，防范 Zip Slip 路径遍历。"""
    if not name or name.startswith("/") or name.startswith("\\"):
        return True
    depth = 0
    for part in name.replace("\\", "/").split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            depth -= 1
            if depth < 0:
                return True
        else:
            depth += 1
    return False


def _is_zip_metadata(name):
    """过滤 macOS/归档元数据：__MACOSX 目录、.DS_Store、AppleDouble ._ 侧车。"""
    base = name.replace("\\", "/").rsplit("/", 1)[-1]
    return (
        name.startswith("__MACOSX/") or name == "__MACOSX"
        or base == ".DS_Store" or base.startswith("._")
    )


def _pdf_preview_cache_path(file_id, file_path, max_pages):
    """计算 PDF 预览切割缓存文件路径。

    键含 文件id+大小+mtime+max_pages 指纹：文件被替换/更新时自动失效，未变则复用。
    存在 data/.pdf_cache/（MEDIA_ROOT 同级），跨进程共享，避免每次预览重复全量解析。
    """
    try:
        st = file_path.stat()
        key = f"{file_id}:{st.st_size}:{int(st.st_mtime)}:{max_pages}"
    except OSError:
        return None
    digest = hashlib.md5(key.encode('utf-8')).hexdigest()[:16]
    cache_dir = Path(settings.MEDIA_ROOT).parent / '.pdf_cache'
    return cache_dir / f"p{file_id}_{digest}.pdf"


def _zip_structure_cache_path(file_id, file_path):
    """计算 ZIP 结构缓存文件路径。

    键含 文件id+大小+mtime 指纹：文件被替换/更新时自动失效，未变则复用。
    存在 data/.zip_cache/（MEDIA_ROOT 同级），跨进程共享，避免每次预览重新解析。
    """
    try:
        st = file_path.stat()
        # zip2 版本前缀：v159 起结构含"解码后文件名"，与旧（乱码）缓存不兼容，升版强制失效
        key = f"zip2:{file_id}:{st.st_size}:{int(st.st_mtime)}"
    except OSError:
        return None
    digest = hashlib.md5(key.encode('utf-8')).hexdigest()[:16]
    cache_dir = Path(settings.MEDIA_ROOT).parent / '.zip_cache'
    return cache_dir / f"z{file_id}_{digest}.json"


@csrf_exempt
def api_zip_structure(request, file_id):
    """GET /api/files/<id>/zip-structure/ — 返回ZIP文件内部文件列表。

    结构按文件指纹缓存到 data/.zip_cache/：同一文件第一个用户解析一次，
    后续预览直接读缓存 JSON，不再重复解压中央目录。
    """
    if request.method != "GET":
        return _err("仅支持 GET", 405)
    material = get_object_or_404(Material, id=file_id)
    user = _get_user(request)
    if user is None:
        return _err("请先登录", 401)
    file_path = Path(settings.MEDIA_ROOT) / material.file_path
    if not file_path.exists():
        return _err("文件不存在", 404)
    if material.review_status != "approved":
        try:
            if material.review_status == "rejected":
                _check_moderator_access(user, material, allow_uploader=False)
            else:
                _check_moderator_access(user, material)
        except Exception:
            return _err("该资料未通过审核", 403)

    # 命中缓存 → 直接返回，跳过 ZIP 解析
    cache_path = _zip_structure_cache_path(file_id, file_path)
    if cache_path and cache_path.exists():
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                return _ok(json.load(f))
        except (OSError, ValueError):
            pass  # 缓存损坏则回退重新解析

    import zipfile
    try:
        with zipfile.ZipFile(str(file_path), 'r') as zf:
            items = []
            scanned = 0
            truncated = False
            for info in zf.infolist():
                scanned += 1
                if scanned > _facade._ZIP_SCAN_MAX:
                    truncated = True  # 防超大压缩包：超过扫描上限即停止
                    break
                if info.is_dir():
                    continue  # 目录由前端从路径推导，无需下发
                name = _decode_zip_name(info)
                if _is_zip_slip(name):
                    continue  # 路径穿越/绝对路径条目：安全过滤，不下发
                if _is_zip_metadata(name):
                    continue  # __MACOSX/.DS_Store/._ 元数据：体验过滤
                if name.count('/') >= _facade._ZIP_MAX_DEPTH:
                    truncated = True  # 超深目录视为异常结构，丢弃并提示截断
                    continue
                items.append({
                    'name': name,
                    'size': info.file_size,
                    'compressed_size': info.compress_size,
                })
        items.sort(key=lambda x: x['name'].lower())
        total = len(items)
        payload = {
            'file_name': material.file_name,
            'total': total,
            'items': items[: _facade._ZIP_CACHE_MAX],
            'truncated': truncated or total > _facade._ZIP_CACHE_MAX,
        }
        # 原子写缓存，供后续预览复用
        if cache_path:
            try:
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                tmp = cache_path.with_suffix('.tmp')
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(payload, f, ensure_ascii=False)
                os.replace(tmp, cache_path)
            except OSError:
                pass  # 缓存写入失败不影响主流程
        return _ok(payload)
    except zipfile.BadZipFile:
        return _err("文件已损坏或不是有效的ZIP文件", 400)
    except Exception:
        return _err("读取ZIP文件失败", 500)
