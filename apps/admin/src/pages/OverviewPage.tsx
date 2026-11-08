import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Row, Skeleton, Statistic, Table, Tag, Tooltip, Typography, theme } from 'antd';
import {
  ApiOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  MessageOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { adminApi } from '../api/client';
import type { ColumnsType } from 'antd/es/table';
import type { AuditEntry, Overview, PendingRequest } from '../api/client';
import { SessionTable } from '../components/SessionTable';
import { SessionWarnings } from '../components/SessionWarnings';
import { formatDateTime, resultColor } from '../utils/format';

const { Title, Text } = Typography;

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export function OverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { token } = theme.useToken();

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await adminApi.overview(signal, browserTimeZone());
      if (!signal?.aborted) setOverview(response);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '加载概览失败');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (loading && !overview) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }
  if (!overview) {
    return (
      <Alert
        type="error"
        showIcon
        title="无法加载概览"
        description={error ?? '暂无数据'}
        action={<Button size="small" onClick={() => void load()}>重试</Button>}
      />
    );
  }

  const promptTrend = (overview.promptTrend ?? []).slice(-7);
  const maxPromptCount = Math.max(1, ...promptTrend.map((point) => point.count));

  const auditColumns: ColumnsType<AuditEntry> = [
    {
      title: '时间',
      dataIndex: 'occurredAt',
      key: 'occurredAt',
      width: 190,
      render: (value: string) => formatDateTime(value),
    },
    { title: '操作者', dataIndex: 'actor', key: 'actor', width: 180 },
    { title: '动作', dataIndex: 'action', key: 'action' },
    {
      title: '结果',
      dataIndex: 'result',
      key: 'result',
      width: 110,
      render: (value: string) => <Tag color={resultColor(value)}>{value}</Tag>,
    },
    {
      title: '来源 IP',
      dataIndex: 'sourceIp',
      key: 'sourceIp',
      width: 150,
      render: (value?: string) => value || <Text type="secondary">—</Text>,
    },
  ];

  const pendingColumns: ColumnsType<PendingRequest> = [
    {
      title: '类型',
      dataIndex: 'kind',
      key: 'kind',
      width: 100,
      render: (kind: string) => <Tag color="gold">{kind}</Tag>,
    },
    {
      title: '请求',
      key: 'request',
      render: (_, request: PendingRequest) => (
        <div>
          <div style={{ fontWeight: 600 }}>{request.title}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {request.toolName} · {request.interactionId}
          </Text>
        </div>
      ),
    },
    {
      title: '设备 / 会话 / 工作区',
      key: 'source',
      width: 300,
      render: (_, request: PendingRequest) => (
        <div>
          <div>{request.deviceName}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {request.sessionId} · {request.workspaceId}
          </Text>
        </div>
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
      title: '过期时间',
      dataIndex: 'expiresAt',
      key: 'expiresAt',
      width: 180,
      render: (value: string) => formatDateTime(value),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ marginBottom: 2 }}>概览</Title>
          <Text type="secondary">设备、会话、指令与待处理交互快照；可手动刷新获取最新数据</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
      </div>

      {error ? <Alert type="error" showIcon title="刷新概览失败" description={error} style={{ marginBottom: 16 }} /> : null}
      <SessionWarnings warnings={overview.warnings ?? []} />

      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              title="在线桌面"
              value={overview.devices.online ?? 0}
              suffix={`/ ${overview.devices.total ?? 0}`}
              styles={{ content: { color: '#3f8600' } }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic title="活跃会话" value={overview.activeSessions ?? 0} prefix={<MessageOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              title={
                <span>
                  今日指令{' '}
                  <Tooltip title="Connector 成功响应的唯一 prompt 准入数，不代表 Turn 完成数或执行成功数">
                    <QuestionCircleOutlined aria-label="今日指令口径说明" />
                  </Tooltip>
                </span>
              }
              value={overview.todayPrompts ?? 0}
              prefix={<ThunderboltOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic title="待处理审批 / 提问" value={overview.pendingInteractions ?? 0} prefix={<ClockCircleOutlined />} />
          </Card>
        </Col>
      </Row>

      <Card
        title={
          <span>
            近 7 日指令趋势{' '}
            <Tooltip title="按 Connector 成功响应的唯一 prompt 准入数统计，不代表 Turn 完成数">
              <QuestionCircleOutlined aria-label="指令趋势口径说明" />
            </Tooltip>
          </span>
        }
        style={{ marginBottom: 16 }}
      >
        {promptTrend.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无指令趋势数据" />
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, height: 200, padding: '8px 12px 0' }}>
            {promptTrend.map((point) => (
              <div
                key={point.date}
                title={`${point.date}: ${point.count} 条指令`}
                style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}
              >
                <Text type="secondary">{point.count}</Text>
                <div
                  aria-label={`${point.date} ${point.count} 条指令`}
                  style={{
                    width: '56%',
                    maxWidth: 56,
                    height: point.count ? Math.max(4, (point.count / maxPromptCount) * 140) : 0,
                    background: token.colorPrimary,
                    borderRadius: '6px 6px 0 0',
                    opacity: 0.85,
                  }}
                />
                <Text type="secondary" style={{ marginTop: 8 }}>{point.date.slice(5) || point.date}</Text>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title={<span><CloudServerOutlined /> 最近会话</span>}
        extra={<Text type="secondary">最多展示 5 条会话元数据</Text>}
        style={{ marginBottom: 16 }}
      >
        <SessionTable
          sessions={overview.sessions ?? []}
          pagination={false}
          emptyDescription="暂无最近会话"
        />
      </Card>

      <Card title="待处理审批 / 提问" style={{ marginBottom: 16 }}>
        <Table<PendingRequest>
          rowKey="interactionId"
          size="small"
          columns={pendingColumns}
          dataSource={overview.pendingRequests ?? []}
          pagination={false}
          scroll={{ x: 1100 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待处理请求" /> }}
        />
      </Card>

      <Card
        title={<span><ApiOutlined /> 最近管理动作</span>}
        extra={<Text type="secondary">共 {overview.auditEntries} 条审计记录</Text>}
      >
        <Table<AuditEntry>
          rowKey={(row) => `${row.occurredAt}-${row.action}-${row.actor}`}
          size="small"
          columns={auditColumns}
          dataSource={overview.recentActivity}
          pagination={false}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无审计记录" /> }}
        />
      </Card>
    </div>
  );
}
