#!/bin/bash
# BNU Sparks 回归测试入口，只使用 bnusparks.settings_test。
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ "$#" -eq 0 ]; then
  set -- materials
fi
exec python3 manage.py test --settings=bnusparks.settings_test "$@"
