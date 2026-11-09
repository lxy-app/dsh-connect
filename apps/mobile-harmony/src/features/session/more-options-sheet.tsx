import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { modelLabel, sameModelSelection } from '@shared/lib/session-model';
import type { MobileSessionModelCatalog } from '@shared/types/mobile';

export function MoreOptionsSheet({
  visible,
  catalog,
  refreshing,
  onClose,
  onOpenModel,
}: {
  visible: boolean;
  catalog: MobileSessionModelCatalog | null;
  refreshing: boolean;
  onClose: () => void;
  onOpenModel: () => void;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const diverged = catalog !== null && !sameModelSelection(catalog.effective, catalog.default);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel="关闭更多输入选项" style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.surface, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          <Text style={[styles.title, { color: theme.text }]}>更多输入选项</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="选择会话模型"
            onPress={onOpenModel}
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
          <Text style={[styles.attachmentHint, { color: theme.textSecondary }]}>
            附件发送尚未开放，当前可使用文字或语音输入。
          </Text>
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
  modelAction: { minHeight: 62, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionCopy: { flex: 1, gap: 4 },
  actionTitle: { fontSize: Typography.control, lineHeight: 21, fontWeight: '600' },
  currentRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  currentModel: { flexShrink: 1, fontSize: Typography.secondary, lineHeight: 18 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  chevron: { fontSize: 28, lineHeight: 30 },
  attachmentHint: { fontSize: Typography.caption, lineHeight: 18, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4 },
});
