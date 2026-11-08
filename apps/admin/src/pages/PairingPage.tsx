import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Empty,
  Modal,
  Space,
  Spin,
  Steps,
  Table,
  Tag,
  Typography,
} from 'antd';
import { CopyOutlined, KeyOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { adminApi, ApiError } from '../api/client';
import type { PairingCode, PairingCodeState } from '../api/client';
import { formatDateTime } from '../utils/format';

const { Text, Paragraph } = Typography;

const stateMeta: Record<string, { color: string; label: string }> = {
  active: { color: 'processing', label: '待使用' },
  waiting_desktop_authorization: { color: 'warning', label: '等待桌面授权' },
  used: { color: 'success', label: '配对完成' },
  expired: { color: 'default', label: '已过期' },
};

interface DesktopPairingWizardProps {
  open: boolean;
  onClose: () => void;
  onPaired: () => void;
}

export function DesktopPairingWizard({ open, onClose, onPaired }: DesktopPairingWizardProps) {
  const { message } = AntApp.useApp();
  const [created, setCreated] = useState<PairingCode | null>(null);
  const [current, setCurrent] = useState<PairingCodeState | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notified = useRef<number | null>(null);
  const openRef = useRef(open);
  const issueSerial = useRef(0);

  useEffect(() => {
    openRef.current = open;
    return () => {
      openRef.current = false;
    };
  }, [open]);

  const close = () => {
    issueSerial.current += 1;
    openRef.current = false;
    // A plaintext pairing code is usable only in this open wizard. Closing it
    // discards the local copy; the server still retains only its hash.
    setCreated(null);
    setCurrent(null);
    setError(null);
    setIssuing(false);
    notified.current = null;
    onClose();
  };

  const issue = async () => {
    const serial = issueSerial.current + 1;
    issueSerial.current = serial;
    setIssuing(true);
    setError(null);
    try {
      const issued = await adminApi.createPairingCode();
      if (!openRef.current || serial !== issueSerial.current) return;
      notified.current = null;
      setCurrent(null);
      setCreated(issued);
    } catch (cause) {
      if (openRef.current && serial === issueSerial.current) {
        message.error(cause instanceof ApiError ? cause.message : '生成配对码失败');
      }
    } finally {
      if (serial === issueSerial.current) setIssuing(false);
    }
  };

  useEffect(() => {
    if (!open || !created) return;
    let disposed = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const codes = await adminApi.pairingCodes();
        if (disposed) return;
        const next = codes.find((candidate) => candidate.pairingId === created.pairingId);
        if (!next) {
          setError('尚未查询到这次配对记录，将继续重试');
          return;
        }
        setCurrent(next);
        setError(null);
        if (next.state === 'used' || next.state === 'expired') {
          window.clearInterval(timer);
        }
        if (next.state === 'used' && notified.current !== next.pairingId) {
          notified.current = next.pairingId;
          onPaired();
        }
      } catch (cause) {
        if (!disposed) {
          setError(cause instanceof ApiError ? cause.message : '读取配对状态失败，将继续重试');
        }
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 2000);
    void poll();
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [created, onPaired, open]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success('已复制到剪贴板');
    } catch {
      message.warning('复制失败，请手动选中复制');
    }
  };

  const state = current?.state;
  const step = !created ? 0 : state === 'waiting_desktop_authorization' ? 2 : state === 'used' ? 3 : 1;
  const terminal = state === 'used' || state === 'expired';

  return (
    <Modal
      open={open}
      title="添加 DSH 桌面"
      width={760}
      onCancel={close}
      destroyOnHidden
      footer={<Button onClick={close}>关闭</Button>}
    >
      <Steps
        current={step}
        status={state === 'expired' ? 'error' : state === 'used' ? 'finish' : 'process'}
        items={[
          { title: '生成配对码' },
          { title: '等待 Connector' },
          { title: '桌面确认' },
          { title: '设备上线' },
        ]}
        style={{ marginBottom: 24 }}
      />

      {error ? <Alert type="error" showIcon title="配对状态读取异常" description={error} style={{ marginBottom: 16 }} /> : null}

      {!created || state === 'expired' ? (
        <div style={{ textAlign: 'center', padding: '12px 0 20px' }}>
          <Paragraph type="secondary">
            {state === 'expired'
              ? '这次配对码已过期，旧码不能继续使用。请重新生成并在桌面 Connector 中使用新码。'
              : '生成一个 10 分钟内有效、只能使用一次的配对码，然后在桌面 Connector 面板中输入。'}
          </Paragraph>
          <Button type="primary" icon={<KeyOutlined />} loading={issuing} onClick={() => void issue()}>
            {state === 'expired' ? '重新生成配对码' : '生成配对码'}
          </Button>
        </div>
      ) : null}

      {created && state !== 'used' ? (
        <Card title="一次性配对信息" style={{ marginBottom: 16 }}>
          <Paragraph type="secondary">
            明文只保留在当前向导中，关闭后无法回读。请在 {formatDateTime(created.expiresAt)} 前使用。
          </Paragraph>
          <Space size={12} wrap>
            <Text code style={{ fontSize: 22, letterSpacing: 2, padding: '8px 14px', userSelect: 'all' }}>
              {created.code}
            </Text>
            <Button icon={<CopyOutlined />} onClick={() => void copy(created.code)}>
              复制配对码
            </Button>
          </Space>
          <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            Server：{created.serverUrl}{' '}
            <Button type="link" size="small" icon={<CopyOutlined />} onClick={() => void copy(created.serverUrl)}>
              复制地址
            </Button>
          </Paragraph>
        </Card>
      ) : null}

      {created && !current && !error ? <Spin description="正在读取配对状态" /> : null}
      {state === 'active' ? (
        <Alert
          type="info"
          showIcon
          title="等待桌面 Connector 建立连接"
          description="在目标桌面的 DSH Connect 面板中填写 Server 地址和上述配对码。页面每 2 秒读取一次真实状态。"
        />
      ) : null}
      {state === 'waiting_desktop_authorization' ? (
        <Alert
          type="warning"
          showIcon
          title="Connector 已连接，等待桌面用户确认"
          description={`请在桌面核对设备指纹并明确开放工作区。设备：${current?.deviceId ?? '未知'}`}
        />
      ) : null}
      {state === 'used' ? (
        <Alert
          type="success"
          showIcon
          title="桌面已授权并上线"
          description={`设备 ${current?.deviceId ?? ''} 已完成接入。接入不等于手机获得权限；手机仍需单独申请并由桌面确认。`}
        />
      ) : null}
      {created && !terminal ? (
        <Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
          配对码、指纹和工作区授权必须由桌面用户核对；不要在聊天或邮件中发送长期有效的凭据。
        </Paragraph>
      ) : null}
    </Modal>
  );
}

export function PairingHistoryPanel({ refreshKey }: { refreshKey: number }) {
  const [codes, setCodes] = useState<PairingCodeState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  }, [load, refreshKey]);

  const columns: ColumnsType<PairingCodeState> = [
    {
      title: '配对记录',
      dataIndex: 'pairingId',
      key: 'pairingId',
      width: 110,
      render: (value: number) => <Text code>#{value}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'state',
      key: 'state',
      width: 150,
      render: (state: PairingCodeState['state']) => {
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
      render: (value?: string) => value ? <Text code>{value}</Text> : <Text type="secondary">—</Text>,
    },
  ];

  return (
    <Card
      title="最近配对记录"
      style={{ marginTop: 16 }}
      extra={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>}
    >
      {error ? (
        <Alert type="error" showIcon title="无法加载配对记录" description={error} />
      ) : (
        <Table<PairingCodeState>
          rowKey="pairingId"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={codes}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty description="还没有生成过配对码" /> }}
        />
      )}
    </Card>
  );
}
