import { App as AntApp } from 'antd';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { DesktopPairingWizard } from './PairingPage';

const apiMocks = vi.hoisted(() => ({
  createPairingCode: vi.fn(),
  pairingCodes: vi.fn(),
}));

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    adminApi: {
      ...actual.adminApi,
      createPairingCode: apiMocks.createPairingCode,
      pairingCodes: apiMocks.pairingCodes,
    },
  };
});

beforeEach(() => {
  apiMocks.createPairingCode.mockReset();
  apiMocks.pairingCodes.mockReset();
  apiMocks.pairingCodes.mockResolvedValue([]);
  apiMocks.createPairingCode.mockResolvedValue({
    pairingId: 42,
    code: 'DC-COMPONENT-42',
    expiresAt: '2026-01-01T00:10:00Z',
    serverUrl: 'https://connect.example.com',
  });
});

it('tracks only the issued pairingId and notifies once when that desktop is ready', async () => {
  let state: 'active' | 'used' = 'active';
  apiMocks.pairingCodes.mockImplementation(async () => [
    {
      pairingId: 7,
      state: 'used',
      createdAt: '2026-01-01T00:00:00Z',
      expiresAt: '2026-01-01T00:10:00Z',
      deviceId: 'dev-other',
    },
    {
      pairingId: 42,
      state,
      createdAt: '2026-01-01T00:01:00Z',
      expiresAt: '2026-01-01T00:11:00Z',
      deviceId: 'dev-target',
    },
  ]);
  const onPaired = vi.fn();
  const user = userEvent.setup();
  render(
    <AntApp>
      <DesktopPairingWizard open onClose={vi.fn()} onPaired={onPaired} />
    </AntApp>,
  );

  await user.click(screen.getByRole('button', { name: /生成配对码/ }));
  await screen.findByText('DC-COMPONENT-42', { exact: true });
  await screen.findByText('等待桌面 Connector 建立连接', { exact: true });
  expect(onPaired).not.toHaveBeenCalled();

  state = 'used';
  await screen.findByText('桌面已授权并上线', { exact: true }, { timeout: 4_000 });
  expect(onPaired).toHaveBeenCalledTimes(1);
});

it('ignores a late issue response after the wizard is closed and reopened', async () => {
  let resolveIssue: ((value: {
    pairingId: number;
    code: string;
    expiresAt: string;
    serverUrl: string;
  }) => void) | undefined;
  apiMocks.createPairingCode.mockImplementation(() => new Promise((resolve) => {
    resolveIssue = resolve;
  }));
  const user = userEvent.setup();
  const view = render(
    <AntApp>
      <DesktopPairingWizard open onClose={vi.fn()} onPaired={vi.fn()} />
    </AntApp>,
  );

  await user.click(screen.getByRole('button', { name: /生成配对码/ }));
  await user.click(screen.getByRole('button', { name: /关\s*闭/ }));
  view.rerender(
    <AntApp>
      <DesktopPairingWizard open={false} onClose={vi.fn()} onPaired={vi.fn()} />
    </AntApp>,
  );
  view.rerender(
    <AntApp>
      <DesktopPairingWizard open onClose={vi.fn()} onPaired={vi.fn()} />
    </AntApp>,
  );
  await act(async () => {
    resolveIssue?.({
      pairingId: 42,
      code: 'DC-STALE-42',
      expiresAt: '2026-01-01T00:10:00Z',
      serverUrl: 'https://connect.example.com',
    });
  });

  expect(screen.queryByText('DC-STALE-42')).not.toBeInTheDocument();
  expect(apiMocks.pairingCodes).not.toHaveBeenCalled();
});
