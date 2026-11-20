import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Empty,
  Popconfirm,
  Result,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ReloadOutlined, StopOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { adminApi, ApiError } from '../api/client';
import type { AdminUser, MobileDevice } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { formatRelative } from '../utils/format';

const { Text } = Typography;

const statusMeta: Record<string, { color: string; label: string }> = {
  active: { color: 'success', label: '有效' },
  revoked: { color: 'default', label: '已吊销' },
};

export function MobileDevicesPanel() {
  const { message } = AntApp.useApp();
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [devices, setDevices] = useState<MobileDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canManage = user?.role === 'owner' || user?.role === 'admin';
  const canView = canManage || user?.role === 'auditor';

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [userList, deviceList] = await Promise.all([adminApi.users(), adminApi.mobileDevices()]);
      setUsers(userList);
      setDevices(deviceList);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '加载手机设备失败');
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (target: MobileDevice) => {
    try {
      await adminApi.revokeMobileDevice(target.mobileDeviceId);
      message.success('手机登录凭据已吊销');
      await load();
    } catch (cause) {
      message.error(cause instanceof ApiError ? cause.message : '吊销失败');
    }
  };

  const columns: ColumnsType<MobileDevice> = [
    {
      title: '手机',
      key: 'device',
      render: (_, row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.deviceName}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.mobileDeviceId}
          </Text>
        </div>
      ),
    },
    {
      title: '所属用户',
      dataIndex: 'userId',
      key: 'userId',
      render: (userId: string) => {
        const owner = users.find((candidate) => candidate.id === userId);
        return owner ? (
          <div>
            <div>{owner.displayName}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {owner.email}
            </Text>
          </div>
        ) : (
          <Text code>{userId}</Text>
        );
      },
    },
    {
      title: '平台',
      dataIndex: 'platform',
      key: 'platform',
      width: 100,
      render: (platform: MobileDevice['platform']) => (
        <Tag color={platform === 'ios' ? 'geekblue' : 'green'}>
          {platform === 'ios' ? 'iOS' : 'Android'}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const meta = statusMeta[status] ?? { color: 'default', label: status };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: 'App',
      dataIndex: 'appVersion',
      key: 'appVersion',
      width: 100,
      render: (version: string) => <Text type="secondary">{version}</Text>,
    },
    {
      title: '最近在线',
      dataIndex: 'lastSeenAt',
      key: 'lastSeenAt',
      width: 140,
      render: (value?: string) => (
        <Text type={value ? undefined : 'secondary'}>{formatRelative(value)}</Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 110,
      render: (_, row) => (
        <Popconfirm
          title="吊销这台手机？"
          description="该手机的全部 Access/Refresh Token 立即失效，需要重新登录。"
          okButtonProps={{ danger: true }}
          onConfirm={() => void revoke(row)}
          disabled={!canManage || row.status === 'revoked'}
        >
          <Button
            type="link"
            size="small"
            danger
            icon={<StopOutlined />}
            disabled={!canManage || row.status === 'revoked'}
          >
            吊销
          </Button>
        </Popconfirm>
      ),
    },
  ];

  if (!canView) {
    return (
      <Result
        status="403"
        title="没有手机设备管理权限"
        subTitle="手机设备管理仅对所有者、管理员和审计员开放。"
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 16 }}>
        <Text type="secondary">管理手机登录设备；访问权限由用户访问策略与桌面开放范围共同决定</Text>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      </div>

      {error ? (
        <Alert
          type="error"
          showIcon
          message="无法加载手机设备"
          description={error}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Card title="登录设备">
        <Table<MobileDevice>
          rowKey="mobileDeviceId"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={devices}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty description="还没有手机登录设备" /> }}
        />
      </Card>
    </div>
  );
}
