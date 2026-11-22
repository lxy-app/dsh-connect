'use strict';

const { withEntryAbility } = require('@expo-harmony/config-plugins');

function initializeArkWebOnMainThread(source) {
  const marker = '// DSH: initialize ArkWeb on the UI thread before RNOH networking starts.';
  if (source.includes(marker)) return source;
  const entry = 'export default class EntryAbility extends ExpoRNAbility {';
  if (!source.includes(entry) || source.includes('onCreate(')) {
    throw new Error('Unexpected EntryAbility lifecycle; review ArkWeb initialization before regenerating.');
  }
  return source.replace(entry, `import { webview } from '@kit.ArkWeb';
import { AbilityConstant, Want } from '@kit.AbilityKit';

let arkWebInitialized = false;

${entry}
  ${marker}
  override onCreate(want: Want, launch?: AbilityConstant.LaunchParam): void {
    if (!arkWebInitialized) {
      try {
        webview.WebviewController.initializeWebEngine();
        arkWebInitialized = true;
        console.info('[HTMLPreview] ArkWeb initialized on UI thread');
      } catch {
        console.error('[HTMLPreview] ArkWeb initialization failed');
      }
    }
    super.onCreate(want, launch);
  }
`);
}

module.exports = function withArkWeb(config) {
  return withEntryAbility(config, (mod) => {
    mod.modResults = initializeArkWebOnMainThread(mod.modResults);
    return mod;
  });
};
module.exports.initializeArkWebOnMainThread = initializeArkWebOnMainThread;
