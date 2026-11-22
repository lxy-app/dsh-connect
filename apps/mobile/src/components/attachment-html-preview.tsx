import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import WebView from 'react-native-webview';

import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { AttachmentDocumentAuth } from '@/lib/attachment-document';
import { buildAttachmentUrl } from '@/lib/mobile-api';
import { canNavigateLocalHtml } from '@shared/lib/html-preview';
import type { MobileAttachment } from '@shared/types/mobile';

/** Authenticated remote-document preview; credentials stay in request headers. */
export function AttachmentHtmlPreview({
  attachment,
  auth,
}: {
  readonly attachment: MobileAttachment;
  readonly auth: AttachmentDocumentAuth;
}) {
  const theme = useAppTheme();
  const url = buildAttachmentUrl(auth.serverUrl, attachment.attachmentId);
  return (
    <View style={styles.container}>
      <View style={[styles.notice, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
        <Text style={[styles.noticeText, { color: theme.textSecondary }]}>
          HTML 在线预览 · 鉴权仅通过请求头发送
        </Text>
      </View>
      <WebView
        source={{ uri: url, headers: { Authorization: `Bearer ${auth.accessToken}` } }}
        originWhitelist={['https://*', 'data:*', 'blob:*', 'about:blank']}
        onShouldStartLoadWithRequest={(event) => event.url === url || canNavigateLocalHtml(event.url)}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
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
