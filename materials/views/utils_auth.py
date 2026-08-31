"""
BNU Sparks · 木铎星火 — 认证辅助（JWT 编解码、下载令牌、装饰器、基础响应）
"""

import base64
import hashlib
import hmac
import ipaddress
import json
import secrets
import time
from functools import wraps

from django.conf import settings
from django.contrib.auth.models import User
from django.http import JsonResponse
from django.utils import timezone

from ..models import UserProfile

# ═══════════════════════════════════════════════════════════════
# JWT 工具（纯 Python 实现，不依赖外部库）
# ═══════════════════════════════════════════════════════════════

def _jwt_encode(payload):
    """编码 JWT（role 不在 token 中，从数据库实时读取；携带 token_version 供撤销）"""
    payload = dict(payload)
    uid = payload.get("user_id")
    if uid:
        try:
            payload["ver"] = UserProfile.objects.filter(user_id=uid).values_list(
                "token_version", flat=True).first() or 0
        except Exception:
            pass

    header = base64.urlsafe_b64encode(
        json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    ).rstrip(b"=").decode()
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload).encode()
    ).rstrip(b"=").decode()
    sig = hmac.new(
        settings.SECRET_KEY.encode(),
        f"{header}.{payload_b64}".encode(),
        hashlib.sha256,
    ).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    return f"{header}.{payload_b64}.{sig_b64}"


def _jwt_decode(token):
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        h, p, s = parts
        expected = hmac.new(
            settings.SECRET_KEY.encode(),
            f"{h}.{p}".encode(), hashlib.sha256,
        ).digest()
        actual = base64.urlsafe_b64decode(s + "==")
        if not hmac.compare_digest(expected, actual):
            return None
        payload = json.loads(base64.urlsafe_b64decode(p + "=="))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None


def _get_user(request):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer ") or len(auth) < 20:
        return None
    payload = _jwt_decode(auth[7:])
    if payload is None:
        return None
    try:
        user = User.objects.get(id=payload["user_id"])
    except User.DoesNotExist:
        return None
    # 令牌版本校验（P2.5）：改密/重置后 token_version+1，旧 JWT 立即失效。
    # 无 ver 字段的旧 token（本改动前签发）不校验，平滑过渡。
    ver = payload.get("ver")
    if ver is not None:
        try:
            current = UserProfile.objects.filter(user_id=user.id).values_list(
                "token_version", flat=True).first()
            if current is not None and current != ver:
                return None
        except Exception:
            pass
    return user


# ═══════════════════════════════════════════════════════════════
# 短时下载令牌（替代 JWT 用于 download URL，避免 token 泄露到日志）
# ═══════════════════════════════════════════════════════════════

def _generate_download_token(file_id, user_id, session_key, ttl=60):
    """生成短时下载令牌（非 JWT，URL 安全，默认 60s 过期）。

    v=167 安全加固：令牌绑定签发时的会话键（session_key）。只有携带对应
    sessionid cookie 的同一浏览器会话能通过验证——把带令牌的 URL 转发给他人，
    对方浏览器没有该 cookie，验证失败，堵住「令牌可转发、冒充签发人下载
    未批准文件」的洞。
    """
    payload = f"{file_id}:{user_id}:{session_key}:{int(time.time()) + ttl}"
    sig = hmac.new(settings.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()[:16]
    return base64.urlsafe_b64encode(f"{payload}:{sig}".encode()).rstrip(b"=").decode()


def _verify_download_token(token, expected_file_id, session_key):
    """验证短时下载令牌，返回 user_id 或 None（会话键不匹配返回 None）"""
    try:
        raw = base64.urlsafe_b64decode(token + "==").decode()
        parts = raw.rsplit(":", 1)
        if len(parts) != 2:
            return None
        data, sig = parts
        file_id, user_id, tok_session, exp = data.split(":")
        expected = hmac.new(settings.SECRET_KEY.encode(), data.encode(), hashlib.sha256).hexdigest()[:16]
        if not hmac.compare_digest(expected, sig):
            return None
        if int(exp) < time.time():
            return None
        if int(file_id) != expected_file_id:
            return None
        if not session_key or not tok_session or tok_session != session_key:
            return None
        return int(user_id)
    except Exception:
        return None


def _request_client_ip(request):
    """取得可信客户端 IP；仅本机反代可提供 X-Real-IP。"""
    remote = request.META.get("REMOTE_ADDR") or "unknown"
    if remote in getattr(settings, "TRUSTED_PROXY_IPS", set()):
        candidate = (request.META.get("HTTP_X_REAL_IP") or "").strip()
        if candidate:
            try:
                return str(ipaddress.ip_address(candidate))
            except ValueError:
                pass
    return remote


def _portable_ip_fingerprint(request):
    """令牌只保存 IP 的不可逆摘要，不把地址写进 URL。"""
    value = _request_client_ip(request)
    digest = hmac.new(
        settings.SECRET_KEY.encode(), f"download-ip:{value}".encode(), hashlib.sha256,
    ).hexdigest()
    return digest[:20]


def _generate_portable_download_token(file_id, user_id, request, ttl=90):
    """为已审核资料生成可跨浏览器移交的短时令牌。

    令牌不依赖 session cookie，因此微信 WebView 移交系统浏览器后仍可使用；
    同时绑定客户端 IP、90 秒有效期与随机行为编号，兼顾可用性与链接转发风险。
    """
    request_id = secrets.token_urlsafe(16)
    payload = ":".join((
        str(file_id), str(user_id), _portable_ip_fingerprint(request),
        str(int(time.time()) + ttl), request_id,
    ))
    sig = hmac.new(
        settings.SECRET_KEY.encode(), f"portable:{payload}".encode(), hashlib.sha256,
    ).hexdigest()[:24]
    encoded = base64.urlsafe_b64encode(f"{payload}:{sig}".encode()).rstrip(b"=").decode()
    return f"p.{encoded}"


def _verify_portable_download_token(token, expected_file_id, request):
    """验证可移交令牌，成功返回 ``(user_id, request_id)``。"""
    if not token or not token.startswith("p."):
        return None
    try:
        raw = base64.urlsafe_b64decode(token[2:] + "==").decode()
        data, sig = raw.rsplit(":", 1)
        expected = hmac.new(
            settings.SECRET_KEY.encode(), f"portable:{data}".encode(), hashlib.sha256,
        ).hexdigest()[:24]
        if not hmac.compare_digest(expected, sig):
            return None
        file_id, user_id, ip_fingerprint, exp, request_id = data.split(":")
        if int(exp) < time.time() or int(file_id) != expected_file_id:
            return None
        if not hmac.compare_digest(ip_fingerprint, _portable_ip_fingerprint(request)):
            return None
        if not request_id or len(request_id) > 64:
            return None
        return int(user_id), request_id
    except Exception:
        return None


# ═══════════════════════════════════════════════════════════════
# 装饰器 & 基础响应
# ═══════════════════════════════════════════════════════════════

def require_login(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        user = _get_user(request)
        if user is None:
            return JsonResponse({"ok": False, "error": "请先登录"}, status=401)
        request.user = user
        return view(request, *args, **kwargs)
    return wrapper


def _get_or_create_profile(user):
    """获取用户资料，不存在则自动创建（兼容存量用户）"""
    try:
        return user.profile
    except UserProfile.DoesNotExist:
        return UserProfile.objects.create(user=user, role=UserProfile.Role.USER)


def _normalize_identity(value, max_len=100):
    """身份字段归一化：去空白并截断；「其他」是可统计的真实选项。"""
    val = (value or "").strip()
    if not val:
        return ""
    return val[:max_len]


def _identity_can_edit(profile):
    """身份标签修改权限：仅普通 user 每日限改 1 次，其余角色不限（v183）"""
    if profile.role != UserProfile.Role.USER:
        return True
    if not profile.identity_updated_at:
        return True
    return profile.identity_updated_at.date() != timezone.now().date()


def require_role(*roles):
    """限制视图仅允许指定角色的用户访问（叠加 require_login）"""
    def decorator(view):
        @wraps(view)
        def wrapper(request, *args, **kwargs):
            user = _get_user(request)
            if user is None:
                return _err("请先登录", 401)
            profile = _get_or_create_profile(user)
            if profile.role not in roles:
                return _err("权限不足", 403)
            request.user = user
            return view(request, *args, **kwargs)
        return wrapper
    return decorator


def _ok(data=None, status=200):
    return JsonResponse({"ok": True, "data": data}, status=status)


def _err(msg, status=400):
    return JsonResponse({"ok": False, "error": msg}, status=status)

