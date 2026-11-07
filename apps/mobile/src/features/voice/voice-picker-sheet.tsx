import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Typography } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { VOLC_TTS_VOICES, type VolcTtsVoiceId } from '@/lib/volc-tts-voices';

export function VoicePickerSheet({
  visible,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: VolcTtsVoiceId;
  onSelect: (voice: VolcTtsVoiceId) => void;
  onClose: () => void;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel="关闭音色选择" style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: theme.surface, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          <Text style={[styles.title, { color: theme.text }]}>选择播报音色</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>试听与自动播报共用所选音色</Text>
          <View style={styles.options}>
            {VOLC_TTS_VOICES.map((voice) => {
              const selected = voice.id === value;
              return (
                <Pressable
                  key={voice.id}
                  accessibilityRole="button"
                  accessibilityLabel={`选择音色 ${voice.name}`}
                  accessibilityState={{ selected }}
                  onPress={() => onSelect(voice.id)}
                  style={({ pressed }) => [
                    styles.option,
                    { backgroundColor: selected ? theme.accentSoft : pressed ? theme.surfaceMuted : 'transparent' },
                  ]}
                >
                  <View style={styles.optionCopy}>
                    <Text style={[styles.optionName, { color: selected ? theme.accent : theme.text }]}>{voice.name}</Text>
                    <Text style={[styles.optionDescription, { color: theme.textSecondary }]}>{voice.description}</Text>
                  </View>
                  {selected ? <Text style={[styles.selected, { color: theme.accent }]}>✓</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.42)' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginBottom: 14 },
  title: { fontSize: Typography.title, lineHeight: 24, fontWeight: '700' },
  subtitle: { fontSize: Typography.caption, lineHeight: 18, marginTop: 3, marginBottom: 12 },
  options: { gap: 3 },
  option: { minHeight: 58, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 12 },
  optionCopy: { flex: 1, gap: 2 },
  optionName: { fontSize: Typography.control, lineHeight: 21, fontWeight: '600' },
  optionDescription: { fontSize: Typography.caption, lineHeight: 17 },
  selected: { fontSize: 20, lineHeight: 24, fontWeight: '700' },
});
