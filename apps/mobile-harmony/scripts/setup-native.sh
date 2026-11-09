#!/bin/bash
# 从 npm 依赖重建鸿蒙原生工程。签名材料通过 EXPO_HARMONY_SIGNING_CONFIG_FILE 注入。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEVECO=${DEVECO_STUDIO_HOME:-/Applications/DevEco-Studio.app/Contents}
NODE="$DEVECO/tools/node/bin/node"
OHPM="$DEVECO/tools/ohpm/bin/pm-cli.js"

if [ ! -x "$ROOT/node_modules/.bin/expo-harmony" ]; then
  echo "依赖未安装，请先在 apps/mobile-harmony 执行 npm ci --legacy-peer-deps。" >&2
  exit 1
fi
if [ ! -f "$NODE" ] || [ ! -f "$OHPM" ]; then
  echo "未找到 DevEco Studio 工具链，可用 DEVECO_STUDIO_HOME 指定 Contents 目录。" >&2
  exit 1
fi

cd "$ROOT"
bash scripts/patch-upstream.sh
EXPO_HARMONY=1 EXPO_METRO_TARGET=harmony NODE_ENV=development \
  "$ROOT/node_modules/.bin/expo-harmony" prebuild --no-install

cd "$ROOT/harmony"
DEVECO_SDK_HOME=${DEVECO_SDK_HOME:-$DEVECO/sdk} "$NODE" "$OHPM" install --all
find oh_modules -name '._*' -type f -delete
find oh_modules -name '.DS_Store' -type f -delete
bash "$ROOT/scripts/patch-upstream.sh"
echo "鸿蒙原生工程已就绪：$ROOT/harmony"
