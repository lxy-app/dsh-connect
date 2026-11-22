import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import WebView from 'react-native-webview';

import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { canNavigateLocalHtml, htmlReadAccessDirectory } from '@shared/lib/html-preview';

/** Offline local-document preview; no credentials or remote site navigation. */
export function AttachmentHtmlPreview({ fileUri }: { readonly fileUri: string }) {
  const theme = useAppTheme();
  return (
    <View style={styles.container}>
      <View style={[styles.notice, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
        <Text style={[styles.noticeText, { color: theme.textSecondary }]}>
          本地 HTML 预览 · 外部导航已禁用
        </Text>
      </View>
      <WebView
        source={{ uri: fileUri }}
        originWhitelist={['file://*', 'data:*', 'blob:*', 'about:blank']}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs={false}
        allowingReadAccessToURL={htmlReadAccessDirectory(fileUri)}
        onShouldStartLoadWithRequest={(event) => canNavigateLocalHtml(event.url)}
        setSupportMultipleWindows={false}
        mixedContentMode="never"
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.accent} size="large" />
          </View>
        )}
        renderError={(domain, code, description) => (
          <View style={styles.error}>
            <Text style={[styles.errorTitle, { color: theme.danger }]}>无法打开 HTML 预览</Text>
            <Text style={[styles.errorDetail, { color: theme.textSecondary }]}>
              {description || `${domain ?? ''} (${code})`}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  notice: { paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  noticeText: { fontSize: Typography.caption, lineHeight: 18 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  errorTitle: { fontSize: Typography.title, fontWeight: '700' },
  errorDetail: { fontSize: Typography.body, lineHeight: 22, textAlign: 'center' },
});
