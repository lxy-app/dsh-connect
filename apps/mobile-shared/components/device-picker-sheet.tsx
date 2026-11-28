import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { MobileDesktopAccess } from '../types/mobile';

type Props = {
  devices: readonly MobileDesktopAccess[];
  selectedId?: string;
  loading: boolean;
  error: string | null;
  desktopIcon: ReactNode;
  colors: { background: string; surface: string; text: string; textSecondary: string; success: string; border: string };
  bottomInset: number;
  centeredWidth?: number;
  onSelect: (device: MobileDesktopAccess) => void;
  onClose: () => void;
};

/** The compact drawer hosts this overlay in its own Modal so closing it preserves the drawer. */
export function DevicePickerSheet({
  devices, selectedId, loading, error, desktopIcon, colors, bottomInset, centeredWidth, onSelect, onClose,
}: Props) {
  return (
    <View style={[styles.overlay, !!centeredWidth && styles.centered]} accessibilityViewIsModal onAccessibilityEscape={onClose}>
      <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={[
        styles.sheet, { backgroundColor: colors.background, paddingBottom: Math.max(bottomInset, 20) },
        centeredWidth ? { maxWidth: centeredWidth, borderRadius: 22 } : styles.bottomSheet,
      ]}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>选择设备</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭设备选择" onPress={onClose}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
            <Text style={[styles.cross, { color: colors.textSecondary }]}>×</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={[styles.list, { backgroundColor: colors.surface }]}>
            {devices.map((device, index) => {
              const selected = device.deviceId === selectedId;
              const status = device.online ? '在线' : '离线';
              const statusColor = device.online ? colors.success : colors.textSecondary;
              return (
                <Pressable key={device.deviceId} accessibilityRole="button" accessibilityState={{ selected }}
                  accessibilityLabel={`${device.deviceName}，${status}`} onPress={() => onSelect(device)}
                  style={({ pressed }) => [styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border }, pressed && styles.pressed]}>
                  {desktopIcon}
                  <Text numberOfLines={2} style={[styles.name, { color: colors.text }]}>{device.deviceName}</Text>
                  <Text style={[styles.badge, { color: statusColor, backgroundColor: statusColor + '18' }]}>{status}</Text>
                  {selected && <Text style={[styles.check, { color: colors.success }]}>✓</Text>}
                </Pressable>
              );
            })}
            {devices.length === 0 && (
              <Text style={[styles.empty, { color: colors.textSecondary }]}>{loading ? '正在加载设备…' : error || '暂无已授权设备'}</Text>
            )}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 20, elevation: 20, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.60)' },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxHeight: '78%', paddingHorizontal: 20, paddingTop: 10, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  bottomSheet: { minHeight: '38%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: 18, lineHeight: 25, fontWeight: '600' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  cross: { fontSize: 27, lineHeight: 32 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  list: { borderRadius: 15, overflow: 'hidden' },
  row: { minHeight: 58, paddingVertical: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 9 },
  name: { flexShrink: 1, minWidth: 0, fontSize: 16, lineHeight: 22 },
  badge: { borderRadius: 4, overflow: 'hidden', paddingHorizontal: 5, paddingVertical: 1, fontSize: 12, lineHeight: 18 },
  check: { marginLeft: 'auto', fontSize: 21, fontWeight: '600' },
  empty: { paddingVertical: 18, fontSize: 14, textAlign: 'center' },
  pressed: { opacity: 0.6 },
});
