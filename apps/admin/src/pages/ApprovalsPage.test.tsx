import { App as AntApp } from 'antd';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { AdminInteraction, AdminUser, ApprovalPolicy, Role } from '../api/client';
import { ApprovalsPage } from './ApprovalsPage';

const apiMocks = vi.hoisted(() => ({
  interactions: vi.fn(),
  approvalPolicy: vi.fn(),
  updateApprovalPolicy: vi.fn(),
}));

const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    adminApi: {
      ...actual.adminApi,
      interactions: apiMocks.interactions,
      approvalPolicy: apiMocks.approvalPolicy,
      updateApprovalPolicy: apiMocks.updateApprovalPolicy,
    },
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

const interactions: AdminInteraction[] = [
  {
    interactionId: 'interaction-approval',
    kind: 'approval',
    title: 'Run database migration',
    toolName: 'bash',
    reason: 'The migration changes the production schema',
    callId: 'call-approval-1',
    deviceId: 'dev-1',
    deviceName: 'Engineering MacBook',
    sessionId: 'session-1',
    workspaceId: 'ws-1',
    workspaceName: 'dsh-connect',
    createdAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-01-01T00:02:00Z',
  },
  {
    interactionId: 'interaction-question',
    kind: 'question',
    title: 'Choose deployment target',
    toolName: 'dsh_user_questions',
    reason: 'The agent needs an explicit target before continuing',
    callId: 'call-question-42',
    questions: [
      {
        id: 'question-target',
        header: 'Deployment target',
        question: 'Which environment should receive this build?',
        detail: 'This choice affects only the current deployment.',
        multiSelect: false,
        options: [
          { label: 'Staging', description: 'Deploy to the isolated staging environment' },
          { label: 'Production', description: 'Deploy to the production environment' },
        ],
      },
    ],
    deviceId: 'dev-2',
    deviceName: 'Release Workstation',
    sessionId: 'session-release',
    workspaceId: 'ws-release',
    workspaceName: 'release-workspace',
    createdAt: '2026-01-01T01:00:00Z',
    expiresAt: '2026-01-01T01:03:00Z',
  },
];

const policy: ApprovalPolicy = {
  remoteEnabled: true,
  ttlSeconds: 120,
  revision: 7,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
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

function renderApprovalsPage() {
  return render(
    <AntApp>
      <ApprovalsPage />
    </AntApp>,
  );
}

beforeEach(() => {
  Object.values(apiMocks).forEach((mock) => mock.mockReset());
  useAuthMock.mockReset();
  setRole('admin');
  apiMocks.interactions.mockResolvedValue(interactions);
  apiMocks.approvalPolicy.mockResolvedValue(policy);
  apiMocks.updateApprovalPolicy.mockResolvedValue(policy);
});

describe('ApprovalsPage', () => {
  it('shows full pending context to auditors without decision or policy editing controls', async () => {
    setRole('auditor');
    const user = userEvent.setup();
    renderApprovalsPage();

    await screen.findByText('Run database migration');
    expect(screen.getByText('一次性、超时失败关闭，桌面链保留')).toBeInTheDocument();
    expect(screen.getByText('移动端待接入')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存审批策略' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: '查看详情' })[1]!);
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('The agent needs an explicit target before continuing')).toBeInTheDocument();
    expect(within(drawer).getByText('call-question-42')).toBeInTheDocument();
    expect(within(drawer).getByText('session-release')).toBeInTheDocument();
    expect(within(drawer).getByText(/release-workspace \(ws-release\)/)).toBeInTheDocument();
    expect(within(drawer).getByText('Which environment should receive this build?')).toBeInTheDocument();
    expect(within(drawer).getByText('This choice affects only the current deployment.')).toBeInTheDocument();
    expect(within(drawer).getByText('Deploy to the isolated staging environment')).toBeInTheDocument();
    expect(within(drawer).getByText('Deploy to the production environment')).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /allow|reject|允许|拒绝|批准/i })).not.toBeInTheDocument();
    expect(apiMocks.updateApprovalPolicy).not.toHaveBeenCalled();
  });

  it('saves the real policy fields with revision and refreshes after success', async () => {
    const updatedPolicy: ApprovalPolicy = { ...policy, remoteEnabled: false, ttlSeconds: 300, revision: 8 };
    apiMocks.updateApprovalPolicy.mockResolvedValue(updatedPolicy);
    apiMocks.approvalPolicy.mockResolvedValueOnce(policy).mockResolvedValueOnce(updatedPolicy);
    const user = userEvent.setup();
    renderApprovalsPage();

    const enabled = await screen.findByRole('switch', { name: '远程审批' });
    await user.click(enabled);
    const ttl = screen.getByRole('spinbutton', { name: '审批 TTL（秒）' });
    await user.clear(ttl);
    await user.type(ttl, '300');
    await user.click(screen.getByRole('button', { name: '保存审批策略' }));

    await waitFor(() => {
      expect(apiMocks.updateApprovalPolicy).toHaveBeenCalledWith({ remoteEnabled: false, ttlSeconds: 300, revision: 7 });
    });
    await waitFor(() => {
      expect(apiMocks.approvalPolicy).toHaveBeenCalledTimes(2);
      expect(apiMocks.interactions).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByRole('switch', { name: '远程审批' })).not.toBeChecked();
  });

  it('keeps both user choices and the editor usable on a revision conflict', async () => {
    apiMocks.updateApprovalPolicy.mockRejectedValue(new ApiError(409, 'revision_conflict', 'Approval policy has changed'));
    const user = userEvent.setup();
    renderApprovalsPage();

    const enabled = await screen.findByRole('switch', { name: '远程审批' });
    await user.click(enabled);
    const ttl = screen.getByRole('spinbutton', { name: '审批 TTL（秒）' });
    await user.clear(ttl);
    await user.type(ttl, '456');
    await user.click(screen.getByRole('button', { name: '保存审批策略' }));

    await screen.findByText('审批策略版本已变化');
    expect(screen.getByRole('switch', { name: '远程审批' })).not.toBeChecked();
    expect(screen.getByRole('spinbutton', { name: '审批 TTL（秒）' })).toHaveValue('456');
    await waitFor(() => expect(screen.getByRole('button', { name: /保存审批策略/ })).toBeEnabled());
    expect(apiMocks.updateApprovalPolicy).toHaveBeenCalledWith({ remoteEnabled: false, ttlSeconds: 456, revision: 7 });
    expect(apiMocks.approvalPolicy).toHaveBeenCalledTimes(1);
    expect(apiMocks.interactions).toHaveBeenCalledTimes(1);
  });
});
