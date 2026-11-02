import { View } from 'react-native';

/**
 * Speaker icon, matching the 喇叭 glyph the prototype uses for 朗读.
 *
 * The app ships no icon font and no SVG runtime, so the shape is composed from
 * plain Views: the cone is a border triangle and the two sound waves are rings
 * clipped to a right-hand window.
 */
export function SpeakerIcon({ color, size = 12 }: { color: string; size?: number }) {
  const unit = size / 12;
  const stroke = Math.max(1, unit);
  const centerY = size / 2;
  const cabinetLeft = 1.2 * unit;
  const cabinetWidth = 3 * unit;
  const coneWidth = 4.2 * unit;
  const coneBase = 8 * unit;
  const coneLeft = cabinetLeft + cabinetWidth - 0.6 * unit;
  const waveCenterX = coneLeft + coneWidth + 0.1 * unit;
  const wave = (diameter: number) => {
    const clipHeight = diameter * 0.64;
    return (
      <View
        style={{
          position: 'absolute',
          left: waveCenterX,
          top: centerY - clipHeight / 2,
          width: diameter / 2,
          height: clipHeight,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: -diameter / 2,
            top: (clipHeight - diameter) / 2,
            width: diameter,
            height: diameter,
            borderRadius: diameter / 2,
            borderWidth: stroke,
            borderColor: color,
          }}
        />
      </View>
    );
  };

  return (
    <View style={{ width: waveCenterX + 4.1 * unit, height: size }}>
      <View
        style={{
          position: 'absolute',
          left: cabinetLeft,
          top: centerY - 2.5 * unit,
          width: cabinetWidth,
          height: 5 * unit,
          borderRadius: 0.8 * unit,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: coneLeft,
          top: centerY - coneBase / 2,
          width: 0,
          height: 0,
          borderTopWidth: coneBase / 2,
          borderBottomWidth: coneBase / 2,
          borderRightWidth: coneWidth,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderRightColor: color,
        }}
      />
      {wave(4.8 * unit)}
      {wave(8.2 * unit)}
    </View>
  );
}