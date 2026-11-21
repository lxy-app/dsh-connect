#!/bin/bash
# 避免普通播放/录音模式切换在 Pad 上无条件调用系统输出路由并报 System error。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PACKAGE="$ROOT/node_modules/@expo-harmony/expo-audio"
HAR="$PACKAGE/harmony/library.har"
NPM_SOURCE="$PACKAGE/harmony/library/src/main/ets/ExpoAudioPackage.ets"
EXTRACTED="$ROOT/harmony/oh_modules/@expo-harmony/expo-audio/src/main/ets/ExpoAudioPackage.ets"
ARCHIVE_SOURCE='package/src/main/ets/ExpoAudioPackage.ets'
MARKER='routeChanged && deviceInfo.sdkApiVersion >= 20'

patch_source() {
  node "$ROOT/scripts/patch-audio-routing.js" "$1"
}

if [ ! -f "$HAR" ]; then
  echo "未找到 $HAR；请先执行 npm ci。" >&2
  exit 1
fi

# 不使用 grep -q，避免 pipefail 下 tar 因 SIGPIPE 被误判为失败。
if ! COPYFILE_DISABLE=1 tar xzf "$HAR" -O "$ARCHIVE_SOURCE" 2>/dev/null | grep "$MARKER" >/dev/null; then
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/dsh-harmony-audio-routing.XXXXXX")
  cleanup() {
    case "${WORK:?}" in
      "${TMPDIR:-/tmp}"/dsh-harmony-audio-routing.*) rm -rf "$WORK" ;;
    esac
  }
  trap cleanup EXIT
  COPYFILE_DISABLE=1 tar xzf "$HAR" -C "$WORK"
  patch_source "$WORK/$ARCHIVE_SOURCE"
  COPYFILE_DISABLE=1 tar czf "$HAR" -C "$WORK" package
  cleanup
  trap - EXIT
  if [ -f "$HAR.sha256" ]; then
    shasum -a 256 "$HAR" | awk '{print $1 "  library.har"}' > "$HAR.sha256"
  fi
  echo "[patch] 已更新 expo-audio HAR 输出路由补丁"
fi

for SOURCE in "$NPM_SOURCE" "$EXTRACTED"; do
  if [ -f "$SOURCE" ]; then
    patch_source "$SOURCE"
  fi
done
