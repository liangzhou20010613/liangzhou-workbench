#!/bin/bash
# 梁州商务实时工作台 —— 一键启动 + 免费公网穿透
# 用法：打开「终端」App，执行下面这一行即可：
#   cd /Users/zhitianxinchang/WorkBuddy/2026-08-08-23-16-13/realtime && bash start-local.sh
#
# 说明：
#   - 用 WorkBuddy 自带的 Node 启动后端（无需你另装 Node）
#   - 首次运行会自动下载免费的 cloudflared 穿透工具（无需注册账号）
#   - 启动后终端会打印一个 https 公网地址，把它发给你同事即可
#   - 想停止：在终端按 Ctrl+C
#   - 注意：运行本脚本的那台电脑必须一直开着、不休眠，同事才能访问

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# 1) WorkBuddy 自带 Node（绝对路径，避免依赖系统 PATH）
NODE="/Users/zhitianxinchang/.workbuddy/binaries/node/versions/22.22.2/bin/node"
PORT="${PORT:-3000}"

if [ ! -x "$NODE" ]; then
  echo "❌ 未找到 Node：$NODE"
  echo "   请先在 WorkBuddy 中打开过一次本工程（会自动准备该 Node 环境），或手动安装 Node 后修改本脚本的 NODE 路径。"
  exit 1
fi

# 2) 自动下载 cloudflared（仅在本地不存在时）
if [ ! -x "$DIR/cloudflared" ]; then
  echo "⬇️  首次运行，正在下载免费穿透工具 cloudflared（无需注册账号）..."
  ARCH="$(uname -m)"
  curl -L -o "$DIR/cloudflared" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${ARCH}"
  chmod +x "$DIR/cloudflared"
  # 清除 macOS 下载隔离标记，避免首次运行弹“无法验证开发者”
  xattr -c "$DIR/cloudflared" 2>/dev/null || true
  echo "✅ cloudflared 已就绪"
fi

# 3) 确保数据文件存在（用种子数据初始化，不影响已产生的改动）
if [ ! -f "$DIR/data/store.json" ]; then
  cp -f "$DIR/data/seed.json" "$DIR/data/store.json"
fi

# 4) 启动后端（后台运行）
echo "🚀 启动梁州商务工作台后端（端口 $PORT）..."
"$NODE" "$DIR/server.js" > /tmp/liangzhou_server.log 2>&1 &
SRV=$!

# 后端起来需要一瞬，等一下再建隧道
sleep 1.5

# 5) 启动公网隧道（前台，阻塞；Ctrl+C 退出时清后端）
echo "🌐 正在建立免费公网隧道，请稍候..."
cleanup() {
  kill "$SRV" 2>/dev/null || true
  echo ""
  echo "👋 已停止工作台。"
}
trap cleanup EXIT INT TERM

"$DIR/cloudflared" tunnel --url "http://localhost:${PORT}"
