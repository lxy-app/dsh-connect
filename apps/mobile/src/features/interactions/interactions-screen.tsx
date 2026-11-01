import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/empty-state';
import { useAppTheme } from '@/hooks/use-app-theme';
import { describeMobileApiError } from '@/lib/mobile-api';
import { useInteractions, type InteractionDecision } from '@/providers/interactions-provider';
import type { MobileInteraction } from '@/types/mobile';

import { InteractionCard } from './interaction-card';

/** The phone's TODO inbox for approvals and questions raised by the desktop. */
export function InteractionsScreen({ embedded = false }: { embedded?: boolean }) {
  const theme = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { interactions, busyId, refresh, decide } = useInteractions();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refresh().finally(() => setRefreshing(false));
  }, [refresh]);

  const onDecision = useCallback(
    (interaction: MobileInteraction, decision: InteractionDecision) => {
      void decide(interaction, decision).catch((error: unknown) => {
        Alert.alert('提交失败', describeMobileApiError(error));
      });
    },
    [decide],
  );

  const openSession = (interaction: MobileInteraction) => {
    router.push({
      pathname: '/session/[sessionId]',
      params: {
        sessionId: interaction.sessionId,
        deviceId: interaction.deviceId,
        workspaceId: interaction.workspaceId,
        title: interaction.title,
        deviceName: interaction.deviceName,
        workspaceName: interaction.workspaceName,
        scopes: JSON.stringify(['read']),
      },
    });
  };

  return (
    <View style={[styles.page, { backgroundColor: theme.background, paddingTop: embedded ? 0 : insets.top }]}>
      {!embedded ? (
      <View style={styles.head}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          hitSlop={10}
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: theme.surface, borderColor: theme.border },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.iconText, { color: theme.text }]}>‹</Text>
        </Pressable>
        <View style={styles.headText}>
          <Text style={[styles.title, { color: theme.text }]}>待处理</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            桌面上等待你决定的审批与提问
          </Text>
        </View>
      </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
        showsVerticalScrollIndicator={false}
      >
        {interactions.length === 0 ? (
          <EmptyState
            title="没有待处理事项"
            description="DSH 需要你审批工具调用或回答问题时，会在这里出现；桌面端批准后会自动消失。"
          />
        ) : (
          interactions.map((interaction) => (
            <View key={interaction.interactionId} style={styles.item}>
              <InteractionCard
                interaction={interaction}
                busy={busyId === interaction.interactionId}
                onDecision={(decision) => onDecision(interaction, decision)}
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => openSession(interaction)}
                style={({ pressed }) => [styles.link, pressed && styles.pressed]}
              >
                <Text style={[styles.linkText, { color: theme.accent }]}>查看会话</Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 22,
    lineHeight: 24,
    marginTop: -2,
  },
  headText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
  },
  body: {
    paddingBottom: 32,
  },
  item: {
    marginBottom: 4,
  },
  link: {
    alignSelf: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 4,
    marginBottom: 10,
  },
  linkText: {
    fontSize: 12,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
  },
});
