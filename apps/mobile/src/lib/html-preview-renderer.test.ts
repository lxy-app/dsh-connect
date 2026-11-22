import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

import { canNavigateLocalHtml } from '@shared/lib/html-preview';

// Exercise the renderer's WebView boundary without importing a native runtime.
// This checks the component contract, not WKWebView rendering on a device.
function renderPreview(html: string) {
  const effects: (() => void | (() => void))[] = [];
  const timers = new Map<number, () => void>();
  const errors: string[] = [];
  const exports: Record<string, (props: unknown) => { props: Record<string, unknown> }> = {};
  const jsx = (_type: unknown, props: unknown) => ({ props });
  const modules: Record<string, unknown> = {
    react: {
      useEffect: (effect: () => void | (() => void)) => effects.push(effect),
      useMemo: (factory: () => unknown) => factory(),
      useRef: (current: unknown) => ({ current }),
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { StyleSheet: { create: (s: unknown) => s, absoluteFillObject: {} } },
    'react-native-webview': { default: 'WebView', __esModule: true },
    '@/hooks/use-app-theme': { useAppTheme: () => ({ background: '#fff', accent: '#000' }) },
    '@shared/lib/html-preview': { canNavigateLocalHtml },
  };
  const source = readFileSync(new URL('../components/attachment-html-preview.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    require: (name: string) => { assert.ok(name in modules, `Unexpected renderer dependency: ${name}`); return modules[name]; },
    setTimeout: (callback: () => void) => { timers.set(1, callback); return 1; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  const result = exports.AttachmentHtmlPreview({ html, onError: (message: string) => errors.push(message) });
  const cleanups = effects.map((effect) => effect());
  return { props: result.props, timers, errors, close: () => cleanups.forEach((cleanup) => cleanup?.()) };
}

test('validated HTML enters WebView as text with no URL or authentication headers', () => {
  const html = '<h1>中文预览</h1><button onclick="this.textContent=123">点击</button>';
  const { props, close } = renderPreview(html);
  const source = props.source as Record<string, unknown>;
  assert.equal(source.html, html);
  assert.equal(source.baseUrl, 'about:blank');
  assert.equal(source.uri, undefined);
  assert.equal(source.headers, undefined);
  assert.equal(props.javaScriptEnabled, true);
  assert.equal(props.allowFileAccess, false);
  assert.equal(props.sharedCookiesEnabled, false);
  assert.equal(JSON.stringify(props.originWhitelist), '["*"]');
  const navigate = props.onShouldStartLoadWithRequest as (event: { url: string }) => boolean;
  assert.equal(navigate({ url: 'about:blank' }), true);
  for (const url of ['https://example.com', 'mailto:a@example.com', 'file:///private/data']) {
    assert.equal(navigate({ url }), false);
  }
  close();
});

test('failed or stalled WebView loads report retryable errors; loaded and closed views do not time out', () => {
  const stalled = renderPreview('<p>test</p>');
  stalled.timers.get(1)!();
  assert.match(stalled.errors[0], /超时/);
  stalled.close();
  assert.equal(stalled.timers.size, 0);
  const loaded = renderPreview('<p>test</p>');
  (loaded.props.onLoad as () => void)();
  loaded.timers.get(1)!();
  assert.equal(loaded.errors.length, 0);
  (loaded.props.onError as () => void)();
  assert.match(loaded.errors[0], /加载失败/);
  loaded.close();
});
