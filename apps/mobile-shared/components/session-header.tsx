import type { ComponentType, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

type HeaderIcon = ComponentType<{ name: 'desktop' | 'newSession' | 'refresh'; color: string; size: number }>;
type Colors = {
  text: string;
  textSecondary: string;
  surface: string;
  background: string;
  success: string;
  statusNeutral: string;
};

export function DesktopIndicator({ Icon, size, color, online, colors, background }: {
  Icon: HeaderIcon;
  size: number;
  color: string;
  online?: boolean;
  colors: Pick<Colors, 'success' | 'statusNeutral'>;
  background: string;
}) {
  const diameter = size === 14 ? 5 : 8;
  return (
    <View style={{ width: size, height: size }} accessible={false}>
      <Icon name="desktop" color={color} size={size} />
      {online !== undefined && (
        <View style={[styles.dot, {
          width: diameter, height: diameter, borderRadius: diameter / 2,
          borderColor: background, backgroundColor: online ? colors.success : colors.statusNeutral,
        }]} />
      )}
    </View>
  );
}

export function DeviceMenuChevron({ expanded, color }: { expanded: boolean; color: string }) {
  return (
    <View style={[styles.disclosure, expanded && styles.disclosureExpanded]} accessible={false}>
      <View style={[styles.disclosureArm, styles.leftArm, { backgroundColor: color }]} />
      <View style={[styles.disclosureArm, styles.rightArm, { backgroundColor: color }]} />
    </View>
  );
}

export function WorkspaceDisclosureChevron({ expanded, color }: { expanded: boolean; color: string }) {
  return (
    <View style={[styles.workspaceDisclosure, expanded && styles.workspaceDisclosureExpanded]} accessible={false}>
      <View style={[styles.chevron, { borderColor: color }]} />
    </View>
  );
}

export function SessionHeader({
  Icon, colors, title, deviceName, workspaceName, online, refreshing, status, onOpenDrawer, onCreate, onRefresh, children,
}: {
  Icon: HeaderIcon;
  colors: Colors;
  title: string;
  deviceName: string;
  online?: boolean;
  workspaceName: string;
  refreshing: boolean;
  status: ReactNode;
  onOpenDrawer?: () => void;
  onCreate: () => void;
  onRefresh: () => void;
  children?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      {onOpenDrawer && (
        <Pressable accessibilityRole="button" accessibilityLabel="打开会话侧边栏" onPress={onOpenDrawer}
          hitSlop={2} style={({ pressed }) => [styles.menu, { backgroundColor: colors.surface }, pressed && styles.pressed]}>
          <View style={styles.menuLines}>
            <View style={[styles.stroke, { width: 18, backgroundColor: colors.text }]} />
            <View style={[styles.stroke, { width: 12, backgroundColor: colors.text }]} />
          </View>
        </Pressable>
      )}
      <Pressable
        style={styles.heading}
        onPress={onOpenDrawer}
        disabled={!onOpenDrawer}
        accessibilityRole={onOpenDrawer ? 'button' : 'text'}
        accessibilityLabel={[title, deviceName, online === undefined ? undefined : online ? '设备在线' : '设备离线', workspaceName].filter(Boolean).join('，')}
        accessibilityHint={onOpenDrawer ? '打开设备和工作区列表' : undefined}
      >
        <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>{title}</Text>
        <View style={styles.meta}>
          <DesktopIndicator Icon={Icon} size={14} color={colors.textSecondary} online={online}
            colors={colors} background={colors.background} />
          <Text numberOfLines={1} style={[styles.name, !!workspaceName && styles.deviceName, { color: colors.textSecondary }]}>
            {deviceName}
          </Text>
          {!!workspaceName && (
            <>
              <View style={[styles.divider, { backgroundColor: colors.textSecondary }]} />
              <Text numberOfLines={1} style={[styles.name, { color: colors.textSecondary }]}>{workspaceName}</Text>
            </>
          )}
          {!!onOpenDrawer && <View style={[styles.chevron, { borderColor: colors.textSecondary }]} />}
        </View>
      </Pressable>
      {status}
      <View style={styles.actions}>
        <View style={[styles.pill, { backgroundColor: colors.surface }]} />
        <Pressable accessibilityRole="button" accessibilityLabel="新建会话" onPress={onCreate}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Icon name="newSession" size={22} color={colors.text} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="刷新对话" onPress={onRefresh}
          disabled={refreshing} accessibilityState={{ disabled: refreshing, busy: refreshing }}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          {refreshing ? <ActivityIndicator size="small" color={colors.text} /> : <Icon name="refresh" size={22} color={colors.text} />}
        </Pressable>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  menu: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  menuLines: { gap: 5 },
  stroke: { height: 2, borderRadius: 1 },
  heading: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', gap: 2 },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  name: { minWidth: 0, flexShrink: 1, fontSize: 12, lineHeight: 18 },
  deviceName: { maxWidth: '52%' },
  divider: { width: 1, height: 11, marginHorizontal: 2, opacity: 0.45 },
  chevron: { width: 6, height: 6, borderTopWidth: 1.5, borderRightWidth: 1.5, transform: [{ rotate: '45deg' }] },
  disclosure: { width: 18, height: 18, flexShrink: 0 },
  disclosureExpanded: { transform: [{ rotate: '180deg' }] },
  disclosureArm: { position: 'absolute', top: 8, width: 8, height: 1.8, borderRadius: 1 },
  leftArm: { left: 2.3, transform: [{ rotate: '45deg' }] },
  rightArm: { right: 2.3, transform: [{ rotate: '-45deg' }] },
  workspaceDisclosure: { width: 18, height: 18, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  // The down-facing two-stroke chevron needs a slight optical lift after rotation.
  workspaceDisclosureExpanded: { top: -1, transform: [{ rotate: '90deg' }] },
  dot: { position: 'absolute', right: 0, top: 0, borderWidth: 1 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  pill: { position: 'absolute', left: 0, right: 0, top: 2, height: 40, borderRadius: 20 },
  action: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.55 },
});
