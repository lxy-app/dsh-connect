import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/action-button';
import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { VOLC_ASR_RESOURCE_ID } from '@/lib/volc-asr';
import { VOLC_TTS_RESOURCE_ID } from '@/lib/volc-tts';
import { getVolcTtsVoice } from '@/lib/volc-tts-voices';
import { useVoice, type VoiceServiceProvider, type VoiceSettings } from '@/providers/voice-provider';
import { VoicePickerSheet } from './voice-picker-sheet';

const PROVIDERS: { id: VoiceServiceProvider; name: string }[] = [
  { id: 'volcengine', name: '火山 Agent Plan' },
  { id: 'system', name: '系统语音' },
];

export function VoiceSettingsScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { hydrated } = useVoice();
  if (hydrated) return <VoiceSettingsContent />;
  return (
    <View style={[styles.page, styles.loading, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      <ActivityIndicator color={theme.accent} />
      <Text style={[styles.note, { color: theme.textSecondary }]}>正在读取安全语音配置…</Text>
    </View>
  );
}

function VoiceSettingsContent() {
  const theme = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings, speak } = useVoice();
  const [form, setForm] = useState<VoiceSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [voicePickerVisible, setVoicePickerVisible] = useState(false);
  const selectedVoice = getVolcTtsVoice(form.voice);

  const patch = (next: Partial<VoiceSettings>) => setForm((current) => ({ ...current, ...next }));
  const usesCloud = form.asrProvider === 'volcengine' || form.ttsProvider === 'volcengine';
  const validateCloud = () => {
    if (!usesCloud) return true;
    if (!form.endpoint.trim() || !form.apiKey.trim()) {
      Alert.alert('配置不完整', '请填写 Agent Plan 服务地址和专属 API Key 或企业席位 Key。');
      return false;
    }
    try {
      const url = new URL(form.endpoint);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        throw new Error('https');
      }
    } catch {
      Alert.alert('服务地址无效', 'Agent Plan 服务地址必须使用 HTTPS，且不能包含账号、密码、查询参数或片段。');
      return false;
    }
    return true;
  };
  const save = async () => {
    if (!validateCloud()) return;
    setSaving(true);
    try {
      await updateSettings(form);
      Alert.alert('已保存', '语音配置已加密保存，将在下次识别或播报时使用。');
    } catch {
      Alert.alert('保存失败', '无法写入系统安全存储，请稍后重试。');
    } finally {
      setSaving(false);
    }
  };
  const preview = async () => {
    if (!validateCloud()) return;
    setPreviewing(true);
    try {
      await speak('你好，这是 DSH Connect 的火山语音播报预览。', { overrides: form });
    } catch (cause) {
      Alert.alert('试听失败', cause instanceof Error ? cause.message : '请稍后重试。');
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <ScrollView
      style={[styles.page, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 28 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回我的" onPress={() => router.back()} style={[styles.back, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.backText, { color: theme.text }]}>‹</Text>
        </Pressable>
        <View>
          <Text style={[styles.title, { color: theme.text }]}>语音与模型服务</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Agent Plan ASR / TTS · 密钥加密保存</Text>
        </View>
      </View>

      <View style={[styles.hero, { backgroundColor: theme.accentSoft, borderColor: theme.border }]}>
        <Text style={[styles.heroTitle, { color: theme.text }]}>自然地说，顺畅地听</Text>
        <Text style={[styles.heroCopy, { color: theme.textSecondary }]}>按住说话使用 ASR 转写指令，回复播报使用独立的 TTS 合成。两者均可选择火山 Agent Plan 或系统语音。</Text>
      </View>

      <Section title="语音输入 · ASR" theme={theme}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={[styles.rowLabel, { color: theme.text }]}>按住说话</Text>
            <Text style={[styles.rowSub, { color: theme.textSecondary }]}>云端识别只申请麦克风权限；系统 ASR 还会申请语音识别权限</Text>
          </View>
          <Switch value={form.enabled} onValueChange={(enabled) => { patch({ enabled }); void updateSettings({ enabled }); }} trackColor={{ true: theme.accent, false: theme.border }} />
        </View>
        <ProviderChoices value={form.asrProvider} onChange={(asrProvider) => patch({ asrProvider })} theme={theme} />
        {form.asrProvider === 'volcengine' ? (
          <>
            <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>识别协议</Text>
            <View style={styles.choices}>
              <Choice label="双向流式" selected={form.asrProtocol === 'ws-bidirectional'} onPress={() => patch({ asrProtocol: 'ws-bidirectional' })} theme={theme} />
              <Choice label="完成后返回" selected={form.asrProtocol === 'ws-unidirectional'} onPress={() => patch({ asrProtocol: 'ws-unidirectional' })} theme={theme} />
            </View>
            <Text style={[styles.note, { color: theme.textSecondary }]}>Resource-Id：{VOLC_ASR_RESOURCE_ID}{'\n'}16 kHz · 单声道 · Int16 PCM · {form.asrProtocol === 'ws-bidirectional' ? 'bigmodel_async' : 'bigmodel_nostream'}</Text>
          </>
        ) : (
          <>
            <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>系统识别语言</Text>
            <View style={styles.choices}>
              {([['zh-CN', '中文（普通话）'], ['en-US', 'English']] as const).map(([id, label]) => (
                <Choice key={id} label={label} selected={form.language === id} onPress={() => patch({ language: id })} theme={theme} />
              ))}
            </View>
          </>
        )}
      </Section>

      <Section title="语音播报 · TTS" theme={theme}>
        <ProviderChoices value={form.ttsProvider} onChange={(ttsProvider) => patch({ ttsProvider })} theme={theme} />
        {form.ttsProvider === 'volcengine' ? (
          <>
            <Text style={[styles.note, { color: theme.textSecondary }]}>Resource-Id：{VOLC_TTS_RESOURCE_ID}{'\n'}MP3 · 24000 Hz · Agent Plan HTTP 合成</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`选择 TTS 音色，当前为 ${selectedVoice.name}`}
              onPress={() => setVoicePickerVisible(true)}
              style={({ pressed }) => [styles.voiceSelector, { borderColor: theme.border, backgroundColor: pressed ? theme.surfaceMuted : theme.background }]}
            >
              <View style={styles.rowText}>
                <Text style={[styles.rowLabel, { color: theme.text }]}>音色</Text>
                <Text style={[styles.rowSub, { color: theme.textSecondary }]}>{selectedVoice.description}</Text>
              </View>
              <Text style={[styles.voiceName, { color: theme.accent }]}>{selectedVoice.name}</Text>
              <Text style={[styles.chevron, { color: theme.textSecondary }]}>›</Text>
            </Pressable>
          </>
        ) : (
          <Text style={[styles.note, { color: theme.textSecondary }]}>系统 TTS 无需 API Key，可直接朗读回复。</Text>
        )}
      </Section>

      {usesCloud ? (
        <Section title="火山 Agent Plan 配置" theme={theme}>
          <Field label="服务地址" value={form.endpoint} onChange={(endpoint) => patch({ endpoint })} placeholder="https://openspeech.bytedance.com" theme={theme} autoCapitalize="none" />
          <Field label="Agent Plan API Key / 企业席位 Key" value={form.apiKey} onChange={(apiKey) => patch({ apiKey })} placeholder="输入套餐专用凭据" theme={theme} secure />
          <Text style={[styles.note, { color: theme.textSecondary }]}>请使用 Agent Plan 个人版专属 Key 或企业版席位 Key，不是按量平台的普通 API Key。密钥只保存到 Keychain / Keystore。是否开启超额后付费由你的套餐配置决定。</Text>
        </Section>
      ) : null}

      <Section title="播报偏好" theme={theme}>
        <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>播放语速</Text>
        <View style={styles.choices}>
          {[0.75, 1, 1.25, 1.5].map((rate) => <Choice key={rate} label={`${rate}×`} selected={form.rate === rate} onPress={() => patch({ rate })} theme={theme} />)}
        </View>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={[styles.rowLabel, { color: theme.text }]}>自动播报回复</Text>
            <Text style={[styles.rowSub, { color: theme.textSecondary }]}>Agent 回复完成后使用所选 TTS 服务朗读</Text>
          </View>
          <Switch value={form.autoPlay} onValueChange={(autoPlay) => { patch({ autoPlay }); void updateSettings({ autoPlay }); }} trackColor={{ true: theme.accent, false: theme.border }} />
        </View>
        <ActionButton label={previewing ? '正在请求语音…' : '试听当前配置'} loading={previewing} onPress={() => void preview()} variant="secondary" />
        <ActionButton label={saving ? '正在保存…' : '保存配置'} loading={saving} onPress={() => void save()} variant="primary" />
      </Section>
      <VoicePickerSheet
        visible={voicePickerVisible}
        value={form.voice}
        onClose={() => setVoicePickerVisible(false)}
        onSelect={(voice) => {
          patch({ voice });
          setVoicePickerVisible(false);
        }}
      />
    </ScrollView>
  );
}

function ProviderChoices({ value, onChange, theme }: { value: VoiceServiceProvider; onChange: (value: VoiceServiceProvider) => void; theme: ReturnType<typeof useAppTheme> }) {
  return (
    <View style={styles.choices}>
      {PROVIDERS.map((item) => <Choice key={item.id} label={item.name} selected={value === item.id} onPress={() => onChange(item.id)} theme={theme} />)}
    </View>
  );
}

function Section({ title, children, theme }: { title: string; children: ReactNode; theme: ReturnType<typeof useAppTheme> }) {
  return <View style={styles.section}><Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>{title}</Text><View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}>{children}</View></View>;
}
function Choice({ label, selected, onPress, theme }: { label: string; selected: boolean; onPress: () => void; theme: ReturnType<typeof useAppTheme> }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.choice, { backgroundColor: selected ? theme.accentSoft : theme.surfaceMuted, borderColor: selected ? theme.accent : 'transparent' }]}><Text style={[styles.choiceText, { color: selected ? theme.accent : theme.textSecondary }]}>{label}</Text></Pressable>;
}
function Field({ label, value, onChange, placeholder, theme, secure = false, autoCapitalize = 'sentences' }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; theme: ReturnType<typeof useAppTheme>; secure?: boolean; autoCapitalize?: 'none' | 'sentences' }) {
  return <View style={styles.field}><Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{label}</Text><TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={theme.textSecondary} secureTextEntry={secure} autoCapitalize={autoCapitalize} autoCorrect={false} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }]} /></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1 }, content: { paddingHorizontal: 20, gap: 16 },
  loading: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 }, back: { width: 36, height: 36, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, backText: { fontSize: 26, lineHeight: 28, marginTop: -2 }, title: { fontSize: 20, lineHeight: 26, fontWeight: '700' }, subtitle: { fontSize: Typography.caption, lineHeight: 18, marginTop: 3 },
  hero: { borderWidth: 1, borderRadius: 16, padding: 15, gap: 6 }, heroTitle: { fontSize: Typography.reading, lineHeight: 22, fontWeight: '700' }, heroCopy: { fontSize: Typography.body, lineHeight: 21 },
  section: { gap: 7 }, sectionTitle: { fontSize: Typography.secondary, lineHeight: 19, fontWeight: '700', paddingHorizontal: 4 }, group: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, rowText: { flex: 1 }, rowLabel: { fontSize: Typography.control, lineHeight: 21, fontWeight: '600' }, rowSub: { fontSize: Typography.secondary, lineHeight: 20, marginTop: 3 },
  voiceSelector: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10 },
  voiceName: { fontSize: Typography.body, lineHeight: 20, fontWeight: '600' }, chevron: { fontSize: 26, lineHeight: 28 },
  field: { gap: 6 }, fieldLabel: { fontSize: Typography.body, lineHeight: 20, fontWeight: '600' }, input: { borderWidth: 1, borderRadius: 11, paddingHorizontal: 11, paddingVertical: 10, fontSize: Typography.reading, lineHeight: 24 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, choice: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 }, choiceText: { fontSize: Typography.body, lineHeight: 20, fontWeight: '600' },
  note: { fontSize: Typography.secondary, lineHeight: 20 },
});
