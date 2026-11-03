import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AttachmentImage } from '@/components/attachment-image';
import { AttachmentViewer } from '@/components/attachment-viewer';
import type { MobileAttachment } from '@/types/mobile';
import { useAppTheme } from '@/hooks/use-app-theme';

export type AttachmentAuth = { readonly serverUrl: string; readonly accessToken: string };

const MAX_VISIBLE = 4;
const GAP = 6;
const RADIUS = 12;

/**
 * Renders the files a session declared next to the message that delivered them.
 *
 * M1 shows images inline and non-image files as a compact row; opening a file
 * beyond the app is M2. Nothing here ever sees a desktop path: the only input
 * is the opaque attachment id plus the Server URL.
 */
export function AttachmentGrid({
  attachments,
  auth,
}: {
  attachments: readonly MobileAttachment[];
  auth: AttachmentAuth | null;
}) {
  const theme = useAppTheme();
  const images = useMemo(
    () => attachments.filter((attachment) => attachment.kind === 'image'),
    [attachments],
  );
  const files = useMemo(
    () => attachments.filter((attachment) => attachment.kind !== 'image'),
    [attachments],
  );
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const visible = images.slice(0, MAX_VISIBLE);

  if (attachments.length === 0) return null;

  return (
    <View style={styles.container}>
      {images.length > 0 ? (
        <View style={styles.grid}>
          {visible.map((attachment, index) => {
            const isSingle = images.length === 1;
            return (
              <Pressable
                key={attachment.attachmentId}
                accessibilityRole="imagebutton"
                accessibilityLabel={`打开图片 ${attachment.name}`}
                onPress={() => setViewerIndex(index)}
                style={({ pressed }) => [
                  styles.cell,
                  isSingle ? styles.cellSingle : styles.cellGrid,
                  pressed && styles.pressed,
                  { backgroundColor: theme.surfaceMuted },
                ]}
              >
                <AttachmentImage
                  attachment={attachment}
                  auth={auth}
                  style={styles.image}
                  contentFit="cover"
                  accessibilityLabel={`图片 ${attachment.name}`}
                />
                {index === MAX_VISIBLE - 1 && images.length > MAX_VISIBLE ? (
                  <View style={[styles.badge, styles.badgeMore]}>
                    <Text style={styles.badgeText}>+{images.length - MAX_VISIBLE}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {files.map((attachment) => (
        <View
          key={attachment.attachmentId}
          style={[styles.fileRow, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}
        >
          <Text style={[styles.fileKind, { color: theme.textSecondary }]}>
            {attachment.name.split('.').pop()?.toUpperCase().slice(0, 4) ?? 'FILE'}
          </Text>
          <View style={styles.fileText}>
            <Text numberOfLines={1} style={[styles.fileName, { color: theme.text }]}>
              {attachment.name}
            </Text>
            <Text style={[styles.fileMeta, { color: theme.textSecondary }]}>
              {formatBytes(attachment.bytes)}
              {attachment.state === 'unavailable'
                ? ' · 文件已在桌面删除或过期'
                : attachment.state === 'failed'
                  ? ' · 加载失败'
                  : ' · 文件预览将在后续版本提供'}
            </Text>
          </View>
        </View>
      ))}

      {viewerIndex !== null ? (
        <AttachmentViewer
          attachments={images}
          auth={auth}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
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
  container: { gap: GAP, marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  cell: { borderRadius: RADIUS, overflow: 'hidden' },
  cellSingle: { width: '100%', aspectRatio: 16 / 10 },
  cellGrid: { width: '48.5%', aspectRatio: 1 },
  image: { width: '100%', height: '100%' },
  pressed: { opacity: 0.85 },
  badge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  badgeMore: { left: undefined, right: 6, bottom: 6 },
  badgeText: { color: '#fff', fontSize: 11 },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fileKind: { fontSize: 11, fontWeight: '700', width: 38 },
  fileText: { flex: 1, gap: 2 },
  fileName: { fontSize: 14, fontWeight: '600' },
  fileMeta: { fontSize: 12 },
});
