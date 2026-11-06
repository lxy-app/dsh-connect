import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  modelBadgeText,
  modelLabel,
  sameModelSelection,
  selectionForRoute,
  selectionInCatalog,
  selectionKey,
} from '@/lib/session-model';
import type { SessionModelPending } from '@/features/session/session-model-provider';
import type { MobileModelSelection, MobileSessionModelCatalog } from '@/types/mobile';

export function ModelSheet({
  visible,
  catalog,
  loading,
  refreshing,
  error,
  pending,
  canSelect,
  onClose,
  onRefresh,
  onSelect,
}: {
  visible: boolean;
  catalog: MobileSessionModelCatalog | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  pending: SessionModelPending | null;
  canSelect: boolean;
  onClose: () => void;
  onRefresh: (silent?: boolean) => Promise<void>;
  onSelect: (selection: MobileModelSelection) => void;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const migrationRequired = catalog?.projectionKind === 'migration-required';
  const effectiveUnavailable = catalog !== null && !selectionInCatalog(catalog, catalog.effective);

  const canAttempt = (selection: MobileModelSelection): boolean => {
    if (!canSelect || migrationRequired) return false;
    if (pending?.status === 'submitting') return false;
    if (pending?.status === 'uncertain') return selectionKey(pending.selection) === selectionKey(selection);
    return true;
  };
  const attempt = (selection: MobileModelSelection | null): void => {
    if (selection && canAttempt(selection)) onSelect(selection);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel="关闭模型选择" style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.surface, paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          <View style={styles.heading}>
            <View style={styles.headingCopy}>
              <Text style={[styles.title, { color: theme.text }]}>选择模型</Text>
              <Text style={[styles.subtitle, { color: theme.textSecondary }]}>仅对当前会话生效</Text>
            </View>
            {refreshing ? <ActivityIndicator color={theme.accent} size="small" /> : null}
          </View>

          {pending ? (
            <View style={[styles.notice, { backgroundColor: pending.status === 'uncertain' ? theme.warningSoft : theme.accentSoft }]}>
              <Text style={[styles.noticeText, { color: pending.status === 'uncertain' ? theme.warning : theme.accent }]}>
                {pending.status === 'uncertain'
                  ? '上次切换结果未确认。点击同一模型与强度可安全重试，其他选择已暂时锁定。'
                  : `正在切换为 ${modelLabel(catalog, pending.selection)}…`}
              </Text>
            </View>
          ) : null}
          {migrationRequired ? (
            <View style={[styles.notice, { backgroundColor: theme.warningSoft }]}>
              <Text style={[styles.noticeText, { color: theme.warning }]}>当前模型信息来自缓存，可能已过期。请先在桌面打开会话并完成迁移。</Text>
            </View>
          ) : null}
          {!canSelect ? (
            <Text style={[styles.readOnlyHint, { color: theme.textSecondary }]}>当前授权只允许查看模型，不能切换。</Text>
          ) : null}
          {effectiveUnavailable && catalog ? (
            <View style={[styles.notice, { backgroundColor: theme.dangerSoft }]}>
              <Text style={[styles.noticeText, { color: theme.danger }]}>
                当前选择 {modelLabel(catalog, catalog.effective)} 已不在可用目录中。发送前请重新选择可用模型。
              </Text>
            </View>
          ) : null}
          {error ? (
            <View style={[styles.errorRow, { borderColor: theme.danger }]}>
              <Text style={[styles.errorText, { color: theme.danger }]}>{error}</Text>
              <Pressable accessibilityRole="button" onPress={() => void onRefresh()}>
                <Text style={[styles.retry, { color: theme.accent }]}>重试</Text>
              </Pressable>
            </View>
          ) : null}

          {loading && !catalog ? (
            <View style={styles.centerState}><ActivityIndicator color={theme.accent} /><Text style={[styles.stateText, { color: theme.textSecondary }]}>正在加载模型目录…</Text></View>
          ) : null}
          {!loading && !catalog && !error ? (
            <View style={styles.centerState}><Text style={[styles.stateText, { color: theme.textSecondary }]}>模型目录暂时不可用。</Text></View>
          ) : null}

          {catalog ? (
            <ScrollView style={styles.catalog} contentContainerStyle={styles.catalogContent} nestedScrollEnabled>
              {catalog.groups.map((group) => (
                <View key={group.id} style={styles.group}>
                  <Text style={[styles.groupTitle, { color: theme.textSecondary }]}>{group.name}</Text>
                  {group.models.map((model) => {
                    const route = { provider: group.id, model: model.id };
                    const candidate = selectionForRoute(catalog, catalog.effective, route);
                    const selected = sameModelSelection(catalog.effective, candidate);
                    const routeBusy = pending?.selection.provider === group.id && pending.selection.model === model.id;
                    const currentEffort = catalog.effective.reasoningEffort;
                    return (
                      <View key={model.id} style={styles.modelBlock}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`选择 ${group.name} ${model.name}`}
                          accessibilityState={{ disabled: !candidate || !canAttempt(candidate), selected, busy: routeBusy }}
                          disabled={!candidate || !canAttempt(candidate)}
                          onPress={() => attempt(candidate)}
                          style={({ pressed }) => [
                            styles.modelRow,
                            { backgroundColor: selected ? theme.accentSoft : pressed ? theme.surfaceMuted : 'transparent' },
                            (!candidate || !canAttempt(candidate)) && styles.disabled,
                          ]}
                        >
                          <View style={styles.modelCopy}>
                            <View style={styles.modelNameRow}>
                              <Text numberOfLines={1} style={[styles.modelName, { color: theme.text }]}>{model.name}</Text>
                              {model.badge ? <Text style={[styles.badge, { color: theme.accent }]}>{modelBadgeText(model.badge.text)}</Text> : null}
                            </View>
                            {model.description ? <Text style={[styles.modelDescription, { color: theme.textSecondary }]}>{model.description}</Text> : null}
                          </View>
                          {routeBusy ? <ActivityIndicator color={theme.accent} size="small" /> : selected ? <Text style={[styles.selected, { color: theme.accent }]}>当前</Text> : null}
                        </Pressable>

                        {selected && model.reasoning && model.reasoning.efforts.length > 0 ? (
                          <View style={styles.effortPanel}>
                            <Text style={[styles.effortTitle, { color: theme.textSecondary }]}>推理强度</Text>
                            <View style={styles.effortList}>
                              {(() => {
                                const automatic: MobileModelSelection = route;
                                const active = currentEffort === undefined;
                                return (
                                  <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="推理强度自动"
                                    disabled={!canAttempt(automatic)}
                                    onPress={() => attempt(automatic)}
                                    style={[styles.effortChip, { backgroundColor: active ? theme.accentSoft : theme.surfaceMuted }, !canAttempt(automatic) && styles.disabled]}
                                  >
                                    <Text style={[styles.effortText, { color: active ? theme.accent : theme.textSecondary }]}>自动</Text>
                                  </Pressable>
                                );
                              })()}
                              {model.reasoning.efforts.map((effort) => {
                                const effortSelection = selectionForRoute(catalog, catalog.effective, route, effort.id);
                                const active = currentEffort === effort.id;
                                return (
                                  <Pressable
                                    key={effort.id}
                                    accessibilityRole="button"
                                    accessibilityLabel={`推理强度 ${effort.name}`}
                                    disabled={!effortSelection || !canAttempt(effortSelection)}
                                    onPress={() => attempt(effortSelection)}
                                    style={[styles.effortChip, { backgroundColor: active ? theme.accentSoft : theme.surfaceMuted }, (!effortSelection || !canAttempt(effortSelection)) && styles.disabled]}
                                  >
                                    <Text style={[styles.effortText, { color: active ? theme.accent : theme.textSecondary }]}>{effort.name}</Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ))}
              {catalog.failures.map((failure) => (
                <View key={failure.id} style={[styles.failure, { borderColor: theme.border }]}>
                  <Text style={[styles.failureTitle, { color: theme.warning }]}>{failure.name} 不可用</Text>
                  <Text style={[styles.failureMessage, { color: theme.textSecondary }]}>{failure.message}</Text>
                </View>
              ))}
              {catalog.groups.every((group) => group.models.length === 0) && catalog.failures.length === 0 ? (
                <View style={styles.centerState}><Text style={[styles.stateText, { color: theme.textSecondary }]}>暂无可用模型，请先在桌面 DSH 中配置提供方。</Text></View>
              ) : null}
            </ScrollView>
          ) : null}

          <Text style={[styles.footerHint, { color: theme.textSecondary }]}>
            不修改桌面默认模型。已经准备的步骤保持不变，后续尚未准备的步骤使用新模型。
          </Text>
          <Pressable accessibilityRole="button" onPress={onClose} style={[styles.done, { backgroundColor: theme.accent }]}>
            <Text style={[styles.doneText, { color: theme.onAccent }]}>完成</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.42)' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sheet: { maxHeight: '88%', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginBottom: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  headingCopy: { flex: 1 },
  title: { fontSize: Typography.title, lineHeight: 24, fontWeight: '700' },
  subtitle: { fontSize: Typography.caption, lineHeight: 18, marginTop: 2 },
  notice: { borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, marginBottom: 10 },
  noticeText: { fontSize: Typography.secondary, lineHeight: 19 },
  readOnlyHint: { fontSize: Typography.caption, lineHeight: 18, marginBottom: 10 },
  errorRow: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  errorText: { flex: 1, fontSize: Typography.secondary, lineHeight: 19 },
  retry: { fontSize: Typography.body, lineHeight: 20, fontWeight: '700' },
  catalog: { flexGrow: 0, flexShrink: 1 },
  catalogContent: { paddingBottom: 8, gap: 14 },
  group: { gap: 4 },
  groupTitle: { fontSize: Typography.caption, lineHeight: 18, fontWeight: '700', paddingHorizontal: 4, marginBottom: 2 },
  modelBlock: { gap: 2 },
  modelRow: { minHeight: 52, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 10 },
  modelCopy: { flex: 1, gap: 2 },
  modelNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  modelName: { flexShrink: 1, fontSize: Typography.control, lineHeight: 21, fontWeight: '600' },
  modelDescription: { fontSize: Typography.caption, lineHeight: 17 },
  badge: { fontSize: 10, lineHeight: 14, fontWeight: '700' },
  selected: { fontSize: Typography.caption, lineHeight: 18, fontWeight: '700' },
  effortPanel: { paddingHorizontal: 12, paddingVertical: 7, gap: 6 },
  effortTitle: { fontSize: Typography.caption, lineHeight: 17 },
  effortList: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  effortChip: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  effortText: { fontSize: Typography.caption, lineHeight: 17, fontWeight: '600' },
  failure: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 3 },
  failureTitle: { fontSize: Typography.secondary, lineHeight: 19, fontWeight: '600' },
  failureMessage: { fontSize: Typography.caption, lineHeight: 17 },
  centerState: { minHeight: 110, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 20 },
  stateText: { fontSize: Typography.body, lineHeight: 21, textAlign: 'center' },
  footerHint: { fontSize: Typography.caption, lineHeight: 18, textAlign: 'center', paddingHorizontal: 6, paddingTop: 8 },
  done: { minHeight: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  doneText: { fontSize: Typography.control, lineHeight: 21, fontWeight: '700' },
  disabled: { opacity: 0.42 },
});
