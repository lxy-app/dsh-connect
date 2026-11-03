import { Image } from 'expo-image';

const CHAT_ICONS = {
  voice: require('../../assets/chat-icons/voice-input.png'),
  keyboard: require('../../assets/chat-icons/keyboard-input.png'),
  read: require('../../assets/chat-icons/read-aloud.png'),
} as const;

export type ChatIconName = keyof typeof CHAT_ICONS;

export function ChatIcon({ name, color, size = 18 }: { name: ChatIconName; color: string; size?: number }) {
  return (
    <Image
      source={CHAT_ICONS[name]}
      tintColor={color}
      contentFit="contain"
      style={{ width: size, height: size }}
    />
  );
}
