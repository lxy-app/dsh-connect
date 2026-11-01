import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Empty,
  Popconfirm,
  Result,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  CopyOutlined,
  MobileOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { QRCodeSVG } from 'qrcode.react';
import type { ColumnsType } from 'antd/es/table';
import { adminApi, ApiError } from '../api/client';
import type { AdminUser, MobileDevice, MobilePairingCode } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { formatDateTime, formatRelative } from '../utils/format';

const { Title, Text, Paragraph } = Typography;

const statusMeta: Record<string, { color: string; label: string }> = {
  active: { color: 'success', label: '有效' },
  revoked: { color: 'default', label: '已吊销' },
};

export function MobilePage() {
  const { message } = AntApp.useApp();
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [devices, setDevices] = useState<MobileDevice[]>([]);
  const [targetUserId, setTargetUserId] = useState<string | undefined>(user?.id);
  const [issued, setIssued] = useState<MobilePairingCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
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
      const activeUsers = userList.filter((candidate) => candidate.status === 'active');
      setUsers(userList);
      setDevices(deviceList);
      setTargetUserId((current) => {
        if (current && activeUsers.some((candidate) => candidate.id === current)) {
          return current;
        }
        if (user && activeUsers.some((candidate) => candidate.id === user.id)) {
          return user.id;
        }
        return activeUsers[0]?.id;
      });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '加载手机设备失败');
    } finally {
      setLoading(false);
    }
  }, [canView, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const issue = async () => {
    if (!targetUserId) {
      message.warning('请选择要配对的用户');
      return;
    }
    setIssuing(true);
    try {
      const created = await adminApi.createMobilePairingCode(targetUserId);
      setIssued(created);
      message.success('手机配对码已生成');
    } catch (cause) {
      message.error(cause instanceof ApiError ? cause.message : '生成手机配对码失败');
    } finally {
      setIssuing(false);
    }
  };

  const copy = async (value: string, success: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success(success);
    } catch {
      message.warning('复制失败，请手动选中复制');
    }
  };

  const revoke = async (target: MobileDevice) => {
    try {
      await adminApi.revokeMobileDevice(target.mobileDeviceId);
      message.success('手机凭据已吊销');
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
          description="该手机的全部 Access/Refresh Token 立即失效，需要重新配对。"
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
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 20,
          gap: 16,
        }}
      >
        <div>
          <Title level={4} style={{ marginBottom: 2 }}>
            手机设备
          </Title>
          <Text type="secondary">为指定用户生成一次性配对二维码，并管理已配对手机凭据</Text>
        </div>
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

      {canManage ? (
        <Card
          title={
            <Space>
              <MobileOutlined />
              添加手机
            </Space>
          }
          extra={
            <Space>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="选择用户"
                style={{ width: 280 }}
                value={targetUserId}
                options={users
                  .filter((candidate) => candidate.status === 'active')
                  .map((candidate) => ({
                    value: candidate.id,
                    label: `${candidate.displayName} · ${candidate.email}`,
                  }))}
                onChange={(value) => {
                  setTargetUserId(value);
                  setIssued(null);
                }}
              />
              <Button
                type="primary"
                icon={<QrcodeOutlined />}
                loading={issuing}
                disabled={!targetUserId}
                onClick={() => void issue()}
              >
                {issued ? '重新生成' : '生成二维码'}
              </Button>
            </Space>
          }
          style={{ marginBottom: 16 }}
        >
          {issued ? (
            <MobilePairingPanel issued={issued} onCopy={copy} />
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="选择用户并生成二维码后，用 DSH Connect App 扫描"
            />
          )}
        </Card>
      ) : null}

      <Card title="已配对手机">
        <Table<MobileDevice>
          rowKey="mobileDeviceId"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={devices}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty description="还没有手机完成配对" /> }}
        />
      </Card>
    </div>
  );
}

function MobilePairingPanel({
  issued,
  onCopy,
}: {
  issued: MobilePairingCode;
  onCopy: (value: string, success: string) => Promise<void>;
}) {
  const unreachable = isLoopbackServer(issued.serverUrl);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'flex-start' }}>
      <div
        style={{
          padding: 16,
          borderRadius: 12,
          border: '1px solid #e5e8f0',
          background: '#fff',
          lineHeight: 0,
        }}
      >
        <QRCodeSVG
          value={issued.pairingUrl}
          size={224}
          level="M"
          marginSize={4}
          title="DSH Connect 手机配对二维码"
        />
      </div>

      <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Alert
          type="warning"
          showIcon
          message="二维码包含一次性配对码，请只发给目标用户"
        />

        {unreachable ? (
          <Alert
            type="error"
            showIcon
            message="Server 地址手机不可达"
            description="当前返回的是回环地址或 0.0.0.0。请把 DSH_CONNECT_SERVER_URL 配置为手机可访问的局域网 IP 或 HTTPS 域名，重启 Server 后重新生成。"
          />
        ) : null}

        <div>
          <Text type="secondary">配对码（只显示一次）</Text>
          <div style={{ marginTop: 6 }}>
            <Text
              code
              style={{ fontSize: 18, letterSpacing: 1.4, padding: '6px 12px', userSelect: 'all' }}
            >
              {issued.code}
            </Text>
          </div>
        </div>

        <Space wrap>
          <Button icon={<CopyOutlined />} onClick={() => void onCopy(issued.code, '配对码已复制')}>
            复制配对码
          </Button>
          <Button icon={<CopyOutlined />} onClick={() => void onCopy(issued.pairingUrl, '配对链接已复制')}>
            复制配对链接
          </Button>
        </Space>

        <Paragraph type="secondary" style={{ margin: 0 }}>
          Server：{issued.serverUrl}
          <br />
          有效期至：{formatDateTime(issued.expiresAt)}
        </Paragraph>

        <Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>
          步骤：打开手机 DSH Connect → 连接 Server → 扫描此二维码 → 确认配对。
          App 无法打开相机时，可手动输入上方 Server 地址和配对码。
        </Paragraph>
      </div>
    </div>
  );
}

function isLoopbackServer(serverUrl: string): boolean {
  try {
    const hostname = new URL(serverUrl).hostname;
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]' || hostname === '0.0.0.0';
  } catch {
    return true;
  }
}
