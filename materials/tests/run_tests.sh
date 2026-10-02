#!/bin/bash
# BNU Sparks 回归测试入口；测试配置提供本地专用密钥与临时数据目录。
set -euo pipefail
cd "$(dirname "$0")/../.."
# 教程分镜契约守门（需要 node；缺失时跳过，浏览器验收仍覆盖）
if command -v node >/dev/null 2>&1; then
  node tools/check_tutorial_scenes.js
fi
if [ "$#" -eq 0 ]; then
  set -- materials
fi
exec python3 manage.py test --settings=bnusparks.settings_test "$@"
