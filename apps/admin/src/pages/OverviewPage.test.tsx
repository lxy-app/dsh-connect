import { App as AntApp } from 'antd';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Overview } from '../api/client';
import { OverviewPage } from './OverviewPage';

const apiMocks = vi.hoisted(() => ({ overview: vi.fn() }));

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    adminApi: { ...actual.adminApi, overview: apiMocks.overview },
  };
});

const overview: Overview = {
  devices: { total: 3, online: 2, offline: 1 },
  users: { total: 4, active: 4 },
  activeSessions: 12,
  todayPrompts: 34,
  pendingInteractions: 9,
  promptTrend: [
    { date: '2026-01-01', count: 1 },
    { date: '2026-01-02', count: 2 },
    { date: '2026-01-03', count: 3 },
    { date: '2026-01-04', count: 4 },
    { date: '2026-01-05', count: 5 },
    { date: '2026-01-06', count: 6 },
    { date: '2026-01-07', count: 7 },
  ],
  sessions: [{
    sessionId: 'session-overview',
    title: 'Overview integration session',
    deviceId: 'dev-1',
    deviceName: 'MacBook Pro',
    workspaceId: 'ws-1',
    workspaceName: 'dsh-connect',
    status: 'running',
    updatedAt: '2026-01-07T01:00:00Z',
  }],
  pendingRequests: [{
    interactionId: 'interaction-1',
    kind: 'approval',
    title: 'Approve production deployment',
    toolName: 'bash',
    deviceId: 'dev-1',
    deviceName: 'MacBook Pro',
    sessionId: 'session-overview',
    workspaceId: 'ws-1',
    createdAt: '2026-01-07T01:01:00Z',
    expiresAt: '2026-01-07T01:06:00Z',
  }],
  warnings: [{
    deviceId: 'dev-2',
    deviceName: 'Windows PC',
    code: 'offline',
    message: 'Desktop did not return a snapshot',
  }],
  auditEntries: 1,
  recentActivity: [{
    occurredAt: '2026-01-07T01:02:00Z',
    actor: 'admin@example.com',
    action: 'admin.policy.update',
    result: 'success',
  }],
};

beforeEach(() => {
  apiMocks.overview.mockReset();
  apiMocks.overview.mockResolvedValue(overview);
});

it('renders API metrics, trend, sessions, pending requests and warnings', async () => {
  const user = userEvent.setup();
  render(
    <AntApp>
      <OverviewPage />
    </AntApp>,
  );

  await screen.findByText('Overview integration session');
  expect(screen.getByText('12')).toBeInTheDocument();
  expect(screen.getByText('34')).toBeInTheDocument();
  expect(screen.getByText('9')).toBeInTheDocument();
  expect(screen.getByLabelText('2026-01-07 7 条指令')).toBeInTheDocument();
  expect(screen.getByText('Approve production deployment')).toBeInTheDocument();
  expect(screen.getByText('Desktop did not return a snapshot')).toBeInTheDocument();
  expect(screen.getByText('部分桌面未返回，当前为部分快照')).toBeInTheDocument();
  expect(screen.getByText('admin.policy.update')).toBeInTheDocument();
  expect(apiMocks.overview).toHaveBeenCalledWith(
    expect.any(AbortSignal),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );

  await user.click(screen.getByRole('button', { name: /刷\s*新/ }));
  await waitFor(() => expect(apiMocks.overview).toHaveBeenCalledTimes(2));
});
