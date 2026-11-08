import { App as AntApp } from 'antd';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminSettings, AdminUser, Role } from '../api/client';
import { formatDateTime } from '../utils/format';
import { SettingsPage } from './SettingsPage';

const apiMocks = vi.hoisted(() => ({ settings: vi.fn() }));
const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    adminApi: { ...actual.adminApi, settings: apiMocks.settings },
  };
});

vi.mock('../auth/AuthProvider', () => ({ useAuth: useAuthMock }));

const admin: AdminUser = {
  id: 'admin-id',
  email: 'admin@example.com',
  displayName: 'Admin One',
  role: 'admin',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const settings: AdminSettings = {
  serverUrl: 'https://connect.example.com',
  pairingCodeTTLSeconds: 300,
  mobileAccessTokenTTLSeconds: 900,
  adminSessionTTLSeconds: 43200,
  commandTimeoutSeconds: 30,
  attachmentsMode: 'read',
  maxAttachmentBytes: 20 * 1024 * 1024,
  attachmentTTLSeconds: 604800,
  goVersion: 'go1.26.0',
  databaseDialect: 'postgresql',
  databaseConnected: true,
  generatedAt: '2026-01-03T04:05:06Z',
};

function setRole(role: Role) {
  useAuthMock.mockReturnValue({
    user: { ...admin, role },
    loading: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
  });
}

function renderSettingsPage() {
  return render(
    <AntApp>
      <SettingsPage />
    </AntApp>,
  );
}

beforeEach(() => {
  apiMocks.settings.mockReset();
  useAuthMock.mockReset();
  setRole('admin');
  apiMocks.settings.mockResolvedValue(settings);
});

describe('SettingsPage', () => {
  it('renders only real runtime configuration, health and unavailable capability status', async () => {
    apiMocks.settings.mockResolvedValue({
      ...settings,
      databaseUrl: 'postgres://admin:secret-database-password@internal/db',
      bootstrapToken: 'super-secret-bootstrap-token',
      apnsPrivateKey: 'secret-apns-private-key',
    });
    renderSettingsPage();

    await screen.findByText('https://connect.example.com');
    expect(screen.getByText('300 秒')).toBeInTheDocument();
    expect(screen.getByText('900 秒')).toBeInTheDocument();
    expect(screen.getByText('30 秒')).toBeInTheDocument();
    expect(screen.getByText('read')).toBeInTheDocument();
    expect(screen.getByText(/20 MiB/)).toBeInTheDocument();
    expect(screen.getByText('go1.26.0')).toBeInTheDocument();
    expect(screen.getByText('postgresql')).toBeInTheDocument();
    expect(screen.getByText('已连接')).toBeInTheDocument();
    expect(screen.getByText(formatDateTime(settings.generatedAt))).toBeInTheDocument();
    expect(screen.getAllByText('未接入')).toHaveLength(2);
    expect(screen.getAllByText(/由部署配置管理/)).toHaveLength(2);

    expect(screen.queryByText(/secret-database-password/)).not.toBeInTheDocument();
    expect(screen.queryByText('super-secret-bootstrap-token')).not.toBeInTheDocument();
    expect(screen.queryByText('secret-apns-private-key')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it.each(['auditor', 'member'] as const)('blocks %s before requesting settings', async (role) => {
    setRole(role);
    renderSettingsPage();

    await screen.findByText('当前账号没有系统设置权限');
    expect(apiMocks.settings).not.toHaveBeenCalled();
    expect(screen.queryByText('https://connect.example.com')).not.toBeInTheDocument();
  });
});
