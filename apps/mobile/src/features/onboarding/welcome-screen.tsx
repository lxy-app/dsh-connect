import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/action-button';
import { AppMark } from '@/components/app-mark';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useMobileSession } from '@/providers/mobile-session-provider';

const CAPABILITIES = ['扫码配对', 'Keychain / Keystore', 'Token 轮换', '桌面授权'];

export function WelcomeScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const { status, notice, dismissNotice } = useMobileSession();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.page}>
          <View style={styles.brandRow}>
            <AppMark />
            <View style={styles.brandText}>
              <Text style={[styles.brandName, { color: theme.text }]}>DSH Connect</Text>
              <Text style={[styles.brandCaption, { color: theme.textSecondary }]}>移动端</Text>
            </View>
          </View>

          <View style={styles.hero}>
            <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
              离开电脑，{'\n'}继续推进会话。
            </Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              安全查看桌面 DeepSeek Harness 的工作区与会话，为 iOS 与 Android 打造。
            </Text>
          </View>

          <View style={[styles.statusCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.statusHeadingRow}>
              <View style={[styles.statusDot, { backgroundColor: theme.statusNeutral }]} />
              <Text style={[styles.statusTitle, { color: theme.text }]}>
                {status === 'loading' ? '正在恢复配对' : '尚未连接 Server'}
              </Text>
            </View>
            <Text style={[styles.statusDescription, { color: theme.textSecondary }]}>
              扫码或输入管理后台生成的一次性配对码，把本机连接到你的 DSH Server。配对后还需要由桌面 Connector 批准工作区访问。
            </Text>

            {notice ? (
              <View style={[styles.noticeCard, { backgroundColor: theme.warningSoft, borderColor: theme.warning }]}>
                <Text style={[styles.noticeText, { color: theme.warning }]}>{notice}</Text>
                <Pressable accessibilityRole="button" hitSlop={8} onPress={dismissNotice}>
                  <Text style={[styles.noticeDismiss, { color: theme.warning }]}>关闭</Text>
                </Pressable>
              </View>
            ) : null}

            <ActionButton
              accessibilityHint="扫描或输入手机配对码"
              label={status === 'loading' ? '正在准备…' : '连接 Server'}
              loading={status === 'loading'}
              onPress={() => router.navigate('/connect')}
            />
          </View>

          <View style={styles.section}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text }]}>
              连接能力
            </Text>
            <View style={styles.badgeRow}>
              {CAPABILITIES.map((item) => (
                <View key={item} style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
                  <Text style={[styles.badgeText, { color: theme.accent }]}>{item}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={[styles.nextStepCard, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
            <Text style={[styles.nextStepLabel, { color: theme.textSecondary }]}>下一步</Text>
            <Text style={[styles.nextStepTitle, { color: theme.text }]}>生成手机配对码</Text>
            <Text style={[styles.nextStepDescription, { color: theme.textSecondary }]}>
              在 Web 管理后台为当前用户生成手机配对二维码，再回到 App 扫描。配对码短期有效且只能使用一次。
            </Text>
          </View>

          <Text style={[styles.footnote, { color: theme.textSecondary }]}>
            手机配对只证明设备身份；没有桌面授权时，App 不会显示任何工作区或会话。
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  page: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    flex: 1,
    gap: 32,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  brandText: {
    gap: 2,
  },
  brandName: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  brandCaption: {
    fontSize: 13,
    lineHeight: 18,
  },
  hero: {
    gap: 18,
    paddingTop: 20,
  },
  title: {
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '700',
    letterSpacing: -1.2,
  },
  subtitle: {
    fontSize: 17,
    lineHeight: 27,
    maxWidth: 440,
  },
  statusCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 22,
    gap: 14,
  },
  statusHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  statusTitle: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
  },
  statusDescription: {
    fontSize: 14,
    lineHeight: 22,
  },
  noticeCard: {
    borderWidth: 1,
    borderRadius: 13,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  noticeDismiss: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  section: {
    gap: 14,
  },
  sectionTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  badge: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  nextStepCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
    gap: 6,
  },
  nextStepLabel: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  nextStepTitle: {
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  nextStepDescription: {
    fontSize: 13,
    lineHeight: 20,
  },
  footnote: {
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
  },
});
