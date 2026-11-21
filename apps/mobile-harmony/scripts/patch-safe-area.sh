#!/bin/bash
# 修复 @react-native-ohos/react-native-safe-area-context 5.6.4 的启动竞态：
# C++ 同步调用 getConstants 时，异步 getLastWindow 尚未完成会返回全零 inset。
# 固定从 UIAbilityContext 的主窗口同步读取，并修正左右 inset 应取 width 的问题。
# 上游同类问题与修复方向：https://gitcode.com/CPF-RN/rntpc_react-native-safe-area-context/pull/28
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PACKAGE="$ROOT/node_modules/@react-native-ohos/react-native-safe-area-context"
HAR="$PACKAGE/harmony/safe_area.har"
NPM_SOURCE="$PACKAGE/harmony/safe_area/src/main/ets/SafeViewTurboModule.ts"
EXTRACTED="$ROOT/harmony/oh_modules/@react-native-ohos/react-native-safe-area-context/src/main/ets/SafeViewTurboModule.ts"
ARCHIVE_SOURCE='package/src/main/ets/SafeViewTurboModule.ts'
MARKER='windowStage.getMainWindowSync()'

patch_source() {
  node - "$1" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');
const classStart = 'export class SafeAreaViewTurboModule extends TurboModule {';
const marker = 'windowStage.getMainWindowSync()';
if (source.includes(marker)) process.exit(0);
const start = source.indexOf(classStart);
if (start < 0 || !source.includes('private async initWindowInstance()') || !source.includes('getSafeAreaInsets(): Promise<Event>')) {
  throw new Error(`未找到预期的 safe-area-context 5.6.4 实现：${file}`);
}
const replacement = `${classStart}
  constructor(protected ctx: TurboModuleContext) {
    super(ctx);
    Logger.debug(TAG, '[RNOH]:SafeAreaViewTurboModule constructor');
  }

  private readMetrics(): Event {
    const windowInstance = this.ctx.uiAbilityContext.windowStage.getMainWindowSync();
    const windowInfo = windowInstance.getWindowProperties();
    const avoidArea = windowInstance.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
    const avoidAreaBottom = windowInstance.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR);
    const frame: Frame = {
      x: px2vp(windowInfo.windowRect.left),
      y: px2vp(windowInfo.windowRect.top),
      width: px2vp(windowInfo.windowRect.width),
      height: px2vp(windowInfo.windowRect.height)
    };
    const insets: EdgeInsets = {
      top: px2vp(avoidArea.topRect.height),
      right: px2vp(avoidArea.rightRect.width),
      bottom: px2vp(avoidAreaBottom.bottomRect.height),
      left: px2vp(avoidArea.leftRect.width)
    };
    return { insets, frame };
  }

  getConstants(): {} {
    let metrics: Event = {
      frame: { x: 0, y: 0, width: 0, height: 0 },
      insets: { top: 0, right: 0, bottom: 0, left: 0 }
    };
    try {
      metrics = this.readMetrics();
    } catch (err) {
      Logger.error(TAG, 'getConstants error: ' + JSON.stringify(err));
    }
    return { "initialWindowMetrics": metrics };
  }

  getSafeAreaInsets(): Promise<Event> {
    try {
      return Promise.resolve(this.readMetrics());
    } catch (exception) {
      return Promise.reject(exception);
    }
  }
}
`;
fs.writeFileSync(file, source.slice(0, start) + replacement);
console.log(`[patch] ${file}`);
NODE
}

if [ ! -f "$HAR" ]; then
  echo "未找到 $HAR；请先执行 npm ci。" >&2
  exit 1
fi

# 不使用 grep -q，避免 pipefail 下 tar 因 SIGPIPE 被误判为失败。
if ! COPYFILE_DISABLE=1 tar xzf "$HAR" -O "$ARCHIVE_SOURCE" 2>/dev/null | grep "$MARKER" >/dev/null; then
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/dsh-harmony-safe-area.XXXXXX")
  cleanup() {
    case "${WORK:?}" in
      "${TMPDIR:-/tmp}"/dsh-harmony-safe-area.*) rm -rf "$WORK" ;;
    esac
  }
  trap cleanup EXIT
  COPYFILE_DISABLE=1 tar xzf "$HAR" -C "$WORK"
  patch_source "$WORK/$ARCHIVE_SOURCE"
  COPYFILE_DISABLE=1 tar czf "$HAR" -C "$WORK" package
  cleanup
  trap - EXIT
  if [ -f "$HAR.sha256" ]; then
    shasum -a 256 "$HAR" | awk '{print $1 "  safe_area.har"}' > "$HAR.sha256"
  fi
  echo "[patch] 已更新 safe-area-context HAR"
fi

for SOURCE in "$NPM_SOURCE" "$EXTRACTED"; do
  if [ -f "$SOURCE" ]; then
    patch_source "$SOURCE"
  fi
done
