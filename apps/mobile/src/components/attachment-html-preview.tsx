import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';

import { useAppTheme } from '@/hooks/use-app-theme';
import { canNavigateLocalHtml } from '@shared/lib/html-preview';

/** The downloader owns authentication; WebView receives only validated HTML. */
export function AttachmentHtmlPreview({ html, onError }: {
  readonly html: string;
  readonly onError: (message: string) => void;
}) {
  const theme = useAppTheme();
  const source = useMemo(() => ({ html, baseUrl: 'about:blank' }), [html]);
  const errorHandler = useRef(onError);
  useEffect(() => { errorHandler.current = onError; }, [onError]);
  const loaded = useRef(false);

  useEffect(() => {
    loaded.current = false;
    const timer = setTimeout(() => {
      if (!loaded.current) errorHandler.current('HTML 预览加载超时，请重试。');
    }, 15_000);
    return () => clearTimeout(timer);
  }, [html]);

  return (
    <WebView
      source={source}
      // A whitelist miss delegates to Linking; send every navigation to our policy instead.
      originWhitelist={['*']}
      onShouldStartLoadWithRequest={(event) => canNavigateLocalHtml(event.url)}
      onOpenWindow={() => { /* Keep target=_blank and window.open inside the preview boundary. */ }}
      onFileDownload={() => { /* Do not start downloads from document links. */ }}
      javaScriptEnabled
      javaScriptCanOpenWindowsAutomatically={false}
      domStorageEnabled
      incognito
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      allowsLinkPreview={false}
      mixedContentMode="never"
      style={{ flex: 1, backgroundColor: theme.background }}
      containerStyle={{ flex: 1, backgroundColor: theme.background }}
      startInLoadingState
      renderLoading={() => (
        <View style={[styles.loading, { backgroundColor: theme.background }]}>
          <ActivityIndicator color={theme.accent} />
        </View>
      )}
      onLoad={() => { loaded.current = true; }}
      onError={() => onError('HTML 预览加载失败，请重试。')}
      onContentProcessDidTerminate={() => onError('HTML 阅读器已停止，请重新加载。')}
    />
  );
}

const styles = StyleSheet.create({
  loading: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
});
