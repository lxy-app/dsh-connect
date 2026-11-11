import assert from 'node:assert/strict';
import test from 'node:test';

import { Colors } from '../constants/theme';

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g)?.map((value) => parseInt(value, 16) / 255);
  assert.equal(channels?.length, 3);
  const [red, green, blue] = channels.map((value) => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test('silver-white brand palette uses the confirmed charcoal light accents', () => {
  assert.equal(Colors.light.accent, '#232529');
  assert.equal(Colors.light.textSecondary, '#232529');
  assert.equal(Colors.light.accentSoft, '#E8EDF2');
  assert.equal(Colors.dark.accent, '#F4F6F8');
  assert.equal(Colors.dark.accentSoft, '#353B43');
});

test('accent text remains readable in both color schemes', () => {
  for (const theme of [Colors.light, Colors.dark]) {
    assert.ok(contrastRatio(theme.onAccent, theme.accent) >= 4.5);
    assert.ok(contrastRatio(theme.accent, theme.accentSoft) >= 4.5);
  }
});

test('secondary text and neutral icons remain readable on every themed surface', () => {
  for (const theme of [Colors.light, Colors.dark]) {
    for (const background of [theme.background, theme.surface, theme.surfaceMuted]) {
      assert.ok(contrastRatio(theme.textSecondary, background) >= 4.5);
    }
  }
});
