import { useEffect, useRef, useState } from 'react';
import Pdf from 'react-native-pdf';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AttachmentHtmlPreview } from '@/components/attachment-html-preview';
import { MarkdownText } from '@/components/markdown';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  attachmentDocumentKind,
  isHtmlAttachment,
  type AttachmentDocumentPending,
} from '@/lib/attachment-documents';
import {
  isAttachmentDocumentAbortError,
  loadAttachmentDocument,
  type AttachmentDocumentAuth,
  type LoadedAttachmentDocument,
} from '@/lib/attachment-document-loader';
import { describeMobileApiError, MobileApiError } from '@/lib/mobile-api';
import type { MobileAttachment } from '@shared/types/mobile';

type LoadState =
  | { readonly status: 'loading'; readonly pending?: AttachmentDocumentPending }
  | { readonly status: 'loaded'; readonly document: LoadedAttachmentDocument }
  | { readonly status: 'error'; readonly message: string };

/** A document owns one modal; it is never an item in the image pager. */
export function AttachmentDocumentViewer({
  attachment,
  auth,
}: {
  readonly attachment: MobileAttachment;
  readonly auth: AttachmentDocumentAuth | null;
}) {
  const theme = useAppTheme();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const attachmentRef = useRef(attachment);
  attachmentRef.current = attachment;
  const attachmentId = attachment.attachmentId;
  const sha256 = attachment.sha256;
  const documentKind = attachmentDocumentKind(attachment);
  const serverUrl = auth?.serverUrl;
  const accessToken = auth?.accessToken;

  useEffect(() => {
    if (!serverUrl || !accessToken || documentKind === null) return;
    let active = true;
    const controller = new AbortController();
    setState({ status: 'loading' });
    void loadAttachmentDocument({
      attachment: attachmentRef.current,
      auth: { serverUrl, accessToken },
      signal: controller.signal,
      onPending: (pending) => {
        if (active) setState({ status: 'loading', pending });
      },
    }).then((document) => {
      if (active) setState({ status: 'loaded', document });
    }).catch((error: unknown) => {
      if (!active || isAttachmentDocumentAbortError(error)) return;
      setState({ status: 'error', message: describeDocumentError(error) });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [attachmentId, sha256, serverUrl, accessToken, attempt, documentKind]);

  if (documentKind === null) {
    return (
      <View style={[styles.status, { backgroundColor: theme.background }]}>
        <Text style={[styles.statusTitle, { color: theme.text }]}>暂不支持应用内预览</Text>
        <Text style={[styles.statusText, { color: theme.textSecondary }]}>
          可点击右上角“保存”将原始文件保存到本机，再选择应用打开。
        </Text>
      </View>
    );
  }

  if (!serverUrl || !accessToken) {
    return (
      <View style={[styles.status, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.accent} />
        <Text style={[styles.statusText, { color: theme.textSecondary }]}>正在准备文件…</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={[styles.status, { backgroundColor: theme.background }]}>
        <Text style={[styles.errorTitle, { color: theme.text }]}>暂时无法预览</Text>
        <Text style={[styles.errorDetail, { color: theme.textSecondary }]}>{state.message}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`重新加载文档 ${attachment.name}`}
          onPress={() => setAttempt((current) => current + 1)}
          style={({ pressed }) => [
            styles.retry,
            { backgroundColor: theme.accent },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.retryText, { color: theme.onAccent }]}>重新加载</Text>
        </Pressable>
      </View>
    );
  }

  if (state.status === 'loading') {
    return (
      <View style={[styles.status, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.accent} size="large" />
        <Text style={[styles.statusTitle, { color: theme.text }]}>
          {state.pending?.state === 'converting' ? '正在生成预览…' : '正在打开文件…'}
        </Text>
      </View>
    );
  }

  const document = state.document;
  if (isHtmlAttachment(attachment)) {
    return <AttachmentHtmlPreview key={`${document.file.uri}:${attempt}`} html={document.text ?? ''} />;
  }
  if (document.kind === 'pdf') {
    return (
      <View style={[styles.document, { backgroundColor: theme.surfaceMuted }]}>
        <Pdf
          key={`${document.file.uri}:${attempt}`}
          source={{ uri: document.file.uri, cache: false }}
          style={styles.pdf}
          fitPolicy={0}
          minScale={1}
          maxScale={4}
          spacing={8}
          trustAllCerts={false}
          renderActivityIndicator={() => (
            <View style={styles.pdfLoading}>
              <ActivityIndicator color={theme.accent} size="large" />
            </View>
          )}
          onPressLink={openDocumentLink}
          onError={() => {
            setState({ status: 'error', message: 'PDF 渲染失败，请重新加载后再试。' });
          }}
        />
      </View>
    );
  }

  const text = document.text ?? '';
  const monospace = /\.(?:json|log)$/i.test(attachment.name)
    || /(?:application\/json|text\/json|log)/i.test(attachment.mime);
  return (
    <ScrollView
      style={[styles.document, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.textContent}
      showsVerticalScrollIndicator
    >
      {document.kind === 'markdown' ? (
        <MarkdownText text={text} />
      ) : (
        <Text
          selectable
          style={[
            styles.plainText,
            monospace && styles.monospace,
            { color: theme.text },
          ]}
        >
          {text}
        </Text>
      )}
    </ScrollView>
  );
}

function describeDocumentError(error: unknown): string {
  if (error instanceof MobileApiError) {
    switch (error.code) {
      case 'preview_unavailable':
        return 'Server 尚未配置 Office 预览转换服务，请稍后重试或联系管理员。';
      case 'preview_unsupported':
        return '该文件类型暂不支持应用内预览。';
      case 'preview_failed':
        return 'Office 文档转换为 PDF 失败，请确认源文件可正常打开后重试。';
      case 'preview_timeout':
        return '文档准备时间较长，自动重试已结束。可以稍后手动重新加载。';
      case 'invalid_pdf':
      case 'document_bytes_mismatch':
      case 'document_write_failed':
        return error.message;
      default:
        return describeMobileApiError(error);
    }
  }
  return '文档加载失败，请检查网络后重试。';
}

function openDocumentLink(href: string): void {
  if (!/^(https?:\/\/|mailto:)/i.test(href)) {
    Alert.alert('无法打开链接', '这个链接不是可以在手机上打开的网页地址。');
    return;
  }
  Linking.openURL(href).catch(() => {
    Alert.alert('打开链接失败', href);
  });
}

const styles = StyleSheet.create({
  document: { flex: 1 },
  pdf: { flex: 1, width: '100%' },
  pdfLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  textContent: { padding: 18, paddingBottom: 40 },
  plainText: { fontSize: 15, lineHeight: 24 },
  monospace: { fontFamily: 'monospace', fontSize: 13, lineHeight: 21 },
  status: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  statusTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  statusText: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
  errorTitle: { fontSize: 17, fontWeight: '700' },
  errorDetail: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
  retry: { marginTop: 4, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryText: { fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.75 },
});
