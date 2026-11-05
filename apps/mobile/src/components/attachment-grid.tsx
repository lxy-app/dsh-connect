import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MobileAttachment } from '@/types/mobile';
import { useAppTheme } from '@/hooks/use-app-theme';

export type AttachmentAuth = { readonly serverUrl: string; readonly accessToken: string };

/**
 * Displays attachment metadata without mounting an image loader. Image bytes
 * are fetched only when the shared MessageRow opens the viewer for one card.
 */
export function AttachmentGrid({
  attachments,
  onOpen,
}: {
  attachments: readonly MobileAttachment[];
  onOpen: (attachment: MobileAttachment) => void;
}) {
  const theme = useAppTheme();
  if (attachments.length === 0) return null;

  return (
    <View style={styles.container}>
      {attachments.map((attachment) => {
        const isImage = attachment.kind === 'image';
        return (
          <Pressable
            key={attachment.attachmentId}
            accessibilityRole={isImage ? 'imagebutton' : undefined}
            accessibilityLabel={isImage ? `打开图片 ${attachment.name}` : attachment.name}
            disabled={!isImage}
            onPress={() => onOpen(attachment)}
            style={({ pressed }) => [
              styles.fileRow,
              { backgroundColor: theme.surfaceMuted, borderColor: theme.border },
              pressed && isImage && styles.pressed,
            ]}
          >
            <Text style={[styles.fileKind, { color: theme.textSecondary }]}>
              {attachment.name.split('.').pop()?.toUpperCase().slice(0, 4) ?? 'FILE'}
            </Text>
            <View style={styles.fileText}>
              <Text numberOfLines={1} style={[styles.fileName, { color: theme.text }]}>
                {attachment.name}
              </Text>
              <Text numberOfLines={2} style={[styles.fileMeta, { color: theme.textSecondary }]}>
                {attachment.description ? `${attachment.description} · ` : ''}
                {formatBytes(attachment.bytes)}
                {attachment.state === 'unavailable'
                  ? ' · 文件已在桌面删除或过期'
                  : attachment.state === 'failed'
                    ? ' · 加载失败，点击查看详情'
                    : isImage
                      ? ' · 点击查看原图'
                      : ' · 文件预览将在后续版本提供'}
              </Text>
            </View>
            {isImage ? (
              <Text style={[styles.fileChevron, { color: theme.textSecondary }]}>›</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  container: { gap: 6, marginTop: 8 },
  pressed: { opacity: 0.85 },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fileKind: { fontSize: 11, fontWeight: '700', width: 38 },
  fileText: { flex: 1, gap: 2 },
  fileName: { fontSize: 14, fontWeight: '600' },
  fileMeta: { fontSize: 12 },
  fileChevron: { fontSize: 24, lineHeight: 24 },
});
