import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, useWindowDimensions } from 'react-native';

/**
 * 键盘占用的高度（pt）与可见状态。
 *
 * 会话页原先用 `KeyboardAvoidingView behavior="padding"` 包住整页，它按
 * `frame.y + frame.height - endCoordinates.screenY` 反推底部 padding。
 * iOS 只要上报一次异常或过期的 `screenY`，padding 就会被算成接近整屏高度：
 * 内容盒塌到只剩 `screenY` 那么高，头部/输入区/TabBar 全被压到状态栏下方。
 *
 * 这里直接读 `endCoordinates.height`（与 `screenY` 无关），并夹在
 * 0 ~ 65% 窗口高度之间，即使系统坐标系出错也不会把内容压没。
 */
export function useKeyboardInset(): { height: number; visible: boolean } {
  const { height: windowHeight } = useWindowDimensions();
  const [height, setHeight] = useState(0);
  const visibleRef = useRef(false);

  useEffect(() => {
    const max = Math.max(Math.round(windowHeight * 0.65), 0);

    const update = (raw: number | undefined, source: string, screenY?: number) => {
      const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : 0;
      const next = Math.min(Math.max(value, 0), max);
      if (__DEV__ && next !== value) {
        console.warn(
          `[keyboard] ${source} height=${value} clamped to ${next} (window=${windowHeight})`,
        );
      }
      if (__DEV__ && next > 0 && !visibleRef.current) {
        console.log(
          `[keyboard] ${source} height=${next} screenY=${String(screenY)} window=${windowHeight}`,
        );
      }
      visibleRef.current = next > 0;
      setHeight(next);
    };

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (event) => {
      // iOS 在收起时也会触发 keyboardWillChangeFrame，此时 height 为 0。
      update(event.endCoordinates.height, showEvent, event.endCoordinates.screenY);
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      update(0, hideEvent);
    });

    return () => {
      show.remove();
      hide.remove();
    };
  }, [windowHeight]);

  return { height, visible: height > 0 };
}
