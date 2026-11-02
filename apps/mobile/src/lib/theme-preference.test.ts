import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseThemePreference,
  resolveColorScheme,
} from './theme-preference';

test('theme preference restores supported values and rejects invalid storage', () => {
  assert.equal(parseThemePreference('system'), 'system');
  assert.equal(parseThemePreference('light'), 'light');
  assert.equal(parseThemePreference('dark'), 'dark');
  assert.equal(parseThemePreference('blue'), 'system');
  assert.equal(parseThemePreference(null), 'system');
});

test('explicit theme preference overrides the system appearance', () => {
  assert.equal(resolveColorScheme('light', 'dark'), 'light');
  assert.equal(resolveColorScheme('dark', 'light'), 'dark');
});

test('system theme preference follows the current system appearance', () => {
  assert.equal(resolveColorScheme('system', 'light'), 'light');
  assert.equal(resolveColorScheme('system', 'dark'), 'dark');
  assert.equal(resolveColorScheme('system', null), 'light');
});
