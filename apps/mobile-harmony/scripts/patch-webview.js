'use strict';

const fs = require('node:fs');
const blockedNavigation = `        Logger.info(TAG, "[HTMLPreview] external navigation blocked");
        return true;`;
const blockedNavigationWithFeedback = `        Logger.info(TAG, "[HTMLPreview] external navigation blocked");
        try {
          this.webViewBaseOperate?.setLockIdentifier(-1);
          this.webViewBaseOperate?.emitShouldStartLoadWithRequest(event, this.source.html, this.source.baseUrl);
        } catch {
          Logger.info(TAG, "[HTMLPreview] navigation feedback unavailable");
        }
        return true;`;

function replaceKnown(source, before, after, count = 1) {
  if (source.split(after).length - 1 === count && !source.includes(before)) return source;
  if (source.split(before).length - 1 !== count || source.includes(after)) {
    throw new Error('Unexpected or incomplete WebView 13.16.4 implementation');
  }
  return source.split(before).join(after);
}

function patchWebView(source) {
  let next = source.replace(blockedNavigationWithFeedback, blockedNavigation);
  // Migrate the earlier experimental patch; never load an authenticated URL via Web.src.
  next = next.replaceAll('Web({ src: this.source.uri || "about:blank", controller: this.controller, renderMode: this.renderMode })',
    'Web({ src: "", controller: this.controller, renderMode: this.renderMode })');
  next = replaceKnown(next,
    'Web({ src: "", controller: this.controller, renderMode: this.renderMode })',
    'Web({ src: "about:blank", controller: this.controller, renderMode: this.renderMode })', 2);

  // A timer cannot establish a controller binding. Only onControllerAttached may do that.
  const delayedInit = `      setTimeout(() => {
        try {
          this.controllerAttachedInit();
        } catch (error) {
          Logger.error(TAG, \`[RNOH] delayed controllerAttachedInit failed: \${error}\`);
        }
      }, 500);
`;
  next = next.replace(delayedInit, '');
  next = replaceKnown(next,
    '  controllerAttachedInit(): void {\n    this.controllerAttached = true;',
    '  controllerAttachedInit(): void {\n    if (!this.isComponentAlive || this.controllerAttached) return;\n    this.controllerAttached = true;\n    Logger.info(TAG, "[HTMLPreview] controller attached");');
  next = replaceKnown(next,
    '        this.controller.deleteJavaScriptRegister(JAVASCRIPT_INTERFACE)\n        this.controller.refresh()',
    '        if (this.controllerAttached) {\n          this.controller.deleteJavaScriptRegister(JAVASCRIPT_INTERFACE)\n        }\n        this.controllerAttached = false;');
  next = replaceKnown(next,
    '  onLoadingFinish() {\n    this.webViewBaseOperate?.emitLoadingFinish',
    '  onLoadingFinish() {\n    Logger.info(TAG, "[HTMLPreview] page finished");\n    this.webViewBaseOperate?.emitLoadingFinish');
  // Inline HTML must fail closed even if the JS bridge cannot answer in time.
  next = replaceKnown(next,
    '  onLoadIntercept(event: OnLoadInterceptEvent): boolean {\n    Logger.debug',
    `  onLoadIntercept(event: OnLoadInterceptEvent): boolean {
    if (this.source.html) {
      const destination = event.data.getRequestUrl().trim().toLowerCase();
      if (destination !== "about:blank" && !destination.startsWith("data:") && !destination.startsWith("blob:")) {
        Logger.info(TAG, "[HTMLPreview] external navigation blocked");
        return true;
      }
    }
    Logger.debug`);
  // Notify React for contextual feedback, without waiting for JS or reusing a live lock.
  next = replaceKnown(next, blockedNavigation, blockedNavigationWithFeedback);
  return { source: next, changed: next !== source };
}

module.exports = { patchWebView };
if (require.main === module) {
  const file = process.argv[2];
  const result = patchWebView(fs.readFileSync(file, 'utf8'));
  if (result.changed) {
    fs.writeFileSync(file, result.source);
    console.log(`[patch] ${file}`);
  }
}
