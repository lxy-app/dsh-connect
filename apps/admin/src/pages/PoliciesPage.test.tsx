import { App as AntApp } from 'antd';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { AccessPolicy, AdminUser, Device } from '../api/client';
import { PoliciesPage } from './PoliciesPage';

const apiMocks = vi.hoisted(() => ({
  policies: vi.fn(),
  users: vi.fn(),
  devices: vi.fn(),
  createPolicy: vi.fn(),
  updatePolicy: vi.fn(),
  deletePolicy: vi.fn(),
}));

const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    adminApi: {
      ...actual.adminApi,
      policies: apiMocks.policies,
      users: apiMocks.users,
      devices: apiMocks.devices,
      createPolicy: apiMocks.createPolicy,
      updatePolicy: apiMocks.updatePolicy,
      deletePolicy: apiMocks.deletePolicy,
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

const member: AdminUser = {
  ...admin,
  id: 'member-id',
  email: 'member@example.com',
  displayName: 'Member One',
  role: 'member',
};

const device: Device = {
  deviceId: 'dev-1',
  deviceName: 'Engineering MacBook',
  fingerprint: 'AA:BB:CC:DD',
  connectorVersion: '1.0.0',
  status: 'online',
  workspaces: [{ id: 'ws-1', name: 'dsh-connect', path: '/work/dsh-connect' }],
  scopes: ['read', 'prompt', 'cancel', 'approve'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  hasToken: true,
};

const policy: AccessPolicy = {
  policyId: 'policy-1',
  name: 'Engineering access',
  description: 'Daily engineering work',
  enabled: true,
  memberIds: [member.id],
  rules: [{ deviceId: device.deviceId, workspaceIds: ['ws-1'], scopes: ['read'] }],
  revision: 3,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

function renderPoliciesPage() {
  return render(
    <AntApp>
      <PoliciesPage />
    </AntApp>,
  );
}

beforeEach(() => {
  Object.values(apiMocks).forEach((mock) => mock.mockReset());
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue({
    user: admin,
    loading: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
  });
  apiMocks.policies.mockResolvedValue([policy]);
  apiMocks.users.mockResolvedValue([admin, member]);
  apiMocks.devices.mockResolvedValue([device]);
  apiMocks.updatePolicy.mockResolvedValue(policy);
  apiMocks.deletePolicy.mockResolvedValue(undefined);
});

describe('PoliciesPage editing', () => {
  it('saves edited rules with the current revision', async () => {
    const user = userEvent.setup();
    renderPoliciesPage();

    await screen.findByText(policy.name);
    await user.click(screen.getByRole('button', { name: /编\s*辑/ }));
    const drawer = await screen.findByRole('dialog');
    const name = within(drawer).getByLabelText('策略名称');
    await user.clear(name);
    await user.type(name, 'Engineering updated');
    await user.click(within(drawer).getByRole('checkbox', { name: 'approve' }));
    await user.click(within(drawer).getByRole('button', { name: '保存策略' }));

    await waitFor(() => {
      expect(apiMocks.updatePolicy).toHaveBeenCalledWith(policy.policyId, {
        name: 'Engineering updated',
        description: policy.description,
        enabled: true,
        memberIds: [member.id],
        rules: [{ deviceId: device.deviceId, workspaceIds: ['ws-1'], scopes: ['read', 'approve'] }],
        revision: 3,
      });
    });
  });

  it('only offers and submits scopes authorized on the selected desktop', async () => {
    apiMocks.devices.mockResolvedValue([{ ...device, scopes: ['read', 'prompt'] }]);
    apiMocks.policies.mockResolvedValue([{
      ...policy,
      rules: [{ deviceId: device.deviceId, workspaceIds: ['ws-1'], scopes: ['read', 'cancel'] }],
    }]);
    const user = userEvent.setup();
    renderPoliciesPage();

    await screen.findByText(policy.name);
    await user.click(screen.getByRole('button', { name: /编\s*辑/ }));
    const drawer = await screen.findByRole('dialog');

    expect(within(drawer).getByRole('checkbox', { name: 'read' })).toBeChecked();
    expect(within(drawer).getByRole('checkbox', { name: 'prompt' })).not.toBeChecked();
    expect(within(drawer).queryByRole('checkbox', { name: 'cancel' })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('checkbox', { name: 'approve' })).not.toBeInTheDocument();

    await user.click(within(drawer).getByRole('checkbox', { name: 'prompt' }));
    await user.click(within(drawer).getByRole('button', { name: '保存策略' }));

    await waitFor(() => {
      expect(apiMocks.updatePolicy).toHaveBeenCalledWith(policy.policyId, {
        name: policy.name,
        description: policy.description,
        enabled: true,
        memberIds: [member.id],
        rules: [{ deviceId: device.deviceId, workspaceIds: ['ws-1'], scopes: ['read', 'prompt'] }],
        revision: 3,
      });
    });
  });

  it('keeps the editor open and explains a revision conflict', async () => {
    apiMocks.updatePolicy.mockRejectedValue(new ApiError(409, 'revision_conflict', 'Policy has changed'));
    const user = userEvent.setup();
    renderPoliciesPage();

    await screen.findByText(policy.name);
    await user.click(screen.getByRole('button', { name: /编\s*辑/ }));
    const drawer = await screen.findByRole('dialog');
    const name = within(drawer).getByLabelText('策略名称');
    await user.clear(name);
    await user.type(name, 'Concurrent edit');
    await user.click(within(drawer).getByRole('button', { name: '保存策略' }));

    await within(drawer).findByText('策略版本已变化');
    expect(within(drawer).getByLabelText('策略名称')).toHaveValue('Concurrent edit');
    expect(within(drawer).getByRole('button', { name: /保存策略/ })).toBeInTheDocument();
  });
});
