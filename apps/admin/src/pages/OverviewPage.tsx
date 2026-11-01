import { useEffect, useState } from 'react';
import { Alert, Card, Col, Empty, Row, Skeleton, Statistic, Table, Tag, Typography } from 'antd';
import {
  ApiOutlined,
  CheckCircleOutlined,
  CloudServerOutlined,
  DisconnectOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { adminApi } from '../api/client';
import type { AuditEntry, Overview } from '../api/client';
import { formatDateTime, resultColor } from '../utils/format';

const { Title, Text } = Typography;

export function OverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    adminApi
      .overview(controller.signal)
      .then(setOverview)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : '加载失败');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  if (loading) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }
  if (error) {
    return <Alert type="error" showIcon message="无法加载概览" description={error} />;
  }
  if (!overview) {
    return <Empty description="暂无数据" />;
  }

  const columns = [
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

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ marginBottom: 2 }}>
          概览
        </Title>
        <Text type="secondary">设备、账号与最近管理动作的实时快照</Text>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic title="桌面设备总数" value={overview.devices.total ?? 0} prefix={<CloudServerOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              title="在线 Connector"
              value={overview.devices.online ?? 0}
              styles={{ content: { color: '#3f8600' } }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              title="离线设备"
              value={overview.devices.offline ?? 0}
              styles={{ content: { color: '#8c8c8c' } }}
              prefix={<DisconnectOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic
              title="管理员账号"
              value={overview.users.total ?? 0}
              suffix={`/ ${overview.users.active ?? 0} 启用`}
              prefix={<TeamOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Card
        title={
          <span>
            <ApiOutlined /> 最近管理动作
          </span>
        }
        extra={<Text type="secondary">共 {overview.auditEntries} 条审计记录</Text>}
      >
        <Table<AuditEntry>
          rowKey={(row) => `${row.occurredAt}-${row.action}-${row.actor}`}
          size="small"
          columns={columns}
          dataSource={overview.recentActivity}
          pagination={false}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无审计记录" /> }}
        />
      </Card>
    </div>
  );
}