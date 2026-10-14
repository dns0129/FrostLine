#!/bin/sh
# Run from this file's folder even when launched from Finder.
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo "未找到 Python 3。请先安装 Python 3，再双击此文件。"
  echo "下载地址：https://www.python.org/downloads/"
  printf '按回车关闭窗口…'
  read -r ignored
  exit 1
fi
python3 server.py "$@"
result=$?
if [ "$result" -ne 0 ]; then
  printf '按回车关闭窗口…'
  read -r ignored
fi
exit "$result"
