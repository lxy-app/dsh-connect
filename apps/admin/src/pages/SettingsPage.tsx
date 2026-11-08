import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Result, Space, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { adminApi } from '../api/client';
import type { AdminSettings } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { formatDateTime } from '../utils/format';

const { Title, Text } = Typography;

function formatSeconds(value: number): string {
  return `${value.toLocaleString()} 秒`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let size = value;
  let unit = 'B';
  for (const nextUnit of units) {
    if (size < 1024) break;
    size /= 1024;
    unit = nextUnit;
  }
  return `${size.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit} (${value.toLocaleString()} B)`;
}

export function SettingsPage() {
  const { user } = useAuth();
  const canView = user?.role === 'owner' || user?.role === 'admin';
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [loading, setLoading] = useState(canView);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const response = await adminApi.settings(signal);
      if (!signal?.aborted) setSettings(response);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '加载运行配置失败');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [canView, load]);

  if (!canView) {
    return (
      <Result
        status="403"
        title="当前账号没有系统设置权限"
        subTitle="运行配置仅向 Owner / Admin 开放；Server 会独立强制相同权限。"
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
        <div>
          <Title level={4} style={{ marginBottom: 2 }}>系统设置</Title>
          <Text type="secondary">查看 Server 当前生效的只读运行配置与数据库健康状态</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
      </div>

      <Alert
        type="info"
        showIcon
        title="运行配置由部署管理"
        description="此页不提供在线修改，也不展示配对码、Token、数据库凭据或推送密钥。需要变更时请调整部署配置。"
        style={{ marginBottom: 16 }}
      />

      {error ? (
        <Alert
          type="error"
          showIcon
          title="无法加载运行配置"
          description={error}
          action={<Button size="small" onClick={() => void load()}>重试</Button>}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Card title="Server 运行配置" extra={<Tag>只读</Tag>} loading={loading && !settings} style={{ marginBottom: 16 }}>
        {settings ? (
          <Descriptions
            bordered
            column={{ xs: 1, md: 2 }}
            items={[
              { key: 'serverUrl', label: 'Server 地址', children: <Text copyable={{ text: settings.serverUrl }}>{settings.serverUrl}</Text> },
              { key: 'generatedAt', label: '生成时间', children: formatDateTime(settings.generatedAt) },
              { key: 'pairingCodeTTL', label: '配对码有效期', children: formatSeconds(settings.pairingCodeTTLSeconds) },
              { key: 'mobileAccessTokenTTL', label: '手机 Access Token 有效期', children: formatSeconds(settings.mobileAccessTokenTTLSeconds) },
              { key: 'adminSessionTTL', label: 'Admin 会话有效期', children: formatSeconds(settings.adminSessionTTLSeconds) },
              { key: 'commandTimeout', label: '命令超时', children: formatSeconds(settings.commandTimeoutSeconds) },
              { key: 'attachmentsMode', label: '附件模式', children: <Text code>{settings.attachmentsMode}</Text> },
              { key: 'maxAttachmentBytes', label: '单附件上限', children: formatBytes(settings.maxAttachmentBytes) },
              { key: 'attachmentTTL', label: '附件保留时间', children: formatSeconds(settings.attachmentTTLSeconds) },
              { key: 'goVersion', label: 'Go 版本', children: <Text code>{settings.goVersion}</Text> },
            ]}
          />
        ) : null}
      </Card>

      <Card title="数据库健康" style={{ marginBottom: 16 }} loading={loading && !settings}>
        {settings ? (
          <Space orientation="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap>
              <Text strong>数据库方言</Text>
              <Tag>{settings.databaseDialect}</Tag>
              <Text strong>连接状态</Text>
              <Tag color={settings.databaseConnected ? 'success' : 'error'}>{settings.databaseConnected ? '已连接' : '连接失败'}</Tag>
            </Space>
            <Alert
              type={settings.databaseConnected ? 'success' : 'error'}
              showIcon
              title={settings.databaseConnected ? 'Server 当前可连接数据库' : 'Server 当前无法连接数据库，请检查部署与数据库状态'}
            />
          </Space>
        ) : null}
      </Card>

      <Card title="尚未接入的能力" extra={<Tag>不可在此编辑</Tag>}>
        <Descriptions
          bordered
          column={1}
          items={[
            {
              key: 'push',
              label: 'APNs / FCM 推送',
              children: <Space wrap><Tag>未接入</Tag><Text type="secondary">由部署配置管理；本页不读取或保存推送凭据。</Text></Space>,
            },
            {
              key: 'lockScreen',
              label: '锁屏通知隐私',
              children: <Space wrap><Tag>未接入</Tag><Text type="secondary">由部署配置管理；当前没有可编辑的锁屏通知设置。</Text></Space>,
            },
          ]}
        />
      </Card>
    </div>
  );
}
