import { App as AntApp } from 'antd';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AdminSession } from '../api/client';
import { RunningPage } from './RunningPage';

const apiMocks = vi.hoisted(() => ({ sessions: vi.fn() }));

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    adminApi: { ...actual.adminApi, sessions: apiMocks.sessions },
  };
});

const sessions: AdminSession[] = [
  {
    sessionId: 'session-running',
    title: 'Implement M3 operations',
    deviceId: 'dev-1',
    deviceName: 'MacBook Pro',
    workspaceId: 'ws-1',
    workspaceName: 'dsh-connect',
    status: 'running',
    updatedAt: '2026-01-02T00:00:00Z',
  },
  {
    sessionId: 'session-idle',
    title: 'Review connector changes',
    deviceId: 'dev-2',
    deviceName: 'Windows PC',
    workspaceId: 'ws-2',
    workspaceName: 'connector',
    status: 'idle',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

beforeEach(() => {
  apiMocks.sessions.mockReset();
  apiMocks.sessions.mockResolvedValue({
    sessions,
    warnings: [{
      deviceId: 'dev-2',
      deviceName: 'Windows PC',
      code: 'session_snapshot_stale',
      message: 'Last snapshot is older than expected',
    }],
  });
});

it('renders warnings and filters sessions by status', async () => {
  const user = userEvent.setup();
  render(
    <AntApp>
      <RunningPage />
    </AntApp>,
  );

  await screen.findByText('Implement M3 operations');
  expect(screen.getByText('Review connector changes')).toBeInTheDocument();
  expect(screen.getByText('Last snapshot is older than expected')).toBeInTheDocument();
  expect(screen.getByText('session_snapshot_stale')).toBeInTheDocument();

  await user.click(screen.getByRole('combobox', { name: '按状态筛选' }));
  const runningOptions = screen.getAllByText('running');
  await user.click(runningOptions[runningOptions.length - 1]!);

  expect(screen.getByText('Implement M3 operations')).toBeInTheDocument();
  expect(screen.queryByText('Review connector changes')).not.toBeInTheDocument();
  expect(screen.getByText('显示 1 / 2 条会话')).toBeInTheDocument();
});
