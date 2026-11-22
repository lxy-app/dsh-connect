import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Pdf from 'react-native-pdf';

import { AttachmentHtmlPreview } from '@/components/attachment-html-preview';
import { MarkdownText } from '@/components/markdown';
import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  downloadAttachmentDocument,
  type AttachmentDocumentAuth,
  type DownloadedAttachmentDocument,
} from '@/lib/attachment-document';
import {
  describeAttachmentPreviewError,
  attachmentPreviewKind,
  isHtmlAttachment,
  type AttachmentPendingState,
} from '@/lib/attachment-preview';
import type { MobileAttachment } from '@shared/types/mobile';

const MONOSPACE_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });

type DocumentResult = {
  readonly downloaded: DownloadedAttachmentDocument;
  readonly text?: string;
};

type LoadState =
  | { readonly status: 'loading'; readonly pending: AttachmentPendingState | null }
  | { readonly status: 'ready'; readonly result: DocumentResult }
  | { readonly status: 'error'; readonly message: string };
type KeyedLoadState = LoadState & { readonly key: string };

/** One document at a time; no document is ever inserted into image paging. */
export function AttachmentDocumentPreview({
  attachment,
  auth,
}: {
  readonly attachment: MobileAttachment;
  readonly auth: AttachmentDocumentAuth | null;
}) {
  const theme = useAppTheme();
  const [retryCount, setRetryCount] = useState(0);
  const [loadState, setLoadState] = useState<KeyedLoadState | null>(null);
  const serverUrl = auth?.serverUrl;
  const accessToken = auth?.accessToken;
  const previewKind = attachmentPreviewKind(attachment);
  const htmlSource = isHtmlAttachment(attachment);
  const requestKey = `${attachment.attachmentId}:${attachment.sha256 ?? ''}:${serverUrl ?? ''}:${accessToken ?? ''}:${retryCount}`;
  const state: LoadState = loadState?.key === requestKey
    ? loadState
    : { status: 'loading', pending: null };

  useEffect(() => {
    if (!serverUrl || !accessToken || previewKind === 'unsupported') return;
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const downloaded = await downloadAttachmentDocument(attachment, { serverUrl, accessToken }, {
          signal: controller.signal,
          onPending: (pending) => {
            if (active) setLoadState({ key: requestKey, status: 'loading', pending });
          },
        });
        const text = downloaded.spec.kind === 'markdown' || downloaded.spec.kind === 'text'
          ? await downloaded.file.text()
          : undefined;
        if (!active || controller.signal.aborted) return;
        setLoadState({
          key: requestKey,
          status: 'ready',
          result: { downloaded, ...(text !== undefined ? { text } : {}) },
        });
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setLoadState({ key: requestKey, status: 'error', message: describeAttachmentPreviewError(error) });
      }
    };
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [attachment, serverUrl, accessToken, retryCount, requestKey, previewKind]);

  const retry = () => setRetryCount((current) => current + 1);

  if (previewKind === 'unsupported') {
    return (
      <View style={styles.status}>
        <Text style={[styles.statusTitle, { color: theme.text }]}>暂不支持应用内预览</Text>
        <Text style={[styles.statusDetail, { color: theme.textSecondary }]}>
          {Platform.OS === 'android'
            ? '可点击右上角“保存”，选择本地目录保存原始文件。'
            : '可点击右上角“保存”，在系统面板中选择“存储到文件”。'}
        </Text>
      </View>
    );
  }

  if (!serverUrl || !accessToken) {
    return (
      <View style={styles.status}>
        <ActivityIndicator color={theme.accent} size="large" />
        <Text style={[styles.statusTitle, { color: theme.text }]}>正在准备登录凭据…</Text>
      </View>
    );
  }

  if (state.status === 'loading') {
    return (
      <View style={styles.status}>
        <ActivityIndicator color={theme.accent} size="large" />
        <Text style={[styles.statusTitle, { color: theme.text }]}>
          {state.pending === 'converting'
            ? '正在生成 PDF 预览…'
            : state.pending === 'fetching'
              ? '正在从桌面获取附件…'
              : htmlSource
                ? '正在准备 HTML 源码…'
                : '正在准备文档…'}
        </Text>
        {state.pending === 'converting' ? (
          <Text style={[styles.statusDetail, { color: theme.textSecondary }]}>
            转换可能需要约 90 秒，请保持此页面打开
          </Text>
        ) : null}
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.status}>
        <Text style={[styles.errorTitle, { color: theme.danger }]}>
          {htmlSource ? '无法读取 HTML 源码' : '无法预览文档'}
        </Text>
        <Text style={[styles.statusDetail, { color: theme.textSecondary }]}>{state.message}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={htmlSource
            ? `重试读取 HTML 源码 ${attachment.name}`
            : `重试预览 ${attachment.name}`}
          onPress={retry}
          style={({ pressed }) => [
            styles.retry,
            { backgroundColor: theme.surfaceMuted, borderColor: theme.border },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.retryText, { color: theme.text }]}>重试</Text>
        </Pressable>
      </View>
    );
  }

  const { downloaded, text } = state.result;
  if (htmlSource) {
    return <AttachmentHtmlPreview html={text ?? ''} />;
  }
  if (downloaded.spec.kind === 'office' || downloaded.spec.kind === 'pdf') {
    return (
      <Pdf
        key={`${downloaded.file.uri}:${retryCount}`}
        source={{ uri: downloaded.file.uri, cache: false }}
        style={styles.pdf}
        fitPolicy={0}
        minScale={1}
        maxScale={4}
        enableAntialiasing
        enableDoubleTapZoom
        trustAllCerts={false}
        onError={(error) => {
          setLoadState({ key: requestKey, status: 'error', message: `PDF 阅读器无法打开此文件：${error.message}` });
        }}
      />
    );
  }

  return (
    <ScrollView
      style={styles.reader}
      contentContainerStyle={styles.readerContent}
      keyboardShouldPersistTaps="handled"
    >
      {downloaded.spec.kind === 'markdown' ? (
        <MarkdownText text={text ?? ''} />
      ) : (
        <Text selectable style={[styles.plainText, { color: theme.text }]}>
          {text ?? ''}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  status: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  statusTitle: { fontSize: Typography.reading, fontWeight: '600', textAlign: 'center' },
  statusDetail: { fontSize: Typography.body, lineHeight: 22, textAlign: 'center' },
  errorTitle: { fontSize: Typography.title, fontWeight: '700' },
  retry: {
    minWidth: 112,
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  retryText: { fontSize: Typography.control, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  pdf: { flex: 1, width: '100%', backgroundColor: '#FFFFFF' },
  reader: { flex: 1, width: '100%' },
  readerContent: { padding: 20, paddingBottom: 48 },
  plainText: { fontFamily: MONOSPACE_FONT, fontSize: Typography.body, lineHeight: 23 },
});
