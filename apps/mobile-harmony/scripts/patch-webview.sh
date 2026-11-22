#!/bin/bash
# 同步修补 npm 源码、构建实际使用的 HAR 和 ohpm 已解包副本。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PACKAGE="$ROOT/node_modules/@react-native-ohos/react-native-webview"
HAR="$PACKAGE/harmony/rn_webview.har"
NPM_SOURCE="$PACKAGE/harmony/rn_webview/src/main/ets/RNCWebView.ets"
EXTRACTED="$ROOT/harmony/oh_modules/@react-native-ohos/react-native-webview/src/main/ets/RNCWebView.ets"
ARCHIVE_SOURCE='package/src/main/ets/RNCWebView.ets'

if [ ! -f "$HAR" ]; then
  echo "未找到 $HAR；请先安装鸿蒙依赖。" >&2
  exit 1
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/dsh-harmony-webview.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
COPYFILE_DISABLE=1 tar xzf "$HAR" -C "$WORK"
cp "$WORK/$ARCHIVE_SOURCE" "$WORK/original.ets"
node "$ROOT/scripts/patch-webview.js" "$WORK/$ARCHIVE_SOURCE"
if ! cmp -s "$WORK/original.ets" "$WORK/$ARCHIVE_SOURCE"; then
  COPYFILE_DISABLE=1 tar czf "$WORK/patched.har" -C "$WORK" package
  mv "$WORK/patched.har" "$HAR"
  if [ -f "$HAR.sha256" ]; then
    shasum -a 256 "$HAR" | awk '{print $1 "  rn_webview.har"}' > "$HAR.sha256"
  fi
  echo "[patch] 已更新 WebView HAR"
fi

for SOURCE in "$NPM_SOURCE" "$EXTRACTED"; do
  if [ -f "$SOURCE" ]; then
    node "$ROOT/scripts/patch-webview.js" "$SOURCE"
  fi
done
