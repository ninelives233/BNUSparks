#!/bin/bash
# BNU Sparks 服务器只读安全审计（通用版：无任何站点专属默认值）。
# 不读取 .env 内容、不输出公钥正文；只检查权限、数量和指纹。
#
# 用法：
#   export BNUSPARKS_DEPLOY_HOST="user@your-server"      # 必填，例如 deploy@203.0.113.10
#   export BNUSPARKS_DEPLOY_ROOT="/opt/bnusparks"        # 可选，默认 /opt/bnusparks
#   export BNUSPARKS_KNOWN_HOSTS="$HOME/.ssh/known_hosts" # 可选
#   bash scripts/security-audit.sh
#
# 首次连接请先通过可信渠道核对服务器 SSH 指纹并写入 known_hosts
#（StrictHostKeyChecking=yes，不做人机交互式指纹确认）。

set -Eeuo pipefail

: "${BNUSPARKS_DEPLOY_HOST:?请设置 BNUSPARKS_DEPLOY_HOST，例如 user@server}"
DEPLOY_HOST="$BNUSPARKS_DEPLOY_HOST"
DEPLOY_ROOT="${BNUSPARKS_DEPLOY_ROOT:-/opt/bnusparks}"
KNOWN_HOSTS_FILE="${BNUSPARKS_KNOWN_HOSTS:-${HOME}/.ssh/known_hosts}"

SSH_OPTS=(
  -o BatchMode=yes
  -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="$KNOWN_HOSTS_FILE"
  -o ConnectTimeout=20
)

if [ ! -r "$KNOWN_HOSTS_FILE" ]; then
  echo "❌ known_hosts 不存在或不可读: $KNOWN_HOSTS_FILE" >&2
  exit 2
fi

remote() {
  ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" "$@"
}

echo "══════════════════════════════════════════"
echo "BNU Sparks 服务器安全状态（只读）— $DEPLOY_HOST"
echo "══════════════════════════════════════════"

echo "═══ .env 元数据（绝不输出内容）═══"
remote "stat -c '%a %U:%G %n' '$DEPLOY_ROOT/.env' && test \"\$(stat -c '%a' '$DEPLOY_ROOT/.env')\" = 600"

echo "═══ 数据库文件权限 ═══"
remote "find '$DEPLOY_ROOT/data' -maxdepth 1 -name '*.sqlite3' -exec stat -c '%a %U:%G %n' {} +"

echo "═══ 当前登录用户 ═══"
remote "who || true"

echo "═══ authorized_keys 数量与指纹（不输出公钥）═══"
remote "test -f /root/.ssh/authorized_keys && wc -l /root/.ssh/authorized_keys && ssh-keygen -lf /root/.ssh/authorized_keys"

echo "═══ 异常登录 IP 统计 ═══"
remote "grep 'Failed password' /var/log/auth.log 2>/dev/null | grep -oP 'from \\K[0-9.]+' | sort | uniq -c | sort -rn || true"

echo "═══ 监听端口（预期含 22/80/443）═══"
remote "ss -tlnp"

echo "═══ 上传目录中的 Python 文件 ═══"
remote "find '$DEPLOY_ROOT/data' -type f -name '*.py' -print"

echo "══════════════════════════════════════════"
echo "✅ 审计完成；以上输出不包含密钥、密码或公钥正文"
echo "══════════════════════════════════════════"
