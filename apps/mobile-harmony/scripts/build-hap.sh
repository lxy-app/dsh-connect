#!/bin/bash
# 构建 HAP。默认 debug；可执行 bash scripts/build-hap.sh release。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEVECO=${DEVECO_STUDIO_HOME:-/Applications/DevEco-Studio.app/Contents}
NODE="$DEVECO/tools/node/bin/node"
HVIGOR="$DEVECO/tools/hvigor/bin/hvigorw.js"
MODE=${1:-debug}

if [ "$MODE" != debug ] && [ "$MODE" != release ]; then
  echo "仅支持 debug 或 release。" >&2
  exit 1
fi
if [ ! -d "$ROOT/harmony" ]; then
  echo "缺少生成的 harmony/，请先执行 npm run setup:native。" >&2
  exit 1
fi

# publishHarmonyNativeRuntime 要求 autolinking manifest 与 Hvigor buildMode 一致。
# 直接切换 debug/release 时重新 prebuild，避免复用另一变体的原生快照。
AUTOLINKING_MANIFEST="$ROOT/.expo/harmony/autolinking.json"
CURRENT_MODE=$(node - "$AUTOLINKING_MANIFEST" <<'NODE'
const fs = require('fs');
try {
  process.stdout.write(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).buildType || '');
} catch {
  process.stdout.write('');
}
NODE
)
if [ "$CURRENT_MODE" != "$MODE" ]; then
  echo "原生工程 autolink 模式为 ${CURRENT_MODE:-缺失}，正在切换为 ${MODE}。"
  bash "$ROOT/scripts/setup-native.sh" "$MODE"
fi

bash "$ROOT/scripts/patch-upstream.sh"
cd "$ROOT/harmony"
DEVECO_SDK_HOME=${DEVECO_SDK_HOME:-$DEVECO/sdk} \
EXPO_HARMONY=1 EXPO_METRO_TARGET=harmony HERMES_V1_ENABLED=true \
NODE_ENV=${NODE_ENV:-development} \
  "$NODE" "$HVIGOR" --mode module -p product=default -p buildMode="$MODE" \
  --no-daemon assembleHap

echo "构建完成：$ROOT/harmony/entry/build/default/outputs/default/"
