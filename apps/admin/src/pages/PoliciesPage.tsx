import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Drawer,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { adminApi, ApiError } from '../api/client';
import type { AccessPolicy, AccessPolicyInput, AccessPolicyRule, AdminUser, Device } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { formatDateTime } from '../utils/format';

const { Title, Text } = Typography;

const SCOPE_OPTIONS = ['read', 'prompt', 'cancel', 'approve'];

interface DraftRule extends AccessPolicyRule {
  key: string;
}

interface PolicyDraft {
  name: string;
  description: string;
  enabled: boolean;
  memberIds: string[];
  rules: DraftRule[];
}

interface EditorState {
  policy: AccessPolicy | null;
  draft: PolicyDraft;
  original: string;
}

function comparableDraft(draft: PolicyDraft): AccessPolicyInput {
  return {
    name: draft.name,
    description: draft.description,
    enabled: draft.enabled,
    memberIds: draft.memberIds,
    rules: draft.rules.map(({ deviceId, workspaceIds, scopes }) => ({ deviceId, workspaceIds, scopes })),
  };
}

function isRevisionConflict(cause: unknown): boolean {
  if (!(cause instanceof ApiError)) return false;
  const code = cause.code.toLowerCase();
  const text = cause.message.toLowerCase();
  return code.includes('revision') || text.includes('revision');
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback;
}

export function PoliciesPage() {
  const { message, modal } = AntApp.useApp();
  const { user } = useAuth();
  const [policies, setPolicies] = useState<AccessPolicy[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const ruleKey = useRef(0);

  const canManage = user?.role === 'owner' || user?.role === 'admin';
  const editorDirty = editor ? JSON.stringify(comparableDraft(editor.draft)) !== editor.original : false;

  const nextRule = useCallback((rule?: AccessPolicyRule): DraftRule => {
    ruleKey.current += 1;
    const device = devices.find((candidate) => candidate.deviceId === rule?.deviceId);
    return {
      key: `rule-${ruleKey.current}`,
      deviceId: rule?.deviceId ?? '',
      workspaceIds: rule?.workspaceIds ?? [],
      scopes: (rule?.scopes ?? []).filter((scope) => device?.scopes.includes(scope)),
    };
  }, [devices]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [policyList, userList, deviceList] = await Promise.all([
        adminApi.policies(),
        adminApi.users(),
        adminApi.devices(),
      ]);
      setPolicies(policyList);
      setUsers(userList);
      setDevices(deviceList);
    } catch (cause) {
      setError(errorMessage(cause, '加载访问策略失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!editorDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [editorDirty]);

  const confirmDiscard = useCallback(
    (action: () => void) => {
      if (!editorDirty) {
        action();
        return;
      }
      modal.confirm({
        title: '放弃未保存的修改？',
        content: '当前策略有未保存的修改，切换或关闭后这些修改将丢失。',
        okText: '放弃修改',
        okButtonProps: { danger: true },
        cancelText: '继续编辑',
        onOk: action,
      });
    },
    [editorDirty, modal],
  );

  const openEditor = (policy: AccessPolicy | null) => {
    confirmDiscard(() => {
      const draft: PolicyDraft = policy
        ? {
            name: policy.name,
            description: policy.description,
            enabled: policy.enabled,
            memberIds: [...policy.memberIds],
            rules: policy.rules.map((rule) => nextRule(rule)),
          }
        : { name: '', description: '', enabled: true, memberIds: [], rules: [] };
      setConflict(null);
      setEditor({ policy, draft, original: JSON.stringify(comparableDraft(draft)) });
    });
  };

  const closeEditor = () => {
    confirmDiscard(() => {
      setConflict(null);
      setEditor(null);
    });
  };

  const updateDraft = (patch: Partial<PolicyDraft>) => {
    setEditor((current) => (current ? { ...current, draft: { ...current.draft, ...patch } } : current));
  };

  const updateRule = (key: string, patch: Partial<DraftRule>) => {
    setEditor((current) =>
      current
        ? {
            ...current,
            draft: {
              ...current.draft,
              rules: current.draft.rules.map((rule) => (rule.key === key ? { ...rule, ...patch } : rule)),
            },
          }
        : current,
    );
  };

  const save = async () => {
    if (!editor || !canManage) return;
    const name = editor.draft.name.trim();
    if (!name) {
      message.warning('请输入策略名称');
      return;
    }
    if (editor.draft.rules.some((rule) => !rule.deviceId)) {
      message.warning('请为每条规则选择桌面');
      return;
    }
    if (editor.draft.rules.some((rule) => rule.workspaceIds.length === 0)) {
      message.warning('请为每条规则选择至少一个工作区，或删除空规则');
      return;
    }
    if (editor.draft.rules.some((rule) => rule.scopes.length === 0)) {
      message.warning('请为每条规则选择至少一个操作权限，或删除空规则');
      return;
    }
    const deviceIds = editor.draft.rules.map((rule) => rule.deviceId);
    if (new Set(deviceIds).size !== deviceIds.length) {
      message.warning('同一桌面只需配置一条规则，请合并后再保存');
      return;
    }

    const input: AccessPolicyInput = {
      ...comparableDraft(editor.draft),
      name,
      description: editor.draft.description.trim(),
    };
    setSubmitting(true);
    setConflict(null);
    try {
      if (editor.policy) {
        await adminApi.updatePolicy(editor.policy.policyId, { ...input, revision: editor.policy.revision });
      } else {
        await adminApi.createPolicy(input);
      }
      message.success(editor.policy ? '访问策略已更新' : '访问策略已创建');
      setEditor(null);
      await load();
    } catch (cause) {
      if (isRevisionConflict(cause)) {
        const text = '该策略已被其他管理员修改。请关闭编辑器后重新打开，基于最新 revision 再保存。';
        setConflict(text);
        message.error('保存失败：策略 revision 已冲突');
      } else {
        message.error(errorMessage(cause, editor.policy ? '更新访问策略失败' : '创建访问策略失败'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = async (policy: AccessPolicy, enabled: boolean) => {
    setActionId(policy.policyId);
    try {
      await adminApi.updatePolicy(policy.policyId, {
        name: policy.name,
        description: policy.description,
        enabled,
        memberIds: policy.memberIds,
        rules: policy.rules,
        revision: policy.revision,
      });
      message.success(enabled ? '策略已启用' : '策略已停用');
      await load();
    } catch (cause) {
      message.error(
        isRevisionConflict(cause) ? '策略 revision 已冲突，请刷新后重试' : errorMessage(cause, '更新策略状态失败'),
      );
      if (isRevisionConflict(cause)) await load();
    } finally {
      setActionId(null);
    }
  };

  const remove = async (policy: AccessPolicy) => {
    setActionId(policy.policyId);
    try {
      await adminApi.deletePolicy(policy.policyId, policy.revision);
      message.success('访问策略已删除');
      await load();
    } catch (cause) {
      message.error(
        isRevisionConflict(cause) ? '删除失败：策略 revision 已冲突，请刷新后重试' : errorMessage(cause, '删除访问策略失败'),
      );
      if (isRevisionConflict(cause)) await load();
    } finally {
      setActionId(null);
    }
  };

  const userName = (userId: string) => users.find((candidate) => candidate.id === userId)?.displayName ?? userId;
  const deviceName = (deviceId: string) => devices.find((candidate) => candidate.deviceId === deviceId)?.deviceName ?? deviceId;

  const columns: ColumnsType<AccessPolicy> = [
    {
      title: '策略',
      key: 'policy',
      render: (_, policy) => (
        <div>
          <div style={{ fontWeight: 600 }}>{policy.name}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {policy.description || '无描述'}
          </Text>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 120,
      render: (enabled: boolean, policy) => (
        <Space size={8}>
          <Switch
            size="small"
            checked={enabled}
            disabled={!canManage || actionId === policy.policyId}
            onChange={(checked) => void toggle(policy, checked)}
            aria-label={`${enabled ? '停用' : '启用'}策略 ${policy.name}`}
          />
          <Text type={enabled ? undefined : 'secondary'}>{enabled ? '启用' : '停用'}</Text>
        </Space>
      ),
    },
    {
      title: '关联成员',
      dataIndex: 'memberIds',
      key: 'memberIds',
      width: 210,
      render: (memberIds: string[]) =>
        memberIds.length ? (
          <Space size={4} wrap>
            {memberIds.map((memberId) => <Tag key={memberId}>{userName(memberId)}</Tag>)}
          </Space>
        ) : (
          <Text type="secondary">未关联</Text>
        ),
    },
    {
      title: '桌面 / 规则',
      key: 'rules',
      width: 120,
      render: (_, policy) => `${new Set(policy.rules.map((rule) => rule.deviceId)).size} / ${policy.rules.length}`,
    },
    {
      title: 'revision',
      dataIndex: 'revision',
      key: 'revision',
      width: 100,
      render: (revision: number) => <Text code>{revision}</Text>,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 180,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_, policy) => (
        <Space size={2}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditor(policy)}
          >
            {canManage ? '编辑' : '查看'}
          </Button>
          <Popconfirm
            title={`删除策略“${policy.name}”？`}
            description="删除后，该策略不再参与任何用户的有效权限计算。"
            okText="删除"
            okButtonProps={{ danger: true }}
            onConfirm={() => void remove(policy)}
            disabled={!canManage || actionId === policy.policyId}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={!canManage || actionId === policy.policyId}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
        <div>
          <Title level={4} style={{ marginBottom: 2 }}>
            访问策略
          </Title>
          <Text type="secondary">按成员、桌面、工作区与操作 scopes 配置访问边界；保存时使用 revision 防止覆盖并发修改</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} disabled={!canManage} onClick={() => openEditor(null)}>
            新建策略
          </Button>
        </Space>
      </div>

      <Card>
        {error ? (
          <Empty description={error}>
            <Button onClick={() => void load()}>重试</Button>
          </Empty>
        ) : (
          <Table<AccessPolicy>
            rowKey="policyId"
            size="middle"
            loading={loading}
            columns={columns}
            dataSource={policies}
            scroll={{ x: 1160 }}
            pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
            locale={{ emptyText: <Empty description="暂无访问策略，请新建策略以授权成员访问桌面" /> }}
          />
        )}
      </Card>

      <Drawer
        open={editor !== null}
        title={editor?.policy ? `${canManage ? '编辑' : '查看'}访问策略` : '新建访问策略'}
        size={720}
        maskClosable={false}
        onClose={closeEditor}
        destroyOnHidden
        footer={
          editor ? (
            <div style={{ textAlign: 'right' }}>
              <Space>
                <Button onClick={closeEditor}>{canManage ? '取消' : '关闭'}</Button>
                {canManage ? (
                  <Button type="primary" loading={submitting} onClick={() => void save()}>
                    保存策略
                  </Button>
                ) : null}
              </Space>
            </div>
          ) : null
        }
      >
        {editor ? (
          <Space orientation="vertical" size={20} style={{ width: '100%' }}>
            {!canManage ? <Alert type="info" showIcon title="Auditor 仅可查看策略，不能修改或删除。" /> : null}
            {conflict ? <Alert type="warning" showIcon title="策略版本已变化" description={conflict} /> : null}
            {editor.policy ? (
              <Text type="secondary">
                策略 ID：<Text code>{editor.policy.policyId}</Text>，当前 revision：{editor.policy.revision}
              </Text>
            ) : null}

            <div>
              <label htmlFor="policy-name"><Text strong>策略名称</Text></label>
              <Input
                id="policy-name"
                aria-label="策略名称"
                value={editor.draft.name}
                disabled={!canManage}
                maxLength={128}
                placeholder="例如：研发成员日常访问"
                onChange={(event) => updateDraft({ name: event.target.value })}
                style={{ marginTop: 8 }}
              />
            </div>
            <div>
              <label htmlFor="policy-description"><Text strong>描述</Text></label>
              <Input.TextArea
                id="policy-description"
                aria-label="策略描述"
                value={editor.draft.description}
                disabled={!canManage}
                rows={2}
                maxLength={512}
                placeholder="说明策略适用对象和访问范围"
                onChange={(event) => updateDraft({ description: event.target.value })}
                style={{ marginTop: 8 }}
              />
            </div>
            <Space>
              <Switch
                checked={editor.draft.enabled}
                disabled={!canManage}
                onChange={(enabled) => updateDraft({ enabled })}
                aria-label="策略启用状态"
              />
              <Text>{editor.draft.enabled ? '启用后立即参与权限计算' : '停用后不再授予访问权限'}</Text>
            </Space>
            <div>
              <Text strong>关联成员</Text>
              <Select
                mode="multiple"
                aria-label="关联成员"
                value={editor.draft.memberIds}
                disabled={!canManage}
                options={users.map((candidate) => ({
                  value: candidate.id,
                  label: `${candidate.displayName} (${candidate.email})`,
                }))}
                placeholder="选择一个或多个用户"
                optionFilterProp="label"
                showSearch
                onChange={(memberIds) => updateDraft({ memberIds })}
                style={{ width: '100%', marginTop: 8 }}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <Text strong>桌面访问规则</Text>
                  <div><Text type="secondary">每条规则对应一个桌面，可分别限制工作区和操作权限。</Text></div>
                </div>
                <Button
                  icon={<PlusOutlined />}
                  disabled={!canManage}
                  onClick={() => updateDraft({ rules: [...editor.draft.rules, nextRule()] })}
                >
                  添加规则
                </Button>
              </div>
              {editor.draft.rules.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未配置桌面规则" />
              ) : (
                <Space orientation="vertical" size={12} style={{ width: '100%' }}>
                  {editor.draft.rules.map((rule, index) => {
                    const device = devices.find((candidate) => candidate.deviceId === rule.deviceId);
                    const availableScopes = SCOPE_OPTIONS.filter((scope) => device?.scopes.includes(scope));
                    return (
                      <Card
                        key={rule.key}
                        size="small"
                        title={`规则 ${index + 1}`}
                        extra={canManage ? (
                          <Button
                            type="text"
                            size="small"
                            danger
                            onClick={() => updateDraft({ rules: editor.draft.rules.filter((item) => item.key !== rule.key) })}
                          >
                            删除规则
                          </Button>
                        ) : null}
                      >
                        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
                          <div>
                            <Text>桌面</Text>
                            <Select
                              aria-label={`规则 ${index + 1} 桌面`}
                              value={rule.deviceId || undefined}
                              disabled={!canManage}
                              options={devices.map((candidate) => ({
                                value: candidate.deviceId,
                                label: `${candidate.deviceName} (${candidate.deviceId})`,
                                disabled: editor.draft.rules.some(
                                  (item) => item.key !== rule.key && item.deviceId === candidate.deviceId,
                                ),
                              }))}
                              placeholder="选择桌面"
                              showSearch
                              optionFilterProp="label"
                              onChange={(deviceId) => updateRule(rule.key, { deviceId, workspaceIds: [], scopes: [] })}
                              style={{ width: '100%', marginTop: 6 }}
                            />
                          </div>
                          <div>
                            <Text>工作区</Text>
                            <Select
                              mode="multiple"
                              aria-label={`规则 ${index + 1} 工作区`}
                              value={rule.workspaceIds}
                              disabled={!canManage || !rule.deviceId}
                              options={(device?.workspaces ?? []).map((workspace) => ({
                                value: workspace.id,
                                label: `${workspace.name} (${workspace.path})`,
                              }))}
                              placeholder={rule.deviceId ? '选择允许访问的工作区' : '请先选择桌面'}
                              onChange={(workspaceIds) => updateRule(rule.key, { workspaceIds })}
                              style={{ width: '100%', marginTop: 6 }}
                            />
                          </div>
                          <div>
                            <Text>操作权限</Text>
                            <div style={{ marginTop: 6 }}>
                              <Checkbox.Group
                                aria-label={`规则 ${index + 1} 操作权限`}
                                options={availableScopes}
                                value={rule.scopes}
                                disabled={!canManage || !rule.deviceId}
                                onChange={(values) => updateRule(rule.key, { scopes: values.map(String) })}
                              />
                            </div>
                            {!canManage && rule.deviceId ? (
                              <div style={{ marginTop: 8 }}><Text type="secondary">当前桌面：{deviceName(rule.deviceId)}</Text></div>
                            ) : null}
                          </div>
                        </Space>
                      </Card>
                    );
                  })}
                </Space>
              )}
            </div>
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
