import { App as AntApp } from 'antd';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AdminUser, MobileDevice } from '../api/client';
import { MobileDevicesPanel } from './MobilePage';

const apiMocks = vi.hoisted(() => ({
  users: vi.fn(),
  mobileDevices: vi.fn(),
  revokeMobileDevice: vi.fn(),
}));

const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    adminApi: {
      ...actual.adminApi,
      users: apiMocks.users,
      mobileDevices: apiMocks.mobileDevices,
      revokeMobileDevice: apiMocks.revokeMobileDevice,
    },
  };
});

vi.mock('../auth/AuthProvider', () => ({
  useAuth: useAuthMock,
}));

const admin: AdminUser = {
  id: 'admin-id',
  email: 'admin@example.com',
  displayName: 'Admin One',
  role: 'admin',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const device: MobileDevice = {
  mobileDeviceId: 'mob-test-1',
  userId: admin.id,
  deviceName: 'Admin iPhone',
  platform: 'ios',
  appVersion: '1.0.0',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function renderPanel() {
  return render(
    <AntApp>
      <MobileDevicesPanel />
    </AntApp>,
  );
}

beforeEach(() => {
  apiMocks.users.mockReset();
  apiMocks.mobileDevices.mockReset();
  apiMocks.revokeMobileDevice.mockReset();
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue({
    user: admin,
    loading: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
  });
  apiMocks.users.mockResolvedValue([admin]);
  apiMocks.mobileDevices.mockResolvedValue([device]);
  apiMocks.revokeMobileDevice.mockResolvedValue({ status: 'revoked' });
});

it('shows login devices without phone pairing or pairing-code controls', async () => {
  renderPanel();

  expect(await screen.findByText(device.deviceName)).toBeInTheDocument();
  expect(screen.getByText('登录设备')).toBeInTheDocument();
  expect(screen.queryByText('添加手机')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /生成二维码/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /复制配对码|复制配对链接/ })).not.toBeInTheDocument();
  expect(apiMocks.users).toHaveBeenCalledTimes(1);
  expect(apiMocks.mobileDevices).toHaveBeenCalledTimes(1);
});

it('revokes only the selected login device and tells the user to sign in again', async () => {
  const user = userEvent.setup();
  renderPanel();

  const deviceName = await screen.findByText(device.deviceName);
  const row = deviceName.closest('tr');
  if (!row) throw new Error('No mobile device row found');
  await user.click(within(row).getByRole('button', { name: /吊\s*销/ }));

  expect(await screen.findByText('该手机的全部 Access/Refresh Token 立即失效，需要重新登录。')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^(?:OK|确\s*定)$/ }));

  await waitFor(() => {
    expect(apiMocks.revokeMobileDevice).toHaveBeenCalledWith(device.mobileDeviceId);
  });
  expect(apiMocks.mobileDevices).toHaveBeenCalledTimes(2);
});
