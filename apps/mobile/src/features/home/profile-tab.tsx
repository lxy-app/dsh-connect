import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import Constants from 'expo-constants';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { StoredMobileSession } from '@/types/mobile';

export function ProfileTab({
  session,
  workspaceCount,
  desktopCount,
  onDisconnect,
  onRepair,
}: {
  session: StoredMobileSession;
  workspaceCount: number;
  desktopCount: number;
  onDisconnect: () => Promise<void>;
  onRepair: () => void;
}) {
  const theme = useAppTheme();
  const router = useRouter();
  const [disconnecting, setDisconnecting] = useState(false);

  const confirmDisconnect = () => {
    Alert.alert('断开这台手机？', '本机安全存储中的凭据会被删除，桌面授权也会随之撤销。下次使用需要重新配对。', [
      { text: '取消', style: 'cancel' },
      {
        text: '断开',
        style: 'destructive',
        onPress: () => {
          setDisconnecting(true);
          void onDisconnect()
            .catch((error: unknown) => {
              Alert.alert('无法断开', error instanceof Error ? error.message : '请稍后重试。');
            })
            .finally(() => setDisconnecting(false));
        },
      },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>我的</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          DSH Connect for iOS · v{Constants.expoConfig?.version ?? '0.1.0'}
        </Text>
      </View>

      <View style={[styles.identity, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={[styles.avatar, { backgroundColor: theme.accent }]}>
          <Text style={[styles.avatarText, { color: theme.onAccent }]}>
            {initials(session.user.displayName || session.user.email)}
          </Text>
        </View>
        <View style={styles.identityText}>
          <Text style={[styles.name, { color: theme.text }]}>{session.user.displayName}</Text>
          <Text style={[styles.email, { color: theme.textSecondary }]}>{session.user.email}</Text>
        </View>
        <View style={[styles.role, { backgroundColor: theme.accentSoft }]}>
          <Text style={[styles.roleText, { color: theme.accent }]}>{roleLabel(session.user.role)}</Text>
        </View>
      </View>

      <Section title="连接">
        <Row label="Server" value={displayServer(session.serverUrl)} />
        <Row label="本机" value={session.deviceName} />
        <Row label="配对用户" value={session.user.displayName} />
        <Row label="设备 ID" value={session.mobileDeviceId} mono />
      </Section>

      <Section title="已获授权">
        <Row label="桌面" value={`${desktopCount} 台`} />
        <Row label="工作区" value={`${workspaceCount} 个`} />
        <Text style={[styles.help, { color: theme.textSecondary }]}>
          授权由桌面 Connector 决定。桌面撤销访问或吊销本机后，相关工作区与会话会立即不可见。
        </Text>
      </Section>

      <Section title="安全">
        <Row label="凭据存储" value="iOS Keychain / Android Keystore" />
        <Row label="Token 轮换" value="Access Token 短期有效，Refresh Token 自动轮换" />
        <Row label="本地内容" value="不缓存会话正文；每次打开向桌面拉取" />
      </Section>

      <Section title="智能交互">
        <Pressable accessibilityRole="button" onPress={() => router.push('/voice-settings')} style={styles.row}>
          <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>语音与模型服务</Text>
          <Text style={[styles.rowValue, { color: theme.accent }]}>系统 ASR/TTS · 云厂商配置 ›</Text>
        </Pressable>
      </Section>

      <Section title="后续能力">
        <Row label="任务通知" value="待接入 APNs" />
        <Row label="远程审批" value="待接入桌面审批链" />
        <Row label="生物识别" value="待接入 Face ID / 指纹" />
      </Section>

      <View style={styles.actions}>
        <ActionButton label="重新配对" onPress={onRepair} variant="secondary" />
        <ActionButton
          label={disconnecting ? '正在断开…' : '断开连接'}
          loading={disconnecting}
          onPress={confirmDisconnect}
          variant="danger"
        />
      </View>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useAppTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>{title}</Text>
      <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {children}
      </View>
    </View>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const theme = useAppTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text
        numberOfLines={2}
        style={[styles.rowValue, { color: theme.text }, mono && styles.mono]}
      >
        {value}
      </Text>
    </View>
  );
}

function initials(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'DSH';
  return trimmed.slice(0, 2).toUpperCase();
}

function roleLabel(role: string): string {
  return (
    {
      owner: '所有者',
      admin: '管理员',
      member: '成员',
      auditor: '审计员',
    }[role] ?? role
  );
}

function displayServer(serverUrl: string): string {
  try {
    return new URL(serverUrl).host;
  } catch {
    return serverUrl;
  }
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 18,
  },
  header: {
    gap: 4,
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 17,
  },
  identity: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '800',
  },
  identityText: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600',
  },
  email: {
    fontSize: 12,
    lineHeight: 17,
  },
  role: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  roleText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  section: {
    gap: 7,
  },
  sectionTitle: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.4,
    paddingHorizontal: 4,
  },
  group: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 10,
  },
  rowLabel: {
    fontSize: 12,
    lineHeight: 18,
  },
  rowValue: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
    textAlign: 'right',
  },
  mono: {
    fontFamily: 'Menlo',
    fontSize: 10,
  },
  help: {
    fontSize: 11,
    lineHeight: 17,
    paddingBottom: 10,
  },
  actions: {
    gap: 10,
  },
});
