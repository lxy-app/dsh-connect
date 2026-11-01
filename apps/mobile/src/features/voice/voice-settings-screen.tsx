import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton } from '@/components/action-button';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useVoice, type CloudTtsProvider, type VoiceSettings } from '@/providers/voice-provider';

const PROVIDERS: { id: CloudTtsProvider; name: string; endpoint: string; model: string }[] = [
  { id: 'system', name: '系统语音', endpoint: '', model: '' },
  { id: 'volcengine', name: '火山引擎', endpoint: 'https://openspeech.bytedance.com', model: 'doubao-tts' },
  { id: 'aliyun', name: '阿里云', endpoint: 'https://dashscope.aliyuncs.com', model: 'cosyvoice-v2' },
  { id: 'tencent', name: '腾讯云', endpoint: 'https://tts.tencentcloudapi.com', model: 'tts-basic' },
];

export function VoiceSettingsScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings, speak } = useVoice();
  const [form, setForm] = useState<VoiceSettings>(settings);
  const [saving, setSaving] = useState(false);

  const patch = (next: Partial<VoiceSettings>) => setForm((current) => ({ ...current, ...next }));
  const validateCloud = () => {
    if (form.provider === 'system') return true;
    if (!form.endpoint.trim() || !form.apiKey.trim() || !form.model.trim()) {
      Alert.alert('配置不完整', '请填写服务地址、API Key 和 TTS 模型或接入点。');
      return false;
    }
    try {
      const url = new URL(form.endpoint);
      if (url.protocol !== 'https:') throw new Error('https');
    } catch {
      Alert.alert('服务地址无效', '云厂商 TTS 服务地址必须使用有效的 HTTPS URL。');
      return false;
    }
    return true;
  };
  const save = async () => {
    if (!validateCloud()) return;
    setSaving(true);
    try {
      await updateSettings(form);
      Alert.alert('已保存', form.provider === 'system' ? '语音输入与系统播报设置已保存。' : '云厂商配置已加密保存；当前播报仍使用系统语音。');
    } catch {
      Alert.alert('保存失败', '无法写入系统安全存储，请稍后重试。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={[styles.page, { backgroundColor: theme.background }]} contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 28 }]} keyboardShouldPersistTaps="handled">
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回我的" onPress={() => router.back()} style={[styles.back, { backgroundColor: theme.surface, borderColor: theme.border }]}><Text style={[styles.backText, { color: theme.text }]}>‹</Text></Pressable>
        <View><Text style={[styles.title, { color: theme.text }]}>语音与模型服务</Text><Text style={[styles.subtitle, { color: theme.textSecondary }]}>系统 ASR 与 TTS · 云厂商配置加密保存</Text></View>
      </View>

      <View style={[styles.hero, { backgroundColor: theme.accentSoft, borderColor: theme.border }]}>
        <Text style={[styles.heroTitle, { color: theme.text }]}>自然地说，顺畅地听</Text>
        <Text style={[styles.heroCopy, { color: theme.textSecondary }]}>按住说话通过系统 ASR 转写指令；回复播报使用系统 TTS。ASR 与 TTS 是独立能力。</Text>
      </View>

      <Section title="语音输入 · ASR" theme={theme}>
        <View style={styles.row}><View style={styles.rowText}><Text style={[styles.rowLabel, { color: theme.text }]}>按住说话</Text><Text style={[styles.rowSub, { color: theme.textSecondary }]}>首次使用时请求麦克风与语音识别权限</Text></View><Switch value={form.enabled} onValueChange={(enabled) => { patch({ enabled }); void updateSettings({ enabled }); }} trackColor={{ true: theme.accent, false: theme.border }} /></View>
        <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>识别语言</Text>
        <View style={styles.choices}>{([['zh-CN', '中文（普通话）'], ['en-US', 'English']] as const).map(([id, label]) => <Choice key={id} label={label} selected={form.language === id} onPress={() => patch({ language: id })} theme={theme} />)}</View>
      </Section>

      <Section title="云厂商 TTS 配置" theme={theme}>
        <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>服务提供方</Text>
        <View style={styles.choices}>{PROVIDERS.map((item) => <Choice key={item.id} label={item.name} selected={form.provider === item.id} onPress={() => patch({ provider: item.id, endpoint: item.endpoint, model: item.model, apiKey: item.id === form.provider ? form.apiKey : '' })} theme={theme} />)}</View>
        {form.provider !== 'system' ? <>
          <Field label="服务地址" value={form.endpoint} onChange={(endpoint) => patch({ endpoint })} placeholder="https://…" theme={theme} autoCapitalize="none" />
          <Field label="API Key / Access Token" value={form.apiKey} onChange={(apiKey) => patch({ apiKey })} placeholder="输入云厂商凭据" theme={theme} secure />
          <Field label="TTS 模型 / 接入点" value={form.model} onChange={(model) => patch({ model })} placeholder="输入模型或接入点 ID" theme={theme} autoCapitalize="none" />
          <Field label="默认音色" value={form.voice === 'system' ? '' : form.voice} onChange={(voice) => patch({ voice })} placeholder="输入云厂商音色 ID" theme={theme} autoCapitalize="none" />
          <Pressable accessibilityRole="button" onPress={() => { if (validateCloud()) Alert.alert('配置格式完整', '未发起云端请求。实际连通性需要对应 TTS 服务适配器验证，不能以此代替连接测试。'); }} style={[styles.checkButton, { borderColor: theme.border }]}><Text style={[styles.checkText, { color: theme.accent }]}>检查配置格式</Text></Pressable>
          <Text style={[styles.note, { color: theme.textSecondary }]}>云厂商配置只保存到系统安全存储。当前版本未接入云端合成适配器，不会显示模拟连接成功，播报仍使用系统语音。</Text>
        </> : <Text style={[styles.note, { color: theme.textSecondary }]}>系统 TTS 无需 API Key，可直接朗读回复。云厂商选项用于安全保存后续接入所需配置。</Text>}
      </Section>

      <Section title="播报偏好" theme={theme}>
        <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>语速</Text>
        <View style={styles.choices}>{[0.75, 1, 1.25, 1.5].map((rate) => <Choice key={rate} label={`${rate}×`} selected={form.rate === rate} onPress={() => patch({ rate })} theme={theme} />)}</View>
        <View style={styles.row}><View style={styles.rowText}><Text style={[styles.rowLabel, { color: theme.text }]}>自动播报回复</Text><Text style={[styles.rowSub, { color: theme.textSecondary }]}>Agent 回复完成后使用系统 TTS 朗读</Text></View><Switch value={form.autoPlay} onValueChange={(autoPlay) => { patch({ autoPlay }); void updateSettings({ autoPlay }); }} trackColor={{ true: theme.accent, false: theme.border }} /></View>
        <ActionButton label="试听系统语音" onPress={() => speak('你好，这是 DSH Connect 的语音播报预览。')} variant="secondary" />
        <ActionButton label={saving ? '正在保存…' : '保存配置'} loading={saving} onPress={() => void save()} variant="primary" />
      </Section>
    </ScrollView>
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
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 }, back: { width: 36, height: 36, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, backText: { fontSize: 26, lineHeight: 28, marginTop: -2 }, title: { fontSize: 20, fontWeight: '700' }, subtitle: { fontSize: 10, marginTop: 3 },
  hero: { borderWidth: 1, borderRadius: 16, padding: 15, gap: 6 }, heroTitle: { fontSize: 15, fontWeight: '700' }, heroCopy: { fontSize: 11, lineHeight: 17 },
  section: { gap: 7 }, sectionTitle: { fontSize: 11, fontWeight: '700', paddingHorizontal: 4 }, group: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, rowText: { flex: 1 }, rowLabel: { fontSize: 13, fontWeight: '600' }, rowSub: { fontSize: 10, lineHeight: 15, marginTop: 3 },
  field: { gap: 6 }, fieldLabel: { fontSize: 11, fontWeight: '600' }, input: { borderWidth: 1, borderRadius: 11, paddingHorizontal: 11, paddingVertical: 10, fontSize: 12 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, choice: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 }, choiceText: { fontSize: 11, fontWeight: '600' },
  checkButton: { borderWidth: 1, borderRadius: 10, paddingVertical: 9, alignItems: 'center' }, checkText: { fontSize: 12, fontWeight: '700' }, note: { fontSize: 10, lineHeight: 16 },
});
