import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/action-button';
import { PairingScanner } from '@/features/pairing/pairing-scanner';
import { PairingLinkError, pairingFromParts, parsePairingLink } from '@/features/pairing/pairing-link';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MobileApiError, describeMobileApiError } from '@/lib/mobile-api';
import { useMobileSession } from '@/providers/mobile-session-provider';

type SearchParams = {
  server?: string | string[];
  code?: string | string[];
  v?: string | string[];
};

export function ConnectScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<SearchParams>();
  const { status, session, pair } = useMobileSession();

  const serverParam = firstParam(params.server);
  const codeParam = firstParam(params.code);
  const versionParam = firstParam(params.v);
  const defaultServerUrl = process.env.EXPO_PUBLIC_DSH_CONNECT_SERVER_URL?.trim() ?? '';
  const initial = useState(() =>
    initialForm(serverParam, codeParam, versionParam, defaultServerUrl),
  )[0];

  const [serverUrl, setServerUrl] = useState(initial.serverUrl);
  const [code, setCode] = useState(initial.code);
  const [fromLink, setFromLink] = useState(initial.fromLink);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initial.error);

  const handleScan = (data: string): string | null => {
    try {
      const link = parsePairingLink(data);
      setServerUrl(link.serverUrl);
      setCode(link.code);
      setFromLink(true);
      setError(null);
      setScannerVisible(false);
      return null;
    } catch (scanError) {
      return errorMessage(scanError);
    }
  };

  const submit = async () => {
    setError(null);
    if (!serverUrl.trim()) {
      setError('请输入 Server 地址。');
      return;
    }
    if (!code.trim()) {
      setError('请输入配对码，或扫描管理后台生成的二维码。');
      return;
    }

    setSubmitting(true);
    try {
      await pair({ serverUrl, code });
      router.replace('/');
    } catch (pairError) {
      setError(errorMessage(pairError));
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
        <Text style={[styles.topBarTitle, { color: theme.textSecondary }]}>手机配对</Text>
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
              连接 DSH Server
            </Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              扫描管理员生成的手机配对二维码，或手动填写 Server 地址和一次性配对码。
            </Text>
          </View>

          {hasExistingSession ? (
            <View
              style={[
                styles.noticeCard,
                { backgroundColor: theme.warningSoft, borderColor: theme.warning },
              ]}
            >
              <Text style={[styles.noticeTitle, { color: theme.warning }]}>本机已配对</Text>
              <Text style={[styles.noticeText, { color: theme.textSecondary }]}>
                当前连接到 {session.serverUrl}。重新配对成功后，会替换本机保存的凭据。
              </Text>
            </View>
          ) : null}

          <ActionButton
            accessibilityHint="打开相机读取管理后台生成的配对二维码"
            label="扫描配对二维码"
            onPress={() => {
              setError(null);
              setScannerVisible(true);
            }}
            variant="secondary"
          />

          {fromLink ? (
            <View style={[styles.linkBadge, { backgroundColor: theme.accentSoft }]}>
              <Text style={[styles.linkBadgeText, { color: theme.accent }]}>
                已从配对链接读取 Server 和配对码
              </Text>
            </View>
          ) : null}

          <View style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
            <Text style={[styles.dividerText, { color: theme.textSecondary }]}>或手动输入</Text>
            <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.text }]}>Server 地址</Text>
              <TextInput
                accessibilityLabel="Server 地址"
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                inputMode="url"
                keyboardType="url"
                maxLength={512}
                onChangeText={(value) => {
                  setServerUrl(value);
                  setError(null);
                }}
                placeholder="https://dsh.example.com"
                placeholderTextColor={theme.textSecondary}
                selectionColor={theme.accent}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                value={serverUrl}
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.text }]}>一次性配对码</Text>
              <TextInput
                accessibilityLabel="一次性配对码"
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect={false}
                maxLength={128}
                onChangeText={(value) => {
                  setCode(value.toUpperCase());
                  setError(null);
                }}
                placeholder="ABCD-EFGH-IJKL"
                placeholderTextColor={theme.textSecondary}
                returnKeyType="go"
                selectionColor={theme.accent}
                spellCheck={false}
                style={[
                  styles.input,
                  styles.codeInput,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                value={code}
              />
            </View>
          </View>

          {insecure ? (
            <View
              style={[
                styles.noticeCard,
                { backgroundColor: theme.warningSoft, borderColor: theme.warning },
              ]}
            >
              <Text style={[styles.noticeTitle, { color: theme.warning }]}>明文连接</Text>
              <Text style={[styles.noticeText, { color: theme.textSecondary }]}>
                当前使用 HTTP，仅适合本地或可信局域网开发。生产环境必须使用 HTTPS。
              </Text>
            </View>
          ) : null}

          {error ? (
            <View
              style={[
                styles.errorCard,
                { backgroundColor: theme.dangerSoft, borderColor: theme.danger },
              ]}
            >
              <Text accessibilityLiveRegion="polite" style={[styles.errorText, { color: theme.danger }]}>
                {error}
              </Text>
            </View>
          ) : null}

          <ActionButton
            accessibilityHint="使用输入的信息向 Server 兑换手机凭据"
            label={submitting ? '正在配对…' : '开始配对'}
            loading={submitting}
            onPress={() => {
              void submit();
            }}
          />

          <Text style={[styles.footer, { color: theme.textSecondary }]}>
            配对码只能使用一次。配对成功后，设备凭据保存在系统 Keychain / Keystore 中，不会写入普通存储。
          </Text>
        </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {scannerVisible ? (
        <PairingScanner
          onClose={() => setScannerVisible(false)}
          onScan={handleScan}
        />
      ) : null}
    </SafeAreaView>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function initialForm(
  serverParam: string | undefined,
  codeParam: string | undefined,
  versionParam: string | undefined,
  defaultServerUrl: string,
): { serverUrl: string; code: string; fromLink: boolean; error: string | null } {
  const serverUrl = serverParam?.trim() ?? '';
  const code = codeParam?.trim().toUpperCase() ?? '';
  if (!serverParam && !codeParam) {
    return { serverUrl: defaultServerUrl, code, fromLink: false, error: null };
  }
  if (serverParam && !codeParam) {
    // The Home screen pre-fills the current Server without supplying a code.
    return { serverUrl, code, fromLink: false, error: null };
  }
  if (!serverParam) {
    return {
      serverUrl,
      code,
      fromLink: false,
      error: '配对链接缺少 Server 地址，请重新扫描二维码。',
    };
  }
  try {
    const link = pairingFromParts(serverParam, codeParam, versionParam);
    return { serverUrl: link.serverUrl, code: link.code, fromLink: true, error: null };
  } catch (error) {
    return { serverUrl, code, fromLink: false, error: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof MobileApiError) {
    return describeMobileApiError(error);
  }
  if (error instanceof PairingLinkError) {
    return error.message;
  }
  return error instanceof Error ? error.message : '操作失败，请稍后重试。';
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  topBar: {
    minHeight: 52,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cancelButton: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
  topBarTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  topBarSpacer: {
    width: 44,
  },
  pressed: {
    opacity: 0.6,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 36,
  },
  page: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    gap: 22,
  },
  hero: {
    gap: 12,
    paddingBottom: 6,
  },
  title: {
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 23,
    maxWidth: 480,
  },
  noticeCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  noticeTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  noticeText: {
    fontSize: 13,
    lineHeight: 20,
  },
  errorCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 21,
  },
  linkBadge: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  linkBadgeText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    fontSize: 12,
    lineHeight: 18,
  },
  form: {
    gap: 18,
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  codeInput: {
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.8,
  },
  footer: {
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
});
