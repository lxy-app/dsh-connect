import { Image } from 'expo-image';

// These PNGs used to be 96x96 with 17-27% transparent margins on every side, so
// a `size` of 16 drew a glyph only ~9pt tall. They are now trimmed flush to the
// ink (2px alpha margin, ~93% fill), and each asset's own aspect ratio is the
// glyph's aspect ratio. `size` is the box height the glyph is drawn in and the
// width follows from the aspect; sizing the wide speaker motif in a square box
// used to shrink it to its width and make it read smaller than the portrait ones.
const CHAT_ICONS = {
  voice: { source: require('../../assets/chat-icons/voice-input.png'), aspect: 59 / 66 },
  keyboard: { source: require('../../assets/chat-icons/keyboard-input.png'), aspect: 67 / 56 },
  read: { source: require('../../assets/chat-icons/read-aloud.png'), aspect: 79 / 60 },
} as const;

export type ChatIconName = keyof typeof CHAT_ICONS;

export function ChatIcon({ name, color, size = 18 }: { name: ChatIconName; color: string; size?: number }) {
  const icon = CHAT_ICONS[name];
  return (
    <Image
      source={icon.source}
      tintColor={color}
      contentFit="contain"
      style={{ width: Math.round(size * icon.aspect), height: size }}
    />
  );
}
