import { useFocusEffect, useRouter } from 'expo-router';
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
import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { describeMobileApiError, getMobileAccessOverview } from '@/lib/mobile-api';
import { useInteractions, type InteractionDecision } from '@/providers/interactions-provider';
import { useMobileSession } from '@/providers/mobile-session-provider';
import type { MobileDesktopAccess, MobileInteraction } from '@shared/types/mobile';

import { InteractionCard } from './interaction-card';

/**
 * Desktops that granted this phone access but withheld the `approve` action.
 * Those desktops can never deliver a prompt, so an empty inbox must not claim
 * "nothing to do" while the phone is structurally unable to answer.
 */
function withheldApprovals(desktops: readonly MobileDesktopAccess[]): MobileDesktopAccess[] {
  return desktops.filter(
    (desktop) => desktop.grant?.status === 'active' && !desktop.grant.scopes.includes('approve'),
  );
}

/** The phone's TODO inbox for approvals and questions raised by the desktop. */
export function InteractionsScreen({ embedded = false }: { embedded?: boolean }) {
  const theme = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { interactions, busyId, refresh, decide } = useInteractions();
  const { authorized, status } = useMobileSession();
  const [refreshing, setRefreshing] = useState(false);
  const [withoutApproval, setWithoutApproval] = useState<MobileDesktopAccess[]>([]);

  const loadApprovalGap = useCallback(async (): Promise<void> => {
    if (status !== 'paired') {
      setWithoutApproval([]);
      return;
    }
    try {
      const overview = await authorized((serverUrl, token) => getMobileAccessOverview(serverUrl, token));
      setWithoutApproval(withheldApprovals(overview.desktops));
    } catch {
      // A transient failure must not invent a permission warning.
      setWithoutApproval([]);
    }
  }, [authorized, status]);

  useFocusEffect(
    useCallback(() => {
      void loadApprovalGap();
    }, [loadApprovalGap]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Promise.all([refresh(), loadApprovalGap()]).finally(() => setRefreshing(false));
  }, [loadApprovalGap, refresh]);

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
        {withoutApproval.length > 0 ? (
          <ApprovalScopeNotice
            desktops={withoutApproval}
            onOpenAccess={() => router.push('/access')}
          />
        ) : null}

        {interactions.length === 0 ? (
          withoutApproval.length > 0 ? null : (
            <View style={styles.emptyState}>
              <EmptyState
                title="没有待处理事项"
                description="DSH 需要你审批工具调用或回答问题时，会在这里出现；桌面端批准后会自动消失。"
              />
            </View>
          )
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

/**
 * Explains a structurally empty inbox: the desktop granted this phone access
 * but withheld `approve`, so no prompt can ever arrive until the grant is
 * re-requested with that action.
 */
function ApprovalScopeNotice({
  desktops,
  onOpenAccess,
}: {
  desktops: MobileDesktopAccess[];
  onOpenAccess: () => void;
}) {
  const theme = useAppTheme();
  const names = desktops.map((desktop) => desktop.deviceName).filter(Boolean).join('、') || '这台桌面';
  return (
    <View style={[styles.notice, { backgroundColor: theme.warningSoft, borderColor: theme.warning }]}>
      <Text style={[styles.noticeTitle, { color: theme.warning }]}>本机未获远程审批授权</Text>
      <Text style={[styles.noticeBody, { color: theme.textSecondary }]}>
        {names} 只授权了查看等动作，没有勾选「远程审批」。桌面弹出审批时手机不会收到副本：需要先在访问页撤销，再重新申请并勾选「远程审批」，最后由桌面确认。
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onOpenAccess}
        style={({ pressed }) => [styles.noticeAction, { backgroundColor: theme.accent }, pressed && styles.pressed]}
      >
        <Text style={[styles.noticeActionText, { color: theme.onAccent }]}>去开启远程审批</Text>
      </Pressable>
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
    fontSize: Typography.secondary,
    lineHeight: 20,
  },
  body: {
    paddingBottom: 32,
  },
  emptyState: {
    marginHorizontal: 16,
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
    fontSize: Typography.body,
    lineHeight: 20,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
  },
  notice: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  noticeTitle: {
    fontSize: Typography.body,
    lineHeight: 20,
    fontWeight: '700',
  },
  noticeBody: {
    fontSize: Typography.secondary,
    lineHeight: 19,
  },
  noticeAction: {
    alignSelf: 'flex-start',
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  noticeActionText: {
    fontSize: Typography.secondary,
    lineHeight: 18,
    fontWeight: '700',
  },
});
