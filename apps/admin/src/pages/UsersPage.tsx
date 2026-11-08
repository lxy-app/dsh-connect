import { useCallback, useEffect, useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
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
import type { AdminUser, Role } from '../api/client';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    void load();
  }, [load]);

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
      width: 150,
      render: (_, row) => (
        <Space size={4}>
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
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} disabled={!canManage} onClick={openCreate}>
            新建用户
          </Button>
        </Space>
      </div>

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