import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

/** Non-blocking feedback owned by the preview, with no timer surviving its close. */
export function usePreviewFeedback() {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  const notify = useCallback((text: string) => {
    if (timer.current !== null) clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(''), 3_500);
  }, []);
  return { message, notify };
}

export function AttachmentPreviewFeedback({ message, bottom = 20 }: { message: string; bottom?: number }) {
  const theme = useAppTheme();
  if (!message) return null;
  return (
    <View pointerEvents="none" style={[styles.position, { bottom }]}>
      <View style={[styles.message, { backgroundColor: theme.accent }]}>
        <Text accessibilityLiveRegion="polite" style={[styles.text, { color: theme.onAccent }]}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  position: { position: 'absolute', left: 20, right: 20, alignItems: 'center' },
  message: { maxWidth: 420, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12 },
  text: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
