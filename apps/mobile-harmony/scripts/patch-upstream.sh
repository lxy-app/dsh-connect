#!/bin/bash
# 修正当前 expo-harmony 上游兼容问题：
# 1. expo-image 使用当前 HarmonyOS SDK 不支持的 deviceInfo.apiAvailable。
# 2. CNG 生成的 Hvigor 脚本向 export:embed 传入已不支持的 --json。
# 3. react-native-pdf 旧包缺少 ArkTS Package；新版有效注册必须保留。
# 4. expo-audio 在普通音频模式写入时无条件切换输出路由，Pad 会报 System error。
# 同时处理 npm 侧的 HAR、ohpm 已解压副本与生成脚本；重复执行是幂等的。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
bash "$ROOT/scripts/patch-safe-area.sh"
bash "$ROOT/scripts/patch-pdf-autolinking.sh"
bash "$ROOT/scripts/patch-audio-routing.sh"
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

HVIGORFILE="$ROOT/harmony/hvigorfile.ts"
if [ -f "$HVIGORFILE" ]; then
  node - "$HVIGORFILE" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');
const before = "[cliPath, 'export:embed', ProjectRoot, '--json']";
const after = "[cliPath, 'export:embed', ProjectRoot]";
if (source.includes(after)) process.exit(0);
if (!source.includes(before)) throw new Error(`未找到预期的 export:embed 调用：${file}`);
fs.writeFileSync(file, source.replace(before, after));
console.log(`[patch] ${file}`);
NODE
fi

if [ -f "$EXTRACTED" ]; then
  patch_source "$EXTRACTED"
fi

if [ ! -f "$HAR" ]; then
  echo "未找到 $HAR；请先执行 npm ci。" >&2
  exit 1
fi

# 在 pipefail 下不能用 grep -q：提前退出会让 tar 收到 SIGPIPE，导致已修补 HAR 被重复重打包。
if COPYFILE_DISABLE=1 tar xzf "$HAR" -O package/src/main/ets/ExpoImageUtils.ets 2>/dev/null | grep 'sdkApiVersion >= 24' >/dev/null; then
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
