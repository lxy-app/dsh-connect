import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';
import { Typography } from '@/constants/theme';
import { formatBytes, type PromptAttachmentDraft } from '@shared/lib/prompt-attachments';

const TILE_SIZE = 64;

/**
 * Attachment drafts sit above the input capsule, so text and files compose one
 * prompt. Each tile can preview (images) or be removed before sending; a failed
 * upload stays visible with a retry affordance instead of silently vanishing.
 */
export function AttachmentDraftBar({
  attachments,
  disabled,
  onRemove,
  onRetry,
  onAdd,
}: {
  attachments: readonly PromptAttachmentDraft[];
  disabled: boolean;
  onRemove: (localId: string) => void;
  onRetry: (localId: string) => void;
  onAdd: () => void;
}) {
  const theme = useAppTheme();
  if (attachments.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}
      contentContainerStyle={styles.content}
      accessibilityLabel="待发送附件"
    >
      {attachments.map((draft) => {
        const failed = draft.state === 'failed';
        const uploading = draft.state === 'uploading';
        return (
          <View key={draft.localId} style={[styles.tile, draft.kind === 'file' && styles.fileTile]}>
            <View
              style={[
                draft.kind === 'file' ? styles.fileCard : styles.imageCard,
                { backgroundColor: theme.surfaceMuted, borderColor: failed ? theme.danger : theme.border },
              ]}
            >
              {draft.kind === 'image' ? (
                <Image source={{ uri: draft.uri }} style={styles.image} contentFit="cover" accessibilityLabel={draft.name} />
              ) : (
                <View style={styles.fileRow}>
                  <View style={[styles.fileKind, { backgroundColor: theme.accentSoft }]}>
                    <Text style={[styles.fileKindText, { color: theme.accent }]}>
                      {draft.name.split('.').pop()?.toUpperCase().slice(0, 4) ?? 'FILE'}
                    </Text>
                  </View>
                  <View style={styles.fileText}>
                    <Text numberOfLines={1} style={[styles.fileName, { color: theme.text }]}>
                      {draft.name}
                    </Text>
                    <Text numberOfLines={1} style={[styles.fileMeta, { color: failed ? theme.danger : theme.textSecondary }]}>
                      {failed ? draft.error ?? '上传失败' : uploading ? '上传中…' : formatBytes(draft.bytes)}
                    </Text>
                  </View>
                </View>
              )}
              {failed ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`重试 ${draft.name}`}
                  disabled={disabled}
                  onPress={() => onRetry(draft.localId)}
                  style={({ pressed }) => [styles.retry, { borderColor: theme.danger, backgroundColor: theme.surface }, pressed && styles.pressed]}
                >
                  <Text style={[styles.retryText, { color: theme.danger }]}>重试</Text>
                </Pressable>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`移除 ${draft.name}`}
              disabled={disabled || uploading}
              onPress={() => onRemove(draft.localId)}
              style={({ pressed }) => [
                styles.remove,
                { backgroundColor: theme.text, borderColor: theme.background, opacity: disabled || uploading ? 0.4 : 1 },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.removeText, { color: theme.background }]}>×</Text>
            </Pressable>
          </View>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="继续添加附件"
        disabled={disabled}
        onPress={onAdd}
        style={({ pressed }) => [styles.add, { borderColor: theme.border, opacity: disabled ? 0.45 : 1 }, pressed && styles.pressed]}
      >
        <Text style={[styles.addText, { color: theme.textSecondary }]}>＋</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: TILE_SIZE + 10 },
  content: { gap: 8, paddingHorizontal: 2, paddingTop: 2, paddingBottom: 8, alignItems: 'center' },
  tile: { width: TILE_SIZE, height: TILE_SIZE },
  fileTile: { width: 188 },
  imageCard: { width: TILE_SIZE, height: TILE_SIZE, borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  fileCard: { width: 188, height: TILE_SIZE, borderRadius: 14, borderWidth: 1, paddingHorizontal: 8, justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fileKind: { width: 34, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  fileKindText: { fontSize: Typography.caption, fontWeight: '700' },
  fileText: { flex: 1, minWidth: 0, gap: 3 },
  fileName: { fontSize: Typography.caption, fontWeight: '600' },
  fileMeta: { fontSize: Typography.caption },
  retry: { position: 'absolute', bottom: 3, right: 4, borderWidth: 1, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2 },
  retryText: { fontSize: Typography.caption, fontWeight: '600' },
  remove: {
    position: 'absolute',
    right: -6,
    top: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { fontSize: 12, lineHeight: 14, fontWeight: '700' },
  add: { width: 52, height: TILE_SIZE, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  addText: { fontSize: 22, lineHeight: 24 },
  pressed: { opacity: 0.7 },
});