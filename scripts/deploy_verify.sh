#!/bin/bash
# deploy_verify.sh — 部署后立即执行，验证一切正常（v=146 安全加固版）
# 用法：./deploy_verify.sh [服务器URL]
# 默认使用正式域名 https://bnusparks.cn；所有 curl 加 -L 跟随跳转，
# 避免 http→https 或域名迁移导致验证误报。
#
# v=146 新增断言：静态长缓存 / /media/ 封锁 / /protected/ 封锁 / /admin/ 401 /
# 认证限流 429 / CSP 头 / X-Frame-Options SAMEORIGIN（与 nginx 边缘统一）。

BASE_URL="${1:-https://bnusparks.cn}"
PASS=0
FAIL=0

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }

check() {
    local desc="$1" cmd="$2"
    if eval "$cmd" >/dev/null 2>&1; then
        green "  ✅ $desc"
        ((PASS++))
    else
        red "  ❌ $desc"
        ((FAIL++))
    fi
}

echo "===== BNU Sparks 部署验证 ====="
echo "目标: $BASE_URL"
echo ""

# ── 基础可用性 ──
check "API stats 返回 200" "curl -sfL -o /dev/null -w '%{http_code}' '$BASE_URL/api/stats/' | grep -q '200'"
check "首页返回 200" "curl -sfL -o /dev/null -w '%{http_code}' '$BASE_URL/' | grep -q '200'"
check "SPA 深链 /about 返回 200" "curl -sfL -o /dev/null -w '%{http_code}' '$BASE_URL/about' | grep -q '200'"
check "SPA 深链返回 index.html" "curl -sfL '$BASE_URL/explorer/%E4%B8%93%E4%B8%9A%E8%AF%BE' | grep -qi '<!doctype html'"
check "API 返回 ok=true" "curl -sfL '$BASE_URL/api/stats/' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get(\"ok\")==True'"
check "CORS 头存在" "curl -sD - -L -o /dev/null -H 'Origin: $BASE_URL' '$BASE_URL/api/stats/' | grep -qi 'Access-Control-Allow-Origin'"

# ── SSL ──
check "SSL 证书有效" "curl -sfL -o /dev/null -w '%{ssl_verify_result}' '$BASE_URL/api/stats/' | grep -q '^0$'"

# ── 安全头（nginx 边缘统一，X-Frame-Options 必须为 SAMEORIGIN 而非 DENY）──
check "安全头 X-Content-Type-Options" "curl -sIL '$BASE_URL/api/stats/' | grep -qi 'X-Content-Type-Options: nosniff'"
check "安全头 X-Frame-Options SAMEORIGIN" "curl -sIL '$BASE_URL/api/stats/' | grep -qi 'X-Frame-Options: SAMEORIGIN'"
check "安全头 HSTS" "curl -sIL '$BASE_URL/' | grep -qi 'Strict-Transport-Security'"
check "安全头 CSP" "curl -sIL '$BASE_URL/api/stats/' | grep -qi 'Content-Security-Policy'"
check "安全头 Referrer-Policy" "curl -sIL '$BASE_URL/' | grep -qi 'strict-origin-when-cross-origin'"

# ── 静态资源长缓存（P3.2：expires 30d）──
check "静态缓存头 max-age=2592000" "curl -sIL '$BASE_URL/static/css/tokens.css' | grep -qi 'Cache-Control: max-age=2592000'"
check "静态资源带安全头" "curl -sIL '$BASE_URL/static/css/tokens.css' | grep -qi 'X-Content-Type-Options: nosniff'"
check "静态资源启用 gzip" "curl -sD - -o /dev/null -H 'Accept-Encoding: gzip' '$BASE_URL/static/css/tokens.css' | grep -qi 'Content-Encoding: gzip'"

# ── 访问控制（S2 / P3.1）──
check "/media/ 直出被拒" "curl -s -o /dev/null -w '%{http_code}' '$BASE_URL/media/LAW01003/nonexist.png' | grep -qE '403|404'"
check "/protected/ 直出 404" "curl -s -o /dev/null -w '%{http_code}' '$BASE_URL/protected/LAW01003/nonexist.png' | grep -q '404'"
check "/admin/ 要求 Basic Auth (401)" "curl -s -o /dev/null -w '%{http_code}' '$BASE_URL/admin/' | grep -q '401'"

# ── 认证限流（P1.7：rate=10r/m burst=10，25 连发应有 429）──
AUTH_CODES=$(for i in $(seq 1 25); do
  curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/login/" \
    -H 'Content-Type: application/json' -d '{"email":"verify@bnu.edu.cn","password":"wrong"}'
done | sort | uniq -c)
check "认证接口限流 429" "echo '$AUTH_CODES' | grep -q '429'"

# ── 前端版本号 ──
echo ""
echo "--- 前端版本号 ---"
VERSION=$(curl -sfL "$BASE_URL/" | grep -oE 'v=[0-9.]+' | head -1 | sed 's/^v=//')
if [ -n "$VERSION" ]; then
    green "  前端版本: $VERSION"
    ((PASS++))
else
    red "  ❌ 未找到前端版本号"
    ((FAIL++))
fi

echo ""
echo "==================="
if [ $FAIL -eq 0 ]; then
    green "全部 $PASS 项通过 ✅"
else
    red "$FAIL 项失败，$PASS 项通过"
    echo "部署可能有问题，先排查失败项"
fi
exit $FAIL
