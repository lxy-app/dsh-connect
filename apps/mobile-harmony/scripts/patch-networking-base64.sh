#!/bin/bash
# RNOH 0.84.1 误把 RN fetch 的 { base64 } 请求体按 UTF-8 文本发送。
# 仅修改 ohpm 解压出的可再生源码，setup:native 安装依赖后与 build:hap 编译前均会调用。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
EXTRACTED="$ROOT/harmony/oh_modules/@rnoh/react-native-openharmony/src/main/ets/RNOHCorePackage/turboModules/Networking/NetworkingTurboModule.ts"
if [ -f "$EXTRACTED" ]; then
  node "$ROOT/scripts/patch-networking-base64.js" "$EXTRACTED"
fi
