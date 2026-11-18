#!/bin/bash
# BNU Sparks Playwright 浏览器验收入口（默认运行全部 *_browser.py 用例，或传入指定测试路径）。
set -euo pipefail
cd "$(dirname "$0")/../.."
export BNU_BROWSER_TESTS=1
if [ "$#" -eq 0 ]; then
  exec python3 manage.py test --settings=bnusparks.settings_test --pattern="*_browser.py" materials.tests -v 2
fi
exec python3 manage.py test --settings=bnusparks.settings_test "$@"
