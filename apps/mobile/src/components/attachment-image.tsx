import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';
import {
  attachmentImageSource,
  shouldAutoRetryAttachment,
  type AttachmentImageAuth,
} from '@/lib/attachment-loading';
import type { MobileAttachment } from '@shared/types/mobile';

const AUTO_RETRY_DELAY_MS = 1_000;

type AttachmentImageProps = {
  readonly attachment: MobileAttachment;
  readonly auth: AttachmentImageAuth | null;
  readonly style: StyleProp<ViewStyle>;
  readonly contentFit: 'cover' | 'contain';
  readonly accessibilityLabel: string;
  readonly onLoad?: (dimensions: { readonly width: number; readonly height: number }) => void;
};

/**
 * Loads an authenticated attachment and exposes native HTTP/decode failures.
 * The expected 202 response retries while the Connector uploads the bytes.
 */
export function AttachmentImage(props: AttachmentImageProps) {
  const theme = useAppTheme();
  if (!props.auth) {
    return (
      <View style={props.style}>
        <View style={[styles.status, { backgroundColor: theme.surfaceMuted }]}>
          <ActivityIndicator color={theme.accent} />
          <Text style={[styles.statusText, { color: theme.textSecondary }]}>正在准备登录凭据…</Text>
        </View>
      </View>
    );
  }
  return <RemoteAttachmentImage {...props} auth={props.auth} />;
}

function RemoteAttachmentImage({
  attachment,
  auth,
  style,
  contentFit,
  accessibilityLabel,
  onLoad,
}: AttachmentImageProps & { readonly auth: AttachmentImageAuth }) {
  const theme = useAppTheme();
  const [loadState, setLoadState] = useState<
    { readonly key: string; readonly status: 'loading' | 'loaded' | 'error'; readonly message?: string } | null
  >(null);
  const [retryCount, setRetryCount] = useState(0);
  const attachmentId = attachment.attachmentId;
  const sha256 = attachment.sha256;
  const serverUrl = auth.serverUrl;
  const accessToken = auth.accessToken;
  const source = useMemo(
    () => attachmentImageSource(
      { attachmentId, ...(sha256 !== undefined ? { sha256 } : {}) },
      { serverUrl, accessToken },
      retryCount,
    ),
    [attachmentId, sha256, serverUrl, accessToken, retryCount],
  );
  const loadKey = `${source.uri}|${attachment.state}|${auth.accessToken}|${retryCount}`;
  const error = loadState?.key === loadKey && loadState.status === 'error'
    ? loadState.message || '图片加载失败'
    : null;
  const loaded = loadState?.key === loadKey && loadState.status === 'loaded';

  const autoRetry = shouldAutoRetryAttachment(attachment.state, error, retryCount);
  useEffect(() => {
    if (!autoRetry) return;
    const timer = setTimeout(() => {
      setRetryCount((current) => current + 1);
    }, AUTO_RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [autoRetry, retryCount]);

  const retry = () => {
    setRetryCount((current) => current + 1);
  };

  return (
    <View style={style}>
      <Image
        key={loadKey}
        source={source}
        style={styles.image}
        contentFit={contentFit}
        cachePolicy="memory-disk"
        accessibilityLabel={accessibilityLabel}
        transition={120}
        onLoadStart={() => setLoadState({ key: loadKey, status: 'loading' })}
        onLoad={(event) => {
          setLoadState({ key: loadKey, status: 'loaded' });
          if (event.source.width > 0 && event.source.height > 0) {
            onLoad?.({ width: event.source.width, height: event.source.height });
          }
        }}
        onError={(event) => setLoadState({ key: loadKey, status: 'error', message: event.error })}
      />
      {error && !autoRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`重新加载图片 ${attachment.name}`}
          onPress={(event) => {
            event.stopPropagation();
            retry();
          }}
          style={[styles.status, styles.retry, { backgroundColor: theme.surfaceMuted }]}
        >
          <Text style={[styles.errorTitle, { color: theme.danger }]}>图片加载失败，点击重试</Text>
          <Text numberOfLines={2} style={[styles.errorDetail, { color: theme.textSecondary }]}>
            {error}
          </Text>
        </Pressable>
      ) : !loaded ? (
        <View style={[styles.status, { backgroundColor: theme.surfaceMuted }]}>
          <ActivityIndicator color={theme.accent} />
          <Text style={[styles.statusText, { color: theme.textSecondary }]}>
            {autoRetry
              ? '图片尚未就绪，正在重试…'
              : attachment.state === 'known' || attachment.state === 'fetching'
                ? '正在准备图片…'
                : '正在加载图片…'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  image: { width: '100%', height: '100%' },
  status: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
  },
  statusText: { fontSize: 12, textAlign: 'center' },
  retry: { borderRadius: 12 },
  errorTitle: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  errorDetail: { fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
