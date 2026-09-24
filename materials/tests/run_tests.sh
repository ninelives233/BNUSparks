#!/bin/bash
# BNU Sparks 回归测试入口；测试配置提供本地专用密钥与临时数据目录。
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ "$#" -eq 0 ]; then
  set -- materials
fi
exec python3 manage.py test --settings=bnusparks.settings_test "$@"
