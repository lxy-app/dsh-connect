'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { initializeArkWebOnMainThread } = require('../plugins/with-arkweb');

const ENTRY = `import { ExpoRNAbility } from '@expo-harmony/expo';
export default class EntryAbility extends ExpoRNAbility {
  override getPagePath(): string { return 'pages/Index'; }
}`;

test('startup plugin runs after the canonical EntryAbility generator', () => {
  // Harmony mods execute in reverse registration order.
  const plugins = require('../app.json').expo.plugins;
  assert.ok(plugins.indexOf('./plugins/with-arkweb') < plugins.indexOf('@expo-harmony/prebuild-config'));
  assert.ok(plugins.includes('./plugins/with-arkweb'));
});

test('ArkWeb initializes synchronously once before the RNOH worker can start', () => {
  const source = initializeArkWebOnMainThread(ENTRY);
  assert.ok(source.indexOf('initializeWebEngine();') < source.indexOf('super.onCreate(want, launch)'));
  assert.match(source, /if \(!arkWebInitialized\)/);
  assert.doesNotMatch(source, /await|setTimeout/);
  assert.match(source, /getPagePath\(\)/);
  assert.equal(initializeArkWebOnMainThread(source), source);
});

test('an existing unknown startup hook must be reviewed, not duplicated', () => {
  assert.throws(() => initializeArkWebOnMainThread('unrelated'), /Unexpected EntryAbility/);
  assert.throws(() => initializeArkWebOnMainThread(ENTRY.replace('override getPagePath()', 'onCreate()')), /Unexpected EntryAbility/);
});
