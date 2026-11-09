export const VOLC_TTS_VOICES = [
  {
    id: 'zh_female_gaolengyujie_uranus_bigtts',
    name: '高冷御姐',
    description: '默认音色 · 中文女声',
  },
  {
    id: 'zh_female_vv_uranus_bigtts',
    name: 'Vivi 2.0',
    description: '通用场景 · 支持多语种',
  },
  {
    id: 'zh_female_xiaohe_uranus_bigtts',
    name: '小何 2.0',
    description: '通用场景 · 支持多语种',
  },
  {
    id: 'zh_female_tuanzi_uranus_bigtts',
    name: '团子 2.0',
    description: '通用场景 · 中文',
  },
] as const;

export type VolcTtsVoice = (typeof VOLC_TTS_VOICES)[number];
export type VolcTtsVoiceId = VolcTtsVoice['id'];

export const VOLC_TTS_DEFAULT_VOICE: VolcTtsVoiceId = 'zh_female_gaolengyujie_uranus_bigtts';

export function isVolcTtsVoiceId(value: unknown): value is VolcTtsVoiceId {
  return typeof value === 'string' && VOLC_TTS_VOICES.some((voice) => voice.id === value);
}

export function normalizeVolcTtsVoice(value: unknown): VolcTtsVoiceId {
  if (typeof value !== 'string') return VOLC_TTS_DEFAULT_VOICE;
  const normalized = value.trim();
  return isVolcTtsVoiceId(normalized) ? normalized : VOLC_TTS_DEFAULT_VOICE;
}

export function getVolcTtsVoice(value: unknown): VolcTtsVoice {
  const id = normalizeVolcTtsVoice(value);
  return VOLC_TTS_VOICES.find((voice) => voice.id === id) ?? VOLC_TTS_VOICES[0];
}
