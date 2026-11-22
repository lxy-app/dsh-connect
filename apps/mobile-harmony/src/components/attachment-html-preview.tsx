import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import WebView from '@react-native-ohos/react-native-webview/lib';

import { AttachmentPreviewFeedback, usePreviewFeedback } from '@/components/attachment-preview-feedback';
import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { canNavigateLocalHtml } from '@shared/lib/html-preview';

const LOAD_TIMEOUT_MS = 15_000;

/** Only downloaded, authenticated text enters the renderer; never a URL or token. */
export function AttachmentHtmlPreview({ html }: { readonly html: string }) {
  const [attempt, setAttempt] = useState(0);
  return <HtmlPreviewAttempt key={attempt} html={html} onRetry={() => setAttempt((value) => value + 1)} />;
}

function HtmlPreviewAttempt({ html, onRetry }: { readonly html: string; readonly onRetry: () => void }) {
  const theme = useAppTheme();
  const { message, notify } = usePreviewFeedback();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const settled = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timer.current = setTimeout(() => {
      if (settled.current) return;
      settled.current = true;
      setError('预览加载超时，请重试。也可以点击右上角“保存”后打开文件。');
      setState('error');
    }, LOAD_TIMEOUT_MS);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  function finish(message?: string) {
    if (settled.current) return;
    settled.current = true;
    if (timer.current !== null) clearTimeout(timer.current);
    setError(message ?? '');
    setState(message ? 'error' : 'ready');
  }

  return (
    <View style={styles.container}>
      <View style={styles.container}>
        {state !== 'error' && (
          <WebView
            source={{ html, baseUrl: 'about:blank' }}
            // Route every navigation through our deny policy; a whitelist miss opens Linking.
            originWhitelist={['*']}
            onShouldStartLoadWithRequest={(event) => {
              const allowed = canNavigateLocalHtml(event.url);
              if (!allowed) notify('预览中暂不支持打开外部链接');
              return allowed;
            }}
            javaScriptEnabled
            domStorageEnabled
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            setSupportMultipleWindows={false}
            mixedContentMode="never"
            renderMode="ASYNC_RENDER"
            style={{ backgroundColor: theme.background }}
            containerStyle={{ backgroundColor: theme.background }}
            onLoad={() => finish()}
            onError={() => finish('HTML 预览加载失败，请重试或保存原文件。')}
            onFileDownload={() => finish('此内容无法直接预览，请保存原文件后打开。')}
          />
        )}
        {state === 'loading' && (
          <View style={[styles.loading, { backgroundColor: theme.background }]}>
            <ActivityIndicator color={theme.accent} size="large" />
            <Text style={{ color: theme.textSecondary }}>正在打开文件…</Text>
          </View>
        )}
        {state === 'error' && (
          <View style={styles.error}>
            <Text style={[styles.errorTitle, { color: theme.text }]}>暂时无法预览</Text>
            <Text style={[styles.errorDetail, { color: theme.textSecondary }]}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={onRetry} style={[styles.retry, { backgroundColor: theme.accent }]}>
              <Text style={{ color: theme.onAccent }}>重新加载</Text>
            </Pressable>
          </View>
        )}
      </View>
      <AttachmentPreviewFeedback message={message} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 12 },
  error: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  errorTitle: { fontSize: Typography.title, fontWeight: '700' },
  errorDetail: { fontSize: Typography.body, lineHeight: 22, textAlign: 'center' },
  retry: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
});
