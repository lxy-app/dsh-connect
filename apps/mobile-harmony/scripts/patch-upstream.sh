#!/bin/bash
# 修正 @expo-harmony/expo-image 在当前 HarmonyOS SDK 中不可用的 deviceInfo.apiAvailable。
# 同时处理 npm 侧的 HAR 与 ohpm 已解压副本；重复执行是幂等的。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
HAR="$ROOT/node_modules/@expo-harmony/expo-image/harmony/library.har"
EXTRACTED="$ROOT/harmony/oh_modules/@expo-harmony/expo-image/src/main/ets/ExpoImageUtils.ets"

patch_source() {
  node - "$1" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');
const before = 'deviceInfo.apiAvailable(24)';
const after = 'deviceInfo.sdkApiVersion >= 24';
if (source.includes(after)) process.exit(0);
if (!source.includes(before)) throw new Error(`未找到预期 API 调用：${file}`);
fs.writeFileSync(file, source.split(before).join(after));
console.log(`[patch] ${file}`);
NODE
}

if [ -f "$EXTRACTED" ]; then
  patch_source "$EXTRACTED"
fi

if [ ! -f "$HAR" ]; then
  echo "未找到 $HAR；请先执行 npm ci。" >&2
  exit 1
fi

if COPYFILE_DISABLE=1 tar xzf "$HAR" -O package/src/main/ets/ExpoImageUtils.ets 2>/dev/null | grep -q 'sdkApiVersion >= 24'; then
  exit 0
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/dsh-harmony-image.XXXXXX")
cleanup() {
  case "${WORK:?}" in
    "${TMPDIR:-/tmp}"/dsh-harmony-image.*) rm -rf "$WORK" ;;
  esac
}
trap cleanup EXIT
COPYFILE_DISABLE=1 tar xzf "$HAR" -C "$WORK"
patch_source "$WORK/package/src/main/ets/ExpoImageUtils.ets"
COPYFILE_DISABLE=1 tar czf "$HAR" -C "$WORK" package
if [ -f "$HAR.sha256" ]; then
  shasum -a 256 "$HAR" | awk '{print $1 "  library.har"}' > "$HAR.sha256"
fi
echo "[patch] 已更新 expo-image HAR"
