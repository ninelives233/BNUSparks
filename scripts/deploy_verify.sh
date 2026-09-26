#!/bin/bash
# 对指定站点执行部署后只读验证。认证限流检查默认关闭，避免污染生产状态。

set -Eeuo pipefail

if [ "$#" -ne 1 ]; then
    echo "用法：bash scripts/deploy_verify.sh https://站点域名" >&2
    exit 2
fi

BASE_URL="${1%/}"
if [[ ! "$BASE_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]]; then
    echo "站点地址必须是仅含主机名的 https URL，不能包含路径、查询参数或凭据。" >&2
    exit 2
fi

CURL=(curl --connect-timeout 10 --max-time 30)
PASS=0
FAIL=0

pass() {
    printf '\033[32m  ✅ %s\033[0m\n' "$1"
    PASS=$((PASS + 1))
}

fail() {
    printf '\033[31m  ❌ %s\033[0m\n' "$1"
    FAIL=$((FAIL + 1))
}

check_status() {
    local description="$1" path="$2" expected="$3" actual
    actual="$("${CURL[@]}" -sSL -o /dev/null -w '%{http_code}' "$BASE_URL$path" || true)"
    if [ "$actual" = "$expected" ]; then
        pass "$description"
    else
        fail "${description}（期望 $expected，实际 ${actual:-请求失败}）"
    fi
}

check_status_pattern() {
    local description="$1" path="$2" pattern="$3" actual
    actual="$("${CURL[@]}" -sS -o /dev/null -w '%{http_code}' "$BASE_URL$path" || true)"
    if [[ "$actual" =~ $pattern ]]; then
        pass "$description"
    else
        fail "${description}（实际 ${actual:-请求失败}）"
    fi
}

check_header() {
    local description="$1" path="$2" pattern="$3" headers
    headers="$("${CURL[@]}" -sSIL "$BASE_URL$path" || true)"
    if grep -Eiq "$pattern" <<<"$headers"; then
        pass "$description"
    else
        fail "$description"
    fi
}

check_request_header() {
    local description="$1" path="$2" request_header="$3" pattern="$4" headers
    headers="$("${CURL[@]}" -sSD - -o /dev/null -H "$request_header" "$BASE_URL$path" || true)"
    if grep -Eiq "$pattern" <<<"$headers"; then
        pass "$description"
    else
        fail "$description"
    fi
}

check_body() {
    local description="$1" path="$2" pattern="$3" body
    body="$("${CURL[@]}" -sfSL "$BASE_URL$path" || true)"
    if grep -Eiq "$pattern" <<<"$body"; then
        pass "$description"
    else
        fail "$description"
    fi
}

echo "===== BNU Sparks 部署验证 ====="
echo "目标站点已由调用者显式提供。"

check_status "API stats 返回 200" "/api/stats/" "200"
check_status "首页返回 200" "/" "200"
check_status "SPA 深链返回 200" "/about" "200"
check_body "SPA 深链返回 HTML" "/about" '<!doctype html'
check_body "API 返回 ok=true" "/api/stats/" '"ok"[[:space:]]*:[[:space:]]*true'
check_request_header "CORS 响应头存在" "/api/stats/" "Origin: $BASE_URL" '^Access-Control-Allow-Origin:'

check_header "安全头 X-Content-Type-Options" "/api/stats/" '^X-Content-Type-Options:[[:space:]]*nosniff'
check_header "安全头 X-Frame-Options SAMEORIGIN" "/api/stats/" '^X-Frame-Options:[[:space:]]*SAMEORIGIN'
check_header "安全头 HSTS" "/" '^Strict-Transport-Security:'
check_header "安全头 CSP" "/api/stats/" '^Content-Security-Policy:'
check_header "安全头 Referrer-Policy" "/" '^Referrer-Policy:[[:space:]]*strict-origin-when-cross-origin'

check_header "静态缓存头 max-age=2592000" "/static/css/tokens.css" 'Cache-Control:.*max-age=2592000'
check_header "静态资源安全头" "/static/css/tokens.css" '^X-Content-Type-Options:[[:space:]]*nosniff'
check_request_header "静态资源启用压缩" "/static/css/tokens.css" "Accept-Encoding: gzip" '^Content-Encoding:[[:space:]]*gzip'

MISSING_PATH="${BNUSPARKS_VERIFY_MISSING_PATH:-/static/__deploy_verify_missing__.css}"
check_status_pattern "不存在静态资源未被公开" "$MISSING_PATH" '^(403|404)$'
check_status_pattern "媒体目录不能直接列出" "/media/__deploy_verify_missing__" '^(403|404)$'
check_status "受保护文件不能直接访问" "/protected/__deploy_verify_missing__" "404"
check_status "管理入口要求边缘认证" "/admin/" "401"

if [ "${BNUSPARKS_VERIFY_RATE_LIMIT:-0}" = "1" ]; then
    echo "已显式启用认证限流验证；该检查会产生失败登录日志。"
    rate_limited=0
    for _ in $(seq 1 25); do
        code="$("${CURL[@]}" -sS -o /dev/null -w '%{http_code}' -X POST \
            "$BASE_URL/api/auth/login/" -H 'Content-Type: application/json' \
            -d '{"email":"rate-limit-probe@example.invalid","password":"invalid"}' || true)"
        [ "$code" = "429" ] && rate_limited=1
    done
    if [ "$rate_limited" -eq 1 ]; then
        pass "认证接口限流 429"
    else
        fail "认证接口限流 429"
    fi
else
    echo "  ⏭️  认证限流主动探测已跳过（显式设置 BNUSPARKS_VERIFY_RATE_LIMIT=1 才执行）"
fi

echo "==================="
if [ "$FAIL" -eq 0 ]; then
    echo "全部 $PASS 项通过"
else
    echo "$FAIL 项失败，$PASS 项通过"
fi
exit "$FAIL"
