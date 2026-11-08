import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type Role = 'owner' | 'admin' | 'member' | 'auditor';

interface MockUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: 'active';
  createdAt: string;
  updatedAt: string;
}

interface MockPolicy {
  policyId: string;
  name: string;
  description: string;
  enabled: boolean;
  memberIds: string[];
  rules: Array<{ deviceId: string; workspaceIds: string[]; scopes: string[] }>;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

interface MockApprovalPolicy {
  remoteEnabled: boolean;
  ttlSeconds: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

interface ApprovalPolicyPatch {
  remoteEnabled?: boolean;
  ttlSeconds?: number;
  revision: number;
}

interface Scenario {
  pairingState: 'active' | 'waiting_desktop_authorization' | 'used' | 'expired';
  deviceLoads: number;
  sessionLoads: number;
  settingsLoads: number;
  policies: MockPolicy[];
  createdPolicies: Array<Omit<MockPolicy, 'policyId' | 'revision' | 'createdAt' | 'updatedAt'>>;
  approvalPolicy: MockApprovalPolicy;
  approvalPolicyPatches: ApprovalPolicyPatch[];
  unexpectedRequests: string[];
}

const owner: MockUser = {
  id: 'usr-owner-e2e',
  email: 'owner@example.com',
  displayName: 'E2E Owner',
  role: 'owner',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

async function mockAdminApi(page: Page, user: MockUser = owner): Promise<Scenario> {
  const scenario: Scenario = {
    pairingState: 'active',
    deviceLoads: 0,
    sessionLoads: 0,
    settingsLoads: 0,
    policies: [],
    createdPolicies: [],
    approvalPolicy: {
      remoteEnabled: true,
      ttlSeconds: 120,
      revision: 4,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    approvalPolicyPatches: [],
    unexpectedRequests: [],
  };
  await page.addInitScript(() => {
    localStorage.setItem('dsh-connect.admin.session', 'e2e-browser-session');
  });
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

    if (path === '/v1/admin/auth/me') return json(user);
    if (path === '/v1/admin/overview') {
      return json({ devices: {}, users: {}, auditEntries: 0, recentActivity: [] });
    }
    if (path === '/v1/admin/users') return json({ users: [user] });
    if (path === '/v1/admin/sessions' && method === 'GET') {
      scenario.sessionLoads += 1;
      return json({
        sessions: [{
          sessionId: 'session-e2e-1',
          title: 'E2E Running Session',
          deviceId: 'dev-e2e-1',
          deviceName: 'E2E MacBook',
          workspaceId: 'ws-1',
          workspaceName: 'dsh-connect',
          status: 'running',
          updatedAt: '2026-01-01T00:00:00Z',
        }],
        warnings: [{
          deviceId: 'dev-e2e-2',
          deviceName: 'E2E Windows',
          code: 'snapshot_delayed',
          message: 'Desktop snapshot is delayed',
        }],
      });
    }
    if (path === '/v1/admin/interactions' && method === 'GET') {
      return json({
        interactions: [{
          interactionId: 'interaction-e2e-approval',
          kind: 'approval',
          title: 'E2E production approval',
          toolName: 'bash',
          reason: 'The command modifies the production deployment',
          callId: 'call-e2e-42',
          questions: [],
          deviceId: 'dev-e2e-1',
          deviceName: 'E2E MacBook',
          sessionId: 'session-e2e-1',
          workspaceId: 'ws-1',
          workspaceName: 'dsh-connect',
          createdAt: '2026-01-01T00:00:00Z',
          expiresAt: '2026-01-01T00:02:00Z',
        }],
      });
    }
    if (path === '/v1/admin/approval-policy' && method === 'GET') return json(scenario.approvalPolicy);
    if (path === '/v1/admin/approval-policy' && method === 'PATCH') {
      const input = request.postDataJSON() as ApprovalPolicyPatch;
      scenario.approvalPolicyPatches.push(input);
      scenario.approvalPolicy = {
        ...scenario.approvalPolicy,
        ...input,
        revision: scenario.approvalPolicy.revision + 1,
        updatedAt: '2026-01-01T00:05:00Z',
      };
      return json(scenario.approvalPolicy);
    }
    if (path === '/v1/admin/settings' && method === 'GET') {
      scenario.settingsLoads += 1;
      return json({
        serverUrl: 'https://connect.example.com',
        pairingCodeTTLSeconds: 300,
        mobileAccessTokenTTLSeconds: 900,
        adminSessionTTLSeconds: 43200,
        commandTimeoutSeconds: 30,
        attachmentsMode: 'read',
        maxAttachmentBytes: 20971520,
        attachmentTTLSeconds: 604800,
        goVersion: 'go1.26.0',
        databaseDialect: 'postgresql',
        databaseConnected: true,
        generatedAt: '2026-01-03T04:05:06Z',
        databaseUrl: 'postgres://secret-database-password@internal/db',
        bootstrapToken: 'secret-e2e-bootstrap-token',
      });
    }
    if (path === '/v1/admin/policies' && method === 'GET') return json({ policies: scenario.policies });
    if (path === '/v1/admin/policies' && method === 'POST') {
      const input = request.postDataJSON() as Scenario['createdPolicies'][number];
      scenario.createdPolicies.push(input);
      const created: MockPolicy = {
        ...input,
        policyId: `policy-e2e-${scenario.createdPolicies.length}`,
        revision: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
      scenario.policies.push(created);
      return json(created, 201);
    }
    if (path === '/v1/admin/devices' && method === 'GET') {
      scenario.deviceLoads += 1;
      return json({
        devices: [{
          deviceId: 'dev-e2e-1',
          deviceName: 'E2E MacBook',
          fingerprint: 'AA:BB:CC:DD',
          connectorVersion: '1.0.0',
          status: 'online',
          workspaces: [{ id: 'ws-1', name: 'dsh-connect', path: '/tmp/dsh-connect' }],
          scopes: ['read', 'prompt'],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          lastSeenAt: '2026-01-01T00:00:00Z',
          hasToken: true,
        }],
      });
    }
    if (path === '/v1/admin/mobile-devices') {
      return json({
        devices: [{
          mobileDeviceId: 'mob-e2e-1',
          userId: user.id,
          deviceName: 'E2E iPhone',
          platform: 'ios',
          appVersion: '1.0.0',
          status: 'active',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          lastSeenAt: '2026-01-01T00:00:00Z',
        }],
      });
    }
    if (path === '/v1/admin/pairing-codes' && method === 'POST') {
      return json({
        pairingId: 42,
        code: 'DC-TEST-1234',
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        serverUrl: 'https://connect.example.com',
      }, 201);
    }
    if (path === '/v1/admin/pairing-codes' && method === 'GET') {
      return json({
        codes: [{
          pairingId: 42,
          state: scenario.pairingState,
          createdAt: '2026-01-01T00:00:00Z',
          expiresAt: '2026-01-01T00:10:00Z',
          deviceId: scenario.pairingState === 'active' ? undefined : 'dev-e2e-1',
        }],
      });
    }
    if (path === '/v1/admin/audit') return json({ entries: [], total: 0, limit: 20, offset: 0 });

    scenario.unexpectedRequests.push(`${method} ${path}`);
    return json({ error: { code: 'unexpected_test_request', message: 'Unexpected mocked request' } }, 500);
  });
  return scenario;
}

test('integrates device tabs and preserves legacy deep links', async ({ page }) => {
  const scenario = await mockAdminApi(page);
  await page.goto('/devices');
  await expect(page.getByRole('heading', { name: '设备管理' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '桌面 Connector' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('E2E MacBook', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: '手机设备' }).click();
  await expect(page).toHaveURL(/\/devices\?tab=mobile$/);
  await expect(page.getByText('E2E iPhone', { exact: true })).toBeVisible();

  await page.goto('/pairing');
  await expect(page).toHaveURL(/\/devices$/);
  await expect(page.getByRole('tab', { name: '桌面 Connector' })).toHaveAttribute('aria-selected', 'true');
  await page.goto('/mobile');
  await expect(page).toHaveURL(/\/devices\?tab=mobile$/);
  await expect(page.getByText('E2E iPhone', { exact: true })).toBeVisible();
  expect(scenario.unexpectedRequests).toEqual([]);
});

test('tracks the real pairing lifecycle and refreshes devices after completion', async ({ page }) => {
  const scenario = await mockAdminApi(page);
  await page.goto('/devices');
  await page.getByRole('button', { name: '添加桌面' }).click();
  await page.getByRole('button', { name: /生成配对码/ }).click();
  await expect(page.getByText('DC-TEST-1234', { exact: true })).toBeVisible();
  await expect(page.getByText('等待桌面 Connector 建立连接', { exact: true })).toBeVisible();

  scenario.pairingState = 'waiting_desktop_authorization';
  await expect(page.getByText('Connector 已连接，等待桌面用户确认', { exact: true })).toBeVisible();
  scenario.pairingState = 'used';
  await expect(page.getByText('桌面已授权并上线', { exact: true })).toBeVisible();
  await expect.poll(() => scenario.deviceLoads).toBeGreaterThanOrEqual(2);

  await page.locator('.ant-modal-footer').getByRole('button', { name: /关\s*闭/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('DC-TEST-1234', { exact: true })).toHaveCount(0);
  expect(scenario.unexpectedRequests).toEqual([]);
});

test('creates an access policy with members, desktop workspaces and scopes', async ({ page }) => {
  const scenario = await mockAdminApi(page);
  await page.goto('/policies');
  await expect(page.getByRole('heading', { name: '访问策略' })).toBeVisible();
  await page.getByRole('button', { name: '新建策略' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('策略名称').fill('E2E Engineering Policy');
  await drawer.getByLabel('策略描述').fill('Created through the mocked Admin API');
  await drawer.getByRole('combobox', { name: '关联成员' }).click();
  await page.getByText('E2E Owner (owner@example.com)', { exact: true }).click();
  await drawer.getByRole('combobox', { name: '关联成员' }).press('Escape');
  await drawer.getByRole('button', { name: '添加规则' }).click();
  await drawer.getByRole('combobox', { name: '规则 1 桌面' }).click();
  await page.getByText('E2E MacBook (dev-e2e-1)', { exact: true }).click();
  await drawer.getByRole('combobox', { name: '规则 1 工作区' }).click();
  await page.getByText('dsh-connect (/tmp/dsh-connect)', { exact: true }).click();
  await drawer.getByRole('combobox', { name: '规则 1 工作区' }).press('Escape');
  await drawer.getByRole('checkbox', { name: 'read', exact: true }).check();
  await drawer.getByRole('checkbox', { name: 'prompt', exact: true }).check();
  await drawer.getByRole('button', { name: '保存策略' }).click();

  await expect(drawer).toHaveCount(0);
  await expect(page.getByText('E2E Engineering Policy', { exact: true })).toBeVisible();
  expect(scenario.createdPolicies).toEqual([{
    name: 'E2E Engineering Policy',
    description: 'Created through the mocked Admin API',
    enabled: true,
    memberIds: [owner.id],
    rules: [{ deviceId: 'dev-e2e-1', workspaceIds: ['ws-1'], scopes: ['read', 'prompt'] }],
  }]);
  expect(scenario.unexpectedRequests).toEqual([]);
});

test('loads running session metadata and warnings with manual refresh', async ({ page }) => {
  const scenario = await mockAdminApi(page);
  await page.goto('/running');
  await expect(page.getByRole('heading', { name: '运行会话' })).toBeVisible();
  await expect(page.getByText('E2E Running Session', { exact: true })).toBeVisible();
  await expect(page.getByText('session-e2e-1', { exact: true })).toBeVisible();
  await expect(page.getByText('dsh-connect', { exact: true })).toBeVisible();
  await expect(page.getByText('部分桌面未返回，当前为部分快照', { exact: true })).toBeVisible();
  await expect(page.getByText(/Desktop snapshot is delayed/)).toBeVisible();

  await page.getByRole('button', { name: /刷\s*新/ }).click();
  await expect.poll(() => scenario.sessionLoads).toBeGreaterThanOrEqual(2);
  expect(scenario.unexpectedRequests).toEqual([]);
});

test('saves approval policy with revision and refreshes the remote switch', async ({ page }) => {
  const scenario = await mockAdminApi(page);
  await page.goto('/approvals');
  await expect(page.getByRole('heading', { name: '远程审批' })).toBeVisible();
  await expect(page.getByText('E2E production approval', { exact: true })).toBeVisible();
  await expect(page.getByText('一次性、超时失败关闭，桌面链保留', { exact: true })).toBeVisible();
  await expect(page.getByText('移动端待接入', { exact: true })).toBeVisible();

  await page.getByRole('switch', { name: '远程审批' }).click();
  await page.getByRole('spinbutton', { name: '审批 TTL（秒）' }).fill('300');
  await page.getByRole('button', { name: '保存审批策略' }).click();

  await expect.poll(() => scenario.approvalPolicyPatches.length).toBe(1);
  expect(scenario.approvalPolicyPatches).toEqual([{ remoteEnabled: false, ttlSeconds: 300, revision: 4 }]);
  await expect(page.getByRole('switch', { name: '远程审批' })).not.toBeChecked();
  await expect(page.getByRole('spinbutton', { name: '审批 TTL（秒）' })).toHaveValue('300');
  expect(scenario.unexpectedRequests).toEqual([]);
});

test('reads runtime settings without rendering unexpected secret fields', async ({ page }) => {
  const scenario = await mockAdminApi(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '系统设置' })).toBeVisible();
  await expect(page.getByText('https://connect.example.com', { exact: true })).toBeVisible();
  await expect(page.getByText('go1.26.0', { exact: true })).toBeVisible();
  await expect(page.getByText('postgresql', { exact: true })).toBeVisible();
  await expect(page.getByText('已连接', { exact: true })).toBeVisible();
  await expect(page.getByText('APNs / FCM 推送', { exact: true })).toBeVisible();
  await expect(page.getByText('锁屏通知隐私', { exact: true })).toBeVisible();
  await expect(page.getByText('未接入', { exact: true })).toHaveCount(2);
  await expect(page.getByText(/secret-database-password/)).toHaveCount(0);
  await expect(page.getByText('secret-e2e-bootstrap-token', { exact: true })).toHaveCount(0);
  expect(scenario.settingsLoads).toBeGreaterThanOrEqual(1);
  expect(scenario.unexpectedRequests).toEqual([]);
});

test('blocks member management routes before any global data request', async ({ page }) => {
  const member: MockUser = { ...owner, id: 'usr-member-e2e', displayName: 'E2E Member', role: 'member' };
  const scenario = await mockAdminApi(page, member);
  await page.goto('/devices');
  await expect(page.getByText('当前账号没有全局管理权限', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '添加桌面' })).toHaveCount(0);
  expect(scenario.deviceLoads).toBe(0);
  expect(scenario.unexpectedRequests).toEqual([]);
});
