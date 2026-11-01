import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Empty,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { CopyOutlined, KeyOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { adminApi, ApiError } from '../api/client';
import type { PairingCode, PairingCodeState } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { formatDateTime } from '../utils/format';

const { Title, Text, Paragraph } = Typography;

const stateMeta: Record<string, { color: string; label: string }> = {
  active: { color: 'processing', label: '待使用' },
  waiting_desktop_authorization: { color: 'warning', label: '等待桌面授权' },
  used: { color: 'success', label: '配对完成' },
  expired: { color: 'default', label: '已过期' },
};

export function PairingPage() {
  const { message } = AntApp.useApp();
  const { user } = useAuth();
  const [created, setCreated] = useState<PairingCode | null>(null);
  const [codes, setCodes] = useState<PairingCodeState[]>([]);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canIssue = user?.role === 'owner' || user?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCodes(await adminApi.pairingCodes());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '加载配对码失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const issue = async () => {
    setIssuing(true);
    try {
      const issued = await adminApi.createPairingCode();
      setCreated(issued);
      await load();
    } catch (cause) {
      message.error(cause instanceof ApiError ? cause.message : '生成配对码失败');
    } finally {
      setIssuing(false);
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success('已复制到剪贴板');
    } catch {
      message.warning('复制失败，请手动选中复制');
    }
  };

  const columns: ColumnsType<PairingCodeState> = [
    {
      title: '状态',
      dataIndex: 'state',
      key: 'state',
      width: 110,
      render: (state: string) => {
        const meta = stateMeta[state] ?? { color: 'default', label: state };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 190,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '过期时间',
      dataIndex: 'expiresAt',
      key: 'expiresAt',
      width: 190,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '使用设备',
      dataIndex: 'deviceId',
      key: 'deviceId',
      render: (value?: string) =>
        value ? (
          <Text copyable={{ text: value }} style={{ fontSize: 12 }}>
            {value}
          </Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
        <div>
          <Title level={4} style={{ marginBottom: 2 }}>
            桌面配对
          </Title>
          <Text type="secondary">生成一次性配对码，在 DSH 桌面的 Connector 面板中粘贴以完成接入</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
            刷新
          </Button>
          <Popconfirm
            title="生成新的配对码？"
            description="配对码 10 分钟内有效，且只能被使用一次。"
            onConfirm={() => void issue()}
            disabled={!canIssue}
          >
            <Button type="primary" icon={<KeyOutlined />} loading={issuing} disabled={!canIssue}>
              生成配对码
            </Button>
          </Popconfirm>
        </Space>
      </div>

      {created ? (
        <Card
          style={{ marginBottom: 16, borderColor: '#4f6ef7' }}
          title="配对码已生成"
          extra={
            <Button size="small" type="link" onClick={() => setCreated(null)}>
              收起
            </Button>
          }
        >
          <Paragraph type="secondary" style={{ marginBottom: 12 }}>
            此码只显示一次，关闭后无法再次查看。请在 {formatDateTime(created.expiresAt)} 前于桌面端使用。
          </Paragraph>
          <Space size={12} wrap>
            <Text
              code
              style={{ fontSize: 22, letterSpacing: 2, padding: '8px 14px', userSelect: 'all' }}
            >
              {created.code}
            </Text>
            <Button icon={<CopyOutlined />} onClick={() => void copy(created.code)}>
              复制
            </Button>
          </Space>
          <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
            服务器地址：{created.serverUrl}
          </Paragraph>
        </Card>
      ) : null}

      <Card title="最近配对码">
        {error ? (
          <Alert type="error" showIcon message="无法加载配对码" description={error} />
        ) : (
          <Table<PairingCodeState>
            rowKey={(row) => `${row.createdAt}-${row.deviceId ?? 'unused'}`}
            size="middle"
            loading={loading}
            columns={columns}
            dataSource={codes}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            locale={{ emptyText: <Empty description="还没有生成过配对码" /> }}
          />
        )}
      </Card>
    </div>
  );
}