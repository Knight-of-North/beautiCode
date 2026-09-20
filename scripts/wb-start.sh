#!/bin/sh
# wb-start.sh — WorkBuddy 自定义背景 · 一键启动守护
# 不退出、不重启用户已经打开的 WorkBuddy。若 CDP 端口已开则只起守护；
# 未开则尝试带环境变量拉起官方二进制（不 kill 现有进程）。
set -e
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BC_REPO=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
WB_APP="/Applications/WorkBuddy.app/Contents/MacOS/Electron"
PORT=9335

echo "[1/3] 仓库：$BC_REPO"
if curl -s -m 1 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "      CDP 端口 $PORT 已开，不重启 WorkBuddy"
else
  echo "[2/3] 端口未开，带 CDP 启动 WorkBuddy（不结束已有进程）…"
  if [ ! -x "$WB_APP" ]; then
    echo "      找不到 $WB_APP"; exit 1
  fi
  WORKBUDDY_REMOTE_DEBUGGING_PORT=$PORT "$WB_APP" >/dev/null 2>&1 &
  i=0
  while [ $i -lt 20 ]; do
    if curl -s -m 1 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
      echo "      端口 $PORT 已开"; break
    fi
    i=$((i+1)); sleep 1
  done
  if [ $i -ge 20 ]; then echo "      端口没开，请用带 WORKBUDDY_REMOTE_DEBUGGING_PORT 的方式启动 WorkBuddy"; exit 1; fi
fi

echo "[3/3] 编译 adapter 并起守护…"
cd "$BC_REPO"
npm run build -w @beauticode/adapter-workbuddy
echo "      守护运行中：侧栏会出现「自定义背景」；Ctrl+C 退出并自动清理"
node scripts/wb-cdp-runner.mjs
