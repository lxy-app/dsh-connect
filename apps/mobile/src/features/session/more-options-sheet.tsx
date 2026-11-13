import { useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { SheetAction } from '@/lib/sheet-action';
import type { AttachmentSource } from '@/lib/attachment-picker';
import { modelLabel, sameModelSelection } from '@shared/lib/session-model';
import type { MobileSessionModelCatalog } from '@shared/types/mobile';

export function MoreOptionsSheet({
  visible,
  catalog,
  refreshing,
  attachmentSlots,
  onPickAttachments,
  onClose,
  onOpenModel,
}: {
  visible: boolean;
  catalog: MobileSessionModelCatalog | null;
  refreshing: boolean;
  /** Remaining attachment slots; zero disables the pickers. */
  attachmentSlots: number;
  onPickAttachments: (source: AttachmentSource) => void;
  onClose: () => void;
  onOpenModel: () => void;
}) {
  const [sheetAction] = useState(() => new SheetAction());
  const select = (action: () => void) => sheetAction.select(onClose, action, Platform.OS === 'ios');
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const diverged = catalog !== null && !sameModelSelection(catalog.effective, catalog.default);
  const pickersDisabled = attachmentSlots <= 0;
  const tiles: readonly { source: AttachmentSource; label: string; glyph: string }[] = [
    { source: 'camera', label: '拍照', glyph: '◎' },
    { source: 'library', label: '选择照片', glyph: '▣' },
    { source: 'document', label: '添加文件', glyph: '⎘' },
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onDismiss={() => sheetAction.dismissed()}>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel="关闭更多输入选项" style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.surface, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          <Text style={[styles.title, { color: theme.text }]}>更多输入选项</Text>
          <View style={styles.attachmentGrid}>
            {tiles.map((tile) => (
              <Pressable
                key={tile.source}
                accessibilityRole="button"
                accessibilityLabel={tile.label}
                accessibilityState={{ disabled: pickersDisabled }}
                disabled={pickersDisabled}
                onPress={() => select(() => onPickAttachments(tile.source))}
                style={({ pressed }) => [
                  styles.attachmentTile,
                  { backgroundColor: theme.surfaceMuted, borderColor: theme.border, opacity: pickersDisabled ? 0.45 : 1 },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.attachmentGlyph, { color: theme.accent }]}>{tile.glyph}</Text>
                <Text style={[styles.attachmentLabel, { color: theme.text }]}>{tile.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.attachmentHint, { color: theme.textSecondary }]}>
            {pickersDisabled
              ? '已达单条消息附件上限，请先发送或移除部分附件。'
              : `附件随当前指令发送，先进入待发送区，可继续补充文字。还可添加 ${attachmentSlots} 个。`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="选择会话模型"
            onPress={() => select(onOpenModel)}
            style={({ pressed }) => [styles.modelAction, { backgroundColor: pressed ? theme.surfaceMuted : 'transparent' }]}
          >
            <View style={styles.actionCopy}>
              <Text style={[styles.actionTitle, { color: theme.text }]}>选择模型</Text>
              <View style={styles.currentRow}>
                {diverged ? <View style={[styles.dot, { backgroundColor: theme.accent }]} /> : null}
                <Text numberOfLines={1} style={[styles.currentModel, { color: theme.textSecondary }]}>
                  {catalog ? modelLabel(catalog, catalog.effective) : '查看当前会话与可用模型'}
                </Text>
              </View>
            </View>
            {refreshing ? <ActivityIndicator color={theme.accent} size="small" /> : <Text style={[styles.chevron, { color: theme.textSecondary }]}>›</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.42)' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginBottom: 14 },
  title: { fontSize: Typography.title, lineHeight: 24, fontWeight: '700', marginBottom: 10 },
  attachmentGrid: { flexDirection: 'row', gap: 8 },
  attachmentTile: {
    flex: 1,
    minHeight: 74,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  attachmentGlyph: { fontSize: 22, lineHeight: 26 },
  attachmentLabel: { fontSize: Typography.caption, fontWeight: '600' },
  attachmentHint: { fontSize: Typography.caption, lineHeight: 18, paddingHorizontal: 2, paddingTop: 10, paddingBottom: 4 },
  modelAction: { minHeight: 62, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  actionCopy: { flex: 1, gap: 4 },
  actionTitle: { fontSize: Typography.control, lineHeight: 21, fontWeight: '600' },
  currentRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  currentModel: { flexShrink: 1, fontSize: Typography.secondary, lineHeight: 18 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  chevron: { fontSize: 28, lineHeight: 30 },
  pressed: { opacity: 0.75 },
});