import { App as AntApp } from 'antd';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminUser } from '../api/client';
import { UsersPage } from './UsersPage';

const apiMocks = vi.hoisted(() => ({
  users: vi.fn(),
  policies: vi.fn(),
  accessPreview: vi.fn(),
  updateUser: vi.fn(),
}));

const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    adminApi: {
      ...actual.adminApi,
      users: apiMocks.users,
      policies: apiMocks.policies,
      accessPreview: apiMocks.accessPreview,
      updateUser: apiMocks.updateUser,
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
  id: 'member-id',
  email: 'member@example.com',
  displayName: 'Member One',
  role: 'member',
  status: 'active',
  createdAt: '2026-01-02T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const owner: AdminUser = {
  id: 'owner-id',
  email: 'owner@example.com',
  displayName: 'Owner One',
  role: 'owner',
  status: 'active',
  createdAt: '2026-01-03T00:00:00Z',
  updatedAt: '2026-01-03T00:00:00Z',
};

function mockCurrentUser(user: AdminUser) {
  useAuthMock.mockReturnValue({
    user,
    loading: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
  });
}

function renderUsersPage() {
  return render(
    <AntApp>
      <UsersPage />
    </AntApp>,
  );
}

function rowFor(displayName: string) {
  const row = screen.getByText(displayName).closest('tr');
  if (!row) throw new Error(`No table row found for ${displayName}`);
  return row;
}

function editButtonFor(displayName: string) {
  return within(rowFor(displayName)).getByRole('button', { name: /编\s*辑/ });
}

beforeEach(() => {
  apiMocks.users.mockReset();
  apiMocks.policies.mockReset();
  apiMocks.accessPreview.mockReset();
  apiMocks.updateUser.mockReset();
  useAuthMock.mockReset();
  apiMocks.users.mockResolvedValue([admin, member, owner]);
  apiMocks.policies.mockResolvedValue([]);
  apiMocks.updateUser.mockResolvedValue(undefined);
});

describe('UsersPage role-aware editing', () => {
  it('allows an admin to edit a regular member', async () => {
    mockCurrentUser(admin);
    const user = userEvent.setup();
    renderUsersPage();

    await screen.findByText(member.displayName);
    const editButton = editButtonFor(member.displayName);
    expect(editButton).toBeEnabled();
    await user.click(editButton);

    const dialog = await screen.findByRole('dialog');
    const displayNameInput = within(dialog).getByLabelText('显示名称');
    await user.clear(displayNameInput);
    await user.type(displayNameInput, 'Member Updated');
    await user.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      expect(apiMocks.updateUser).toHaveBeenCalledWith(member.id, { displayName: 'Member Updated' });
    });
  });

  it('disables editing an owner row for an admin', async () => {
    mockCurrentUser(admin);
    renderUsersPage();

    await screen.findByText(owner.displayName);
    expect(editButtonFor(owner.displayName)).toBeDisabled();
  });

  it('allows an owner to edit an owner', async () => {
    mockCurrentUser(owner);
    const user = userEvent.setup();
    renderUsersPage();

    await screen.findByText(owner.displayName);
    const editButton = editButtonFor(owner.displayName);
    expect(editButton).toBeEnabled();
    await user.click(editButton);

    const dialog = await screen.findByRole('dialog');
    const displayNameInput = within(dialog).getByLabelText('显示名称');
    await user.clear(displayNameInput);
    await user.type(displayNameInput, 'Owner Updated');
    await user.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      expect(apiMocks.updateUser).toHaveBeenCalledWith(owner.id, {
        displayName: 'Owner Updated',
        role: 'owner',
      });
    });
  });

  it('loads and renders the server access preview for the selected user', async () => {
    mockCurrentUser(admin);
    apiMocks.policies.mockResolvedValue([{
      policyId: 'policy-1',
      name: 'Engineering access',
      description: '',
      enabled: true,
      memberIds: [member.id],
      rules: [{ deviceId: 'dev-1', workspaceIds: ['ws-1'], scopes: ['read', 'approve'] }],
      revision: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }]);
    apiMocks.accessPreview.mockResolvedValue({
      userId: member.id,
      policyIds: ['policy-1'],
      desktops: [{
        deviceId: 'dev-1',
        deviceName: 'Engineering MacBook',
        online: true,
        workspaces: [{ id: 'ws-1', name: 'dsh-connect', scopes: ['read'] }],
        scopes: ['read', 'approve'],
      }],
    });
    const user = userEvent.setup();
    renderUsersPage();

    await screen.findByText(member.displayName);
    await user.click(within(rowFor(member.displayName)).getByRole('button', { name: /访\s*问\s*预\s*览/ }));

    const drawer = await screen.findByRole('dialog');
    await within(drawer).findByText('Engineering MacBook');
    expect(apiMocks.accessPreview).toHaveBeenCalledWith(member.id, expect.anything());
    expect(within(drawer).getByText('dsh-connect')).toBeInTheDocument();
    expect(within(drawer).getAllByText('read')).toHaveLength(2);
    expect(within(drawer).getByText('approve')).toBeInTheDocument();
    expect(within(drawer).getByText('在线')).toBeInTheDocument();
  });
});
