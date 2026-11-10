import { useCallback, useEffect, useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, KeyOutlined, PlusOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import { adminApi, ApiError } from '../api/client';
import type { Device } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { deviceStatusMeta, formatDateTime, formatRelative } from '../utils/format';
import { MobileDevicesPanel } from './MobilePage';
import { DesktopPairingWizard, PairingHistoryPanel } from './PairingPage';

const { Title, Text } = Typography;

export function DevicesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const activeTab = searchParams.get('tab') === 'mobile' ? 'mobile' : 'desktop';
  const handlePaired = useCallback(() => setRefreshKey((value) => value + 1), []);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ marginBottom: 2 }}>
          设备管理
        </Title>
        <Text type="secondary">桌面 Connector 与手机设备分别授权、独立配对和吊销</Text>
      </div>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setSearchParams(key === 'mobile' ? { tab: 'mobile' } : {}, { replace: true })}
        items={[
          { key: 'desktop', label: '桌面 Connector' },
          { key: 'mobile', label: '手机设备' },
        ]}
      />
      {activeTab === 'mobile' ? (
        <MobileDevicesPanel />
      ) : (
        <DesktopDevicesPanel refreshKey={refreshKey} onAddDesktop={() => setWizardOpen(true)} />
      )}
      <DesktopPairingWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onPaired={handlePaired}
      />
    </div>
  );
}

interface DesktopDevicesPanelProps {
  refreshKey: number;
  onAddDesktop: () => void;
}

function DesktopDevicesPanel({ refreshKey, onAddDesktop }: DesktopDevicesPanelProps) {
  const { message } = AntApp.useApp();
  const { user } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Device | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [detail, setDetail] = useState<Device | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canManage = user?.role === 'owner' || user?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDevices(await adminApi.devices());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '加载设备失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const revoke = async (target: Device) => {
    try {
      await adminApi.revokeDevice(target.deviceId);
      message.success('设备已吊销，Connector 凭据已失效');
      await load();
    } catch (cause) {
      message.error(cause instanceof ApiError ? cause.message : '吊销失败');
    }
  };

  const remove = async (target: Device) => {
    try {
      await adminApi.deleteDevice(target.deviceId);
      message.success('设备已删除');
      await load();
    } catch (cause) {
      message.error(cause instanceof ApiError ? cause.message : '删除失败');
    }
  };

  const submitRename = async () => {
    if (!renaming || !renameValue.trim()) return;
    setSubmitting(true);
    try {
      await adminApi.renameDevice(renaming.deviceId, renameValue.trim());
      message.success('设备名称已更新');
      setRenaming(null);
      await load();
    } catch (cause) {
      message.error(cause instanceof ApiError ? cause.message : '重命名失败');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnsType<Device> = [
    {
      title: '设备',
      key: 'device',
      render: (_, row) => (
        <div>
          <Button type="link" style={{ padding: 0, fontWeight: 600 }} onClick={() => setDetail(row)}>
            {row.deviceName}
          </Button>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {row.deviceId}
            </Text>
          </div>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (status: string) => {
        const meta = deviceStatusMeta(status);
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: 'Connector',
      dataIndex: 'connectorVersion',
      key: 'connectorVersion',
      width: 120,
      render: (value: string) => <Tag>{value || '未知'}</Tag>,
    },
    {
      title: '工作区',
      dataIndex: 'workspaces',
      key: 'workspaces',
      width: 110,
      render: (workspaces: Device['workspaces']) => `${workspaces?.length ?? 0} 个`,
    },
    {
      title: '权限',
      dataIndex: 'scopes',
      key: 'scopes',
      width: 160,
      render: (scopes: string[]) => (
        <Space size={4} wrap>
          {(scopes ?? []).map((scope) => (
            <Tag key={scope}>
              {scope}
            </Tag>
          ))}
          {(scopes ?? []).length === 0 ? <Text type="secondary">—</Text> : null}
        </Space>
      ),
    },
    {
      title: '最近在线',
      dataIndex: 'lastSeenAt',
      key: 'lastSeenAt',
      width: 140,
      render: (value?: string) => (
        <Tooltip title={formatDateTime(value)}>
          <Text type={value ? undefined : 'secondary'}>{formatRelative(value)}</Text>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, row) => (
        <Space size={2}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            disabled={!canManage}
            onClick={() => {
              setRenaming(row);
              setRenameValue(row.deviceName);
            }}
          >
            改名
          </Button>
          <Popconfirm
            title="吊销该设备？"
            description="设备凭据立即失效，正在连接的 Connector 会被断开，需要重新配对。"
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
          <Popconfirm
            title="删除该设备记录？"
            description="删除后设备的授权与历史身份一并移除。"
            okButtonProps={{ danger: true }}
            onConfirm={() => void remove(row)}
            disabled={!canManage}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} disabled={!canManage} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 16 }}>
        <Text type="secondary">已配对的桌面、授权工作区与在线状态</Text>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} disabled={!canManage} onClick={onAddDesktop}>
            添加桌面
          </Button>
        </Space>
      </div>

      <Card>
        {error ? (
          <Empty description={error} />
        ) : (
          <Table<Device>
            rowKey="deviceId"
            size="middle"
            loading={loading}
            columns={columns}
            dataSource={devices}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            locale={{ emptyText: <Empty description="还没有桌面完成配对" /> }}
          />
        )}
      </Card>
      <PairingHistoryPanel refreshKey={refreshKey} />

      {/* Device detail: grants, fingerprint and presence in one place. */}
      <Modal
        open={detail !== null}
        title={detail?.deviceName}
        footer={null}
        onCancel={() => setDetail(null)}
        width={640}
        destroyOnHidden
      >
        {detail ? (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="设备 ID">{detail.deviceId}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={deviceStatusMeta(detail.status).color}>{deviceStatusMeta(detail.status).label}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="指纹">
              <Text code>{detail.fingerprint}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Connector 版本">{detail.connectorVersion}</Descriptions.Item>
            <Descriptions.Item label="凭据">
              {detail.hasToken ? (
                <Tag color="green" icon={<KeyOutlined />}>
                  已签发
                </Tag>
              ) : (
                <Tag>未签发</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="授权权限">
              {(detail.scopes ?? []).length > 0 ? detail.scopes.join(', ') : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="授权工作区">
              {(detail.workspaces ?? []).length === 0 ? (
                <Text type="secondary">无</Text>
              ) : (
                <Space direction="vertical" size={2}>
                  {detail.workspaces.map((workspace) => (
                    <span key={workspace.id}>
                      <Text strong>{workspace.name}</Text>{' '}
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {workspace.path}
                      </Text>
                    </span>
                  ))}
                </Space>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">{formatDateTime(detail.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="最近在线">{formatDateTime(detail.lastSeenAt)}</Descriptions.Item>
          </Descriptions>
        ) : null}
      </Modal>

      <Modal
        open={renaming !== null}
        title="重命名设备"
        okText="保存"
        confirmLoading={submitting}
        onOk={() => void submitRename()}
        onCancel={() => setRenaming(null)}
        destroyOnHidden
      >
        <Input
          value={renameValue}
          maxLength={256}
          placeholder="例如：李伟的 MacBook Pro"
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={() => void submitRename()}
        />
      </Modal>
    </div>
  );
}