import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type * as PickerModule from '@shared/components/device-picker-sheet';
import type { SessionHeader as Header } from '@shared/components/session-header';
import type { ComponentProps } from 'react';

// Render the same shared TSX with React Native Web in the headless test process.
const load = createRequire(import.meta.url);
function loadComponent<T>(name: string): T {
  const source = readFileSync(new URL(`../../../mobile-shared/components/${name}.tsx`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {} as T;
  runInNewContext(outputText, {
    exports,
    require: (id: string) => load(id === 'react-native' ? 'react-native-web' : id),
  });
  return exports;
}
const header = loadComponent<{ SessionHeader: typeof Header }>('session-header');
const { DevicePickerSheet } = loadComponent<typeof PickerModule>('device-picker-sheet');
const { renderToStaticMarkup } = load('react-dom/server');
const { Text } = load('react-native-web');
const statusLabel = (label: string) => load('react').createElement(Text, null, label);

const defaults: ComponentProps<typeof Header> = {
  Icon: () => null,
  colors: { text: '#fff', textSecondary: '#999', surface: '#222', background: '#111', success: '#0c8', statusNeutral: '#777' },
  title: '评估产品付费方案', deviceName: '李伟的 Mac mini', workspaceName: 'memflow', online: true,
  refreshing: false, status: statusLabel('空闲'), onOpenDrawer() {}, onCreate() {}, onRefresh() {},
};

function render(overrides: Partial<typeof defaults> = {}): string {
  return renderToStaticMarkup(load('react').createElement(header.SessionHeader, { ...defaults, ...overrides }));
}

test('compact header shows device before workspace and exposes distinct drawer, create and refresh actions', () => {
  const html = render();
  assert.match(html, />李伟的 Mac mini<.*>memflow</s);
  for (const label of ['打开会话侧边栏', '新建会话', '刷新对话', '评估产品付费方案，李伟的 Mac mini，设备在线，memflow']) {
    assert.ok(html.includes(`aria-label="${label}"`));
  }
});

test('session header preserves running, waiting and idle status beside its actions', () => {
  for (const status of ['运行中', '等待中', '空闲']) {
    const html = render({ status: statusLabel(status) });
    assert.match(html, new RegExp(`${status}[\\s\\S]*aria-label="新建会话"`));
  }
});

test('permanent sidebar omits drawer action and unknown presence has no online or offline announcement', () => {
  const html = render({ onOpenDrawer: undefined, online: undefined, workspaceName: '' });
  assert.doesNotMatch(html, /打开会话侧边栏|memflow|设备在线|设备离线/);
  assert.match(html, /aria-label="评估产品付费方案，李伟的 Mac mini"/);
});

test('device picker identifies each authorized device, its presence and the current selection', () => {
  const desktop = { deviceId: 'a', deviceName: 'Office', online: true, connectorVersion: '', availableWorkspaces: [], availableScopes: [] };
  const props: ComponentProps<typeof DevicePickerSheet> = {
    devices: [desktop, { ...desktop, deviceId: 'b', deviceName: 'Home', online: false }],
    selectedId: 'b', loading: false, error: null, desktopIcon: null, bottomInset: 34,
    colors: { ...defaults.colors, border: '#333333', success: '#208A5B', textSecondary: '#777777' },
    onSelect() {}, onClose() {},
  };
  const renderPicker = (options: typeof props) => renderToStaticMarkup(load('react').createElement(DevicePickerSheet, options)) as string;
  const html = renderPicker(props);
  assert.match(html, /aria-label="关闭设备选择"/);
  const rows = html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const office = rows.find((row) => row.includes('aria-label="Office，在线"'));
  const home = rows.find((row) => row.includes('aria-label="Home，离线"'));
  assert.ok(office && home);
  assert.doesNotMatch(office, /✓/);
  assert.match(home, /✓/);
  assert.match(renderPicker({ ...props, devices: [] }), /暂无已授权设备/);
});
