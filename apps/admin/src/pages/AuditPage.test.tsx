import { App as AntApp } from 'antd';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AccessPolicy, AuditEntry } from '../api/client';
import { AuditPage } from './AuditPage';

const apiMocks = vi.hoisted(() => ({ audit: vi.fn() }));

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    adminApi: { ...actual.adminApi, audit: apiMocks.audit },
  };
});

const beforePolicy: AccessPolicy = {
  policyId: 'policy-1',
  name: 'Engineering access',
  description: 'Before',
  enabled: true,
  memberIds: ['member-1'],
  rules: [{ deviceId: 'dev-1', workspaceIds: ['ws-1'], scopes: ['read'] }],
  revision: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const afterPolicy: AccessPolicy = {
  ...beforePolicy,
  description: 'After',
  rules: [{ deviceId: 'dev-1', workspaceIds: ['ws-1'], scopes: ['read', 'prompt'] }],
  revision: 2,
  updatedAt: '2026-01-02T00:00:00Z',
};

const entries: AuditEntry[] = [
  {
    occurredAt: '2026-01-02T00:00:00Z',
    actor: 'admin@example.com',
    action: 'admin.policy.update',
    requestId: 'request-1',
    result: 'success',
    details: { before: beforePolicy, after: afterPolicy },
  },
  {
    occurredAt: '2026-01-02T00:01:00Z',
    actor: 'admin@example.com',
    action: 'admin.user.update',
    requestId: 'request-2',
    result: 'success',
  },
];

beforeEach(() => {
  apiMocks.audit.mockReset();
  apiMocks.audit.mockResolvedValue({ entries, total: 2, limit: 20, offset: 0 });
});

it('expands policy audit details as formatted before and after JSON', async () => {
  const user = userEvent.setup();
  render(
    <AntApp>
      <AuditPage />
    </AntApp>,
  );

  await screen.findByText('admin.policy.update');
  const expandButtons = screen.getAllByRole('button', { name: /expand row/i });
  expect(expandButtons).toHaveLength(1);
  await user.click(expandButtons[0]!);

  const before = screen.getByLabelText('策略变更前 JSON');
  const after = screen.getByLabelText('策略变更后 JSON');
  expect(before).toHaveTextContent('"description": "Before"');
  expect(before).toHaveTextContent('"revision": 1');
  expect(after).toHaveTextContent('"description": "After"');
  expect(after).toHaveTextContent('"prompt"');
  expect(after).toHaveTextContent('"revision": 2');
});
