import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { adminApi, ApiError } from '../api/client';
import type { AccessPolicy, AdminUser, Role, UserAccessPreview } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { formatDateTime, formatRelative, roleColors, roleLabels } from '../utils/format';

const { Title, Text } = Typography;

interface UserFormValues {
  email: string;
  displayName: string;
  password: string;
  role: Role;
}

export function UsersPage() {
  const { message } = AntApp.useApp();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [policies, setPolicies] = useState<AccessPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [previewUser, setPreviewUser] = useState<AdminUser | null>(null);
  const [preview, setPreview] = useState<UserAccessPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createForm] = Form.useForm<UserFormValues>();
  const [editForm] = Form.useForm<{ displayName: string; role: Role; password?: string }>();

  const isOwner = currentUser?.role === 'owner';
  const canManage = currentUser?.role === 'owner' || currentUser?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await adminApi.users());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '加载用户失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPolicies = useCallback(async () => {
    setPolicyLoading(true);
    setPolicyError(null);
    try {
      setPolicies(await adminApi.policies());
    } catch (cause) {
      setPolicyError(cause instanceof ApiError ? cause.message : '加载关联策略失败');
    } finally {
      setPolicyLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadPolicies();
  }, [load, loadPolicies]);

  useEffect(() => {
    if (!previewUser) return;
    const controller = new AbortController();
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);
    adminApi
      .accessPreview(previewUser.id, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setPreview(response);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setPreviewError(cause instanceof ApiError ? cause.message : '加载访问预览失败');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    return () => controller.abort();
  }, [previewUser, previewRetry]);

  const refresh = () => {
    void load();
    void loadPolicies();
  };

  const associatedPolicies = (userId: string) => policies.filter((policy) => policy.memberIds.includes(userId));

  const openCreate = () => {
    createForm.resetFields();
    createForm.setFieldsValue({ role: 'member' });
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    const values = await createForm.validateFields();
    setSubmitting(true);
    try {
      await adminApi.createUser(values);
      message.success('用户已创建');
      setCreateOpen(false);
      await load();
    } catch (cause) {
      message.error(cause instanceof ApiError ? cause.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (target: AdminUser) => {
    setEditing(target);
    editForm.setFieldsValue({ displayName: target.displayName, role: target.role, password: undefined });
  };

  const submitEdit = async () => {
    if (!editing) return;
    const values = await editForm.validateFields();
    const payload: Partial<{ displayName: string; role: Role; password: string }> = {
      displayName: values.displayName,
    };
    // Only owners may change roles; sending it as an admin would 403.
    if (isOwner) {
      payload.role = values.role;
    }
    if (values.password) {
      payload.password = values.password;
    }
    setSubmitting(true);
    try {
      await adminApi.updateUser(editing.id, payload);
      message.success('用户已更新');
      setEditing(null);
      await load();
    } catch (cause) {
      message.error(cause instanceof ApiError ? cause.message : '更新失败');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (target: AdminUser, active: boolean) => {
    try {
      await adminApi.updateUser(target.id, { status: active ? 'active' : 'disabled' });
      message.success(active ? '账号已启用' : '账号已禁用');
      await load();
    } catch (cause) {
      message.error(cause instanceof ApiError ? cause.message : '状态更新失败');
    }
  };

  const remove = async (target: AdminUser) => {
    try {
      await adminApi.deleteUser(target.id);
      message.success('用户已删除');
      await load();
    } catch (cause) {
      message.error(cause instanceof ApiError ? cause.message : '删除失败');
    }
  };

  const columns: ColumnsType<AdminUser> = [
    {
      title: '用户',
      key: 'user',
      render: (_, row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.displayName}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.email}
          </Text>
        </div>
      ),
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 110,
      render: (role: Role) => <Tag color={roleColors[role]}>{roleLabels[role] ?? role}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (status: string, row) => (
        <Space size={8}>
          <Switch
            size="small"
            checked={status === 'active'}
            disabled={!isOwner || row.id === currentUser?.id}
            onChange={(checked) => void toggleStatus(row, checked)}
          />
          <Text type={status === 'active' ? undefined : 'secondary'}>{status === 'active' ? '启用' : '禁用'}</Text>
        </Space>
      ),
    },
    {
      title: '关联策略',
      key: 'policies',
      width: 210,
      render: (_, row) => {
        if (policyLoading) return <Text type="secondary">加载中…</Text>;
        const associated = associatedPolicies(row.id);
        return associated.length ? (
          <Space size={4} wrap>
            {associated.map((policy) => (
              <Tag key={policy.policyId}>{policy.name}</Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary">未关联</Text>
        );
      },
    },
    {
      title: '策略桌面数',
      key: 'policyDesktops',
      width: 110,
      render: (_, row) => {
        const deviceIds = associatedPolicies(row.id)
          .filter((policy) => policy.enabled)
          .flatMap((policy) => policy.rules.map((rule) => rule.deviceId));
        return <Text>{new Set(deviceIds).size}</Text>;
      },
    },
    {
      title: '最近登录',
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      width: 150,
      render: (value?: string) => (
        <Text type={value ? undefined : 'secondary'} title={formatDateTime(value)}>
          {formatRelative(value)}
        </Text>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      width: 250,
      render: (_, row) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => setPreviewUser(row)}
          >
            访问预览
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            disabled={!canManage || (!isOwner && row.role === 'owner')}
            onClick={() => openEdit(row)}
          >
            编辑
          </Button>
          <Popconfirm
            title="删除该用户？"
            description="该操作会同时撤销其全部登录会话。"
            okButtonProps={{ danger: true }}
            onConfirm={() => void remove(row)}
            disabled={!isOwner || row.id === currentUser?.id}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={!isOwner || row.id === currentUser?.id}
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
            用户与角色
          </Title>
          <Text type="secondary">所有者可变更角色与状态；管理员可维护成员资料</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading || policyLoading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} disabled={!canManage} onClick={openCreate}>
            新建用户
          </Button>
        </Space>
      </div>

      {policyError ? (
        <Alert
          type="warning"
          showIcon
          title="关联策略加载失败"
          description={policyError}
          action={<Button size="small" onClick={() => void loadPolicies()}>重试</Button>}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Card>
        {error ? (
          <Empty description={error} />
        ) : (
          <Table<AdminUser>
            rowKey="id"
            size="middle"
            loading={loading}
            columns={columns}
            dataSource={users}
            pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
          />
        )}
      </Card>

      <Drawer
        open={previewUser !== null}
        title={`访问预览：${previewUser?.displayName ?? ''}`}
        size={620}
        onClose={() => setPreviewUser(null)}
        destroyOnHidden
      >
        <Text type="secondary">以下结果由 Server 按该用户当前关联策略实时计算。</Text>
        <div style={{ marginTop: 16 }}>
          {previewError ? (
            <Alert
              type="error"
              showIcon
              title="无法加载访问预览"
              description={previewError}
              action={<Button size="small" onClick={() => setPreviewRetry((value) => value + 1)}>重试</Button>}
            />
          ) : (
            <Spin spinning={previewLoading}>
              {preview ? (
                <Space orientation="vertical" size={16} style={{ width: '100%' }}>
                  <div>
                    <Text strong>命中策略</Text>
                    <div style={{ marginTop: 8 }}>
                      {preview.policyIds.length ? (
                        <Space size={4} wrap>
                          {preview.policyIds.map((policyId) => {
                            const policy = policies.find((candidate) => candidate.policyId === policyId);
                            return <Tag key={policyId}>{policy?.name ?? policyId}</Tag>;
                          })}
                        </Space>
                      ) : (
                        <Text type="secondary">无关联策略</Text>
                      )}
                    </div>
                  </div>
                  <div>
                    <Text strong>可访问桌面（{preview.desktops.length}）</Text>
                  </div>
                  {preview.desktops.length === 0 ? (
                    <Empty description="该用户当前没有可访问的桌面" />
                  ) : (
                    preview.desktops.map((desktop) => (
                      <Card
                        key={desktop.deviceId}
                        size="small"
                        title={desktop.deviceName}
                        extra={<Tag color={desktop.online ? 'green' : 'default'}>{desktop.online ? '在线' : '离线'}</Tag>}
                      >
                        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
                          <div><Text type="secondary">设备 ID：</Text><Text code>{desktop.deviceId}</Text></div>
                          <div>
                            <Text>工作区</Text>
                            <div style={{ marginTop: 6 }}>
                              {desktop.workspaces.length ? (
                                <Space orientation="vertical" size={8}>
                                  {desktop.workspaces.map((workspace) => (
                                    <Space key={workspace.id} size={4} wrap>
                                      <Tag>{workspace.name}</Tag>
                                      {workspace.scopes.map((scope) => (
                                        <Tag key={scope}>{scope}</Tag>
                                      ))}
                                    </Space>
                                  ))}
                                </Space>
                              ) : <Text type="secondary">无</Text>}
                            </div>
                          </div>
                          <div>
                            <Text>桌面权限并集</Text>
                            <div style={{ marginTop: 6 }}>
                              {desktop.scopes.length ? (
                                <Space size={4} wrap>
                                  {desktop.scopes.map((scope) => <Tag key={scope}>{scope}</Tag>)}
                                </Space>
                              ) : <Text type="secondary">无</Text>}
                            </div>
                          </div>
                        </Space>
                      </Card>
                    ))
                  )}
                </Space>
              ) : (
                <div style={{ minHeight: 180 }} />
              )}
            </Spin>
          )}
        </div>
      </Drawer>

      <Modal
        open={createOpen}
        title="新建用户"
        okText="创建"
        confirmLoading={submitting}
        onOk={() => void submitCreate()}
        onCancel={() => setCreateOpen(false)}
        destroyOnHidden
      >
        <Form<UserFormValues> form={createForm} layout="vertical" requiredMark={false}>
          <Form.Item name="email" label="邮箱" rules={[{ required: true }, { type: 'email' }]}>
            <Input placeholder="member@example.com" />
          </Form.Item>
          <Form.Item name="displayName" label="显示名称" rules={[{ required: true }]}>
            <Input placeholder="张三" />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            rules={[{ required: true, min: 8, message: '至少 8 位' }]}
            extra="至少 8 位，创建后应尽快让成员自行修改"
          >
            <Input.Password placeholder="••••••••" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'member', label: '成员' },
                { value: 'auditor', label: '审计员' },
                { value: 'admin', label: '管理员' },
                ...(isOwner ? [{ value: 'owner', label: '所有者' }] : []),
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={editing !== null}
        title={`编辑 ${editing?.displayName ?? ''}`}
        okText="保存"
        confirmLoading={submitting}
        onOk={() => void submitEdit()}
        onCancel={() => setEditing(null)}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" requiredMark={false}>
          <Form.Item name="displayName" label="显示名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true }]}
            extra={isOwner ? '最后一位所有者不能被降级' : '仅所有者可变更角色'}
          >
            <Select
              disabled={!isOwner}
              options={[
                { value: 'member', label: '成员' },
                { value: 'auditor', label: '审计员' },
                { value: 'admin', label: '管理员' },
                { value: 'owner', label: '所有者' },
              ]}
            />
          </Form.Item>
          <Form.Item name="password" label="重置密码" rules={[{ min: 8, message: '至少 8 位' }]} extra="留空则不修改">
            <Input.Password placeholder="••••••••" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}