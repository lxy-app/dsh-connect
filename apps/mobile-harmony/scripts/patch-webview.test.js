'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { patchWebView } = require('./patch-webview');

const UPSTREAM = `
Web({ src: "", controller: this.controller, renderMode: this.renderMode })
Web({ src: "", controller: this.controller, renderMode: this.renderMode })
  controllerAttachedInit(): void {
    this.controllerAttached = true;
  }
        this.controller.deleteJavaScriptRegister(JAVASCRIPT_INTERFACE)
        this.controller.refresh()
  onLoadingFinish() {
    this.webViewBaseOperate?.emitLoadingFinish({ progress: this.progress })
  }
  onLoadIntercept(event: OnLoadInterceptEvent): boolean {
    Logger.debug(TAG, "onLoadIntercept start")
  }
`;

test('initialization has no authenticated URL and cleanup only touches a bound controller', () => {
  const once = patchWebView(UPSTREAM);
  assert.equal(once.changed, true);
  assert.equal(once.source.split('Web({ src: "about:blank"').length - 1, 2);
  assert.match(once.source, /if \(!this.isComponentAlive \|\| this.controllerAttached\) return;/);
  assert.match(once.source, /if \(this.controllerAttached\) \{\s*this.controller.deleteJavaScriptRegister/);
  assert.doesNotMatch(once.source, /controller.refresh\(\)/);
  assert.match(once.source, /if \(this.source.html\)/);
  assert.match(once.source, /external navigation blocked[\s\S]*return true;/);
  assert.deepEqual(patchWebView(once.source), { source: once.source, changed: false });
});

test('unexpected or partially changed upstream fails instead of silently skipping', () => {
  assert.throws(() => patchWebView('unrelated code'), /Unexpected/);
  assert.throws(() => patchWebView(UPSTREAM.replace('Web({ src: ""', 'Web({ src: "about:blank"')), /Unexpected/);
});

test('blocked navigation notifies the UI but fails closed even when feedback throws', () => {
  const patched = patchWebView(UPSTREAM).source;
  const body = patched.split('  onLoadIntercept(event: OnLoadInterceptEvent): boolean {')[1].split('    Logger.debug')[0];
  const intercept = vm.runInNewContext(`(function(event) { ${body} return false; })`, {
    TAG: 'WebView',
    Logger: { info() {} },
  });
  const calls = [];
  const instance = {
    source: { html: '<p>file</p>', baseUrl: 'about:blank' },
    webViewBaseOperate: {
      setLockIdentifier(id) { calls.push(id); },
      emitShouldStartLoadWithRequest(event) { calls.push(event.data.getRequestUrl()); },
    },
  };
  for (const url of ['https://example.com', 'mailto:test@example.com', 'file:///private/file']) {
    assert.equal(intercept.call(instance, { data: { getRequestUrl: () => url } }), true);
    assert.deepEqual(calls.splice(0), [-1, url]);
  }
  for (const url of ['about:blank', 'data:text/html,hello', 'blob:local']) {
    assert.equal(intercept.call(instance, { data: { getRequestUrl: () => url } }), false);
    assert.equal(calls.length, 0);
  }
  instance.webViewBaseOperate.emitShouldStartLoadWithRequest = () => { throw new Error('bridge unavailable'); };
  assert.equal(intercept.call(instance, { data: { getRequestUrl: () => 'https://example.com' } }), true);
});

test('upgrades a previously installed blocking patch to feedback without losing idempotence', () => {
  const latest = patchWebView(UPSTREAM).source;
  const previous = latest.replace(/        try \{\n          this.webViewBaseOperate\?\.setLockIdentifier\(-1\);[\s\S]*?        \}\n/, '');
  assert.notEqual(previous, latest);
  assert.equal(patchWebView(previous).source, latest);
  assert.equal(patchWebView(latest).changed, false);
});

test('migrates the experimental URL patch without loading a credential-bearing address at construction', () => {
  const previous = UPSTREAM.replaceAll('src: ""', 'src: this.source.uri || "about:blank"');
  const patched = patchWebView(previous);
  assert.equal(patched.source, patchWebView(UPSTREAM).source);
  assert.doesNotMatch(patched.source, /Web\(\{ src: this.source.uri/);
});

test('shell patches the actual HAR, npm source and extracted copy, preserving other contents and repeatability', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-webview-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(scripts);
  for (const name of ['patch-webview.sh', 'patch-webview.js']) fs.copyFileSync(path.join(__dirname, name), path.join(scripts, name));
  const packageDir = path.join(root, 'node_modules/@react-native-ohos/react-native-webview/harmony');
  const sourcePaths = [
    path.join(packageDir, 'rn_webview/src/main/ets/RNCWebView.ets'),
    path.join(root, 'harmony/oh_modules/@react-native-ohos/react-native-webview/src/main/ets/RNCWebView.ets'),
    path.join(root, 'archive/package/src/main/ets/RNCWebView.ets'),
  ];
  for (const file of sourcePaths) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, UPSTREAM);
  }
  fs.writeFileSync(path.join(root, 'archive/package/resource.txt'), 'preserve resource');
  const har = path.join(packageDir, 'rn_webview.har');
  fs.writeFileSync(`${har}.sha256`, 'old checksum');
  execFileSync('tar', ['czf', har, '-C', path.join(root, 'archive'), 'package']);
  execFileSync('bash', [path.join(scripts, 'patch-webview.sh')]);
  const expected = patchWebView(UPSTREAM).source;
  for (const file of sourcePaths.slice(0, 2)) assert.equal(fs.readFileSync(file, 'utf8'), expected);
  assert.equal(execFileSync('tar', ['xzf', har, '-O', 'package/src/main/ets/RNCWebView.ets'], { encoding: 'utf8' }), expected);
  assert.equal(execFileSync('tar', ['xzf', har, '-O', 'package/resource.txt'], { encoding: 'utf8' }), 'preserve resource');
  const checksum = require('node:crypto').createHash('sha256').update(fs.readFileSync(har)).digest('hex');
  assert.equal(fs.readFileSync(`${har}.sha256`, 'utf8').trim(), `${checksum}  rn_webview.har`);
  const first = fs.readFileSync(har);
  execFileSync('bash', [path.join(scripts, 'patch-webview.sh')]);
  assert.deepEqual(fs.readFileSync(har), first);
});
