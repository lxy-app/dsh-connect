import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/action-button';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MobileApiError, describeMobileApiError } from '@/lib/mobile-api';
import { useMobileSession } from '@/providers/mobile-session-provider';

type SearchParams = { server?: string | string[] };

export function ConnectScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<SearchParams>();
  const { status, session, login } = useMobileSession();
  const serverParam = Array.isArray(params.server) ? params.server[0] : params.server;
  const defaultServerUrl = process.env.EXPO_PUBLIC_DSH_CONNECT_SERVER_URL?.trim() ?? '';

  const [serverUrl, setServerUrl] = useState(() => serverParam?.trim() || defaultServerUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (submitting) return;
    setError(null);
    if (!serverUrl.trim()) {
      setError('请输入 Server 地址。');
      return;
    }
    if (!email.trim()) {
      setError('请输入邮箱。');
      return;
    }
    if (!password) {
      setError('请输入密码。');
      return;
    }
    setSubmitting(true);
    try {
      await login({ serverUrl, email, password });
      setPassword('');
      router.replace('/');
    } catch (loginError) {
      setError(errorMessage(loginError));
    } finally {
      setSubmitting(false);
    }
  };

  const insecure = /^http:\/\//i.test(serverUrl.trim());
  const hasExistingSession = status === 'paired' && session !== null;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => router.replace('/')}
          style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
        >
          <Text style={[styles.cancelText, { color: theme.textSecondary }]}>取消</Text>
        </Pressable>
        <Text style={[styles.topBarTitle, { color: theme.textSecondary }]}>用户登录</Text>
        <View style={styles.topBarSpacer} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.page}>
            <View style={styles.hero}>
              <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
                登录 DSH Connect
              </Text>
              <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                使用管理后台中的用户账号登录。桌面与工作区权限由账号的访问策略统一决定。
              </Text>
            </View>

            {hasExistingSession ? (
              <View style={[styles.noticeCard, { backgroundColor: theme.warningSoft, borderColor: theme.warning }]}>
                <Text style={[styles.noticeTitle, { color: theme.warning }]}>本机已登录</Text>
                <Text style={[styles.noticeText, { color: theme.textSecondary }]}>
                  当前连接到 {session.serverUrl}。登录成功后会替换本机保存的移动凭据。
                </Text>
              </View>
            ) : null}

            <View style={styles.form}>
              <Field label="Server 地址" theme={theme}>
                <TextInput
                  accessibilityLabel="Server 地址"
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect={false}
                  inputMode="url"
                  keyboardType="url"
                  maxLength={512}
                  onChangeText={(value) => { setServerUrl(value); setError(null); }}
                  placeholder="https://dsh.example.com"
                  placeholderTextColor={theme.textSecondary}
                  selectionColor={theme.accent}
                  style={inputStyle(theme)}
                  value={serverUrl}
                />
              </Field>

              <Field label="邮箱" theme={theme}>
                <TextInput
                  accessibilityLabel="邮箱"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  inputMode="email"
                  keyboardType="email-address"
                  maxLength={254}
                  onChangeText={(value) => { setEmail(value); setError(null); }}
                  placeholder="name@example.com"
                  placeholderTextColor={theme.textSecondary}
                  selectionColor={theme.accent}
                  style={inputStyle(theme)}
                  value={email}
                />
              </Field>

              <Field label="密码" theme={theme}>
                <TextInput
                  accessibilityLabel="密码"
                  autoCapitalize="none"
                  autoComplete="password"
                  autoCorrect={false}
                  maxLength={1024}
                  onChangeText={(value) => { setPassword(value); setError(null); }}
                  onSubmitEditing={() => { void submit(); }}
                  placeholder="输入账号密码"
                  placeholderTextColor={theme.textSecondary}
                  returnKeyType="go"
                  secureTextEntry
                  selectionColor={theme.accent}
                  spellCheck={false}
                  style={inputStyle(theme)}
                  value={password}
                />
              </Field>
            </View>

            {insecure ? (
              <View style={[styles.noticeCard, { backgroundColor: theme.warningSoft, borderColor: theme.warning }]}>
                <Text style={[styles.noticeTitle, { color: theme.warning }]}>明文连接</Text>
                <Text style={[styles.noticeText, { color: theme.textSecondary }]}>
                  当前使用 HTTP，仅适合本地或可信局域网开发。生产环境必须使用 HTTPS，避免账号密码和令牌被窃听。
                </Text>
              </View>
            ) : null}

            {error ? (
              <View style={[styles.errorCard, { backgroundColor: theme.dangerSoft, borderColor: theme.danger }]}>
                <Text accessibilityLiveRegion="polite" style={[styles.errorText, { color: theme.danger }]}>
                  {error}
                </Text>
              </View>
            ) : null}

            <ActionButton
              accessibilityHint="使用用户账号向 Server 登录"
              label={submitting ? '正在登录…' : '登录'}
              loading={submitting}
              onPress={() => { void submit(); }}
            />

            <Text style={[styles.footer, { color: theme.textSecondary }]}>
              密码仅用于本次登录，不会保存。登录成功后，App 只在系统 Keychain / Keystore 中保存移动访问凭据。
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, theme, children }: {
  label: string;
  theme: ReturnType<typeof useAppTheme>;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      {children}
    </View>
  );
}

function inputStyle(theme: ReturnType<typeof useAppTheme>) {
  return [
    styles.input,
    { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text },
  ];
}

function errorMessage(error: unknown): string {
  if (error instanceof MobileApiError) {
    if (error.code === 'unauthorized') return '邮箱或密码错误。';
    if (error.code === 'forbidden' && error.message === 'account is disabled') return '账号已禁用，请联系管理员。';
    return describeMobileApiError(error);
  }
  return error instanceof Error ? error.message : '操作失败，请稍后重试。';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    minHeight: 52,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cancelButton: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600' },
  topBarTitle: { fontSize: 13, lineHeight: 18, fontWeight: '600', letterSpacing: 0.3 },
  topBarSpacer: { width: 44 },
  pressed: { opacity: 0.6 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 14, paddingBottom: 36 },
  page: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: 22 },
  hero: { gap: 12, paddingBottom: 6 },
  title: { fontSize: 34, lineHeight: 42, fontWeight: '700', letterSpacing: -0.8 },
  subtitle: { fontSize: 15, lineHeight: 23, maxWidth: 480 },
  noticeCard: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 6 },
  noticeTitle: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  noticeText: { fontSize: 13, lineHeight: 20 },
  errorCard: { borderWidth: 1, borderRadius: 14, padding: 14 },
  errorText: { fontSize: 14, lineHeight: 21 },
  form: { gap: 18 },
  field: { gap: 8 },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  footer: { fontSize: 12, lineHeight: 19, textAlign: 'center', paddingHorizontal: 8 },
});
