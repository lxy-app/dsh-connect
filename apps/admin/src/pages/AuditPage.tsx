import { useCallback, useEffect, useState } from 'react';
import { App as AntApp, Button, Card, DatePicker, Empty, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import { adminApi, ApiError } from '../api/client';
import type { AuditEntry } from '../api/client';
import { formatDateTime, resultColor } from '../utils/format';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const PAGE_SIZE = 20;

export function AuditPage() {
  const { message } = AntApp.useApp();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [result, setResult] = useState<string | undefined>(undefined);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      try {
        const response = await adminApi.audit({
          action: action || undefined,
          actor: actor || undefined,
          result,
          from: range ? range[0].startOf('day').toISOString() : undefined,
          to: range ? range[1].endOf('day').toISOString() : undefined,
          limit: PAGE_SIZE,
          offset: (targetPage - 1) * PAGE_SIZE,
        });
        setEntries(response.entries);
        setTotal(response.total);
      } catch (cause) {
        message.error(cause instanceof ApiError ? cause.message : '加载审计失败');
      } finally {
        setLoading(false);
      }
    },
    [action, actor, result, range, message],
  );

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const search = () => {
    if (page === 1) {
      void load(1);
    } else {
      setPage(1);
    }
  };

  const columns: ColumnsType<AuditEntry> = [
    {
      title: '时间',
      dataIndex: 'occurredAt',
      key: 'occurredAt',
      width: 190,
      render: (value: string) => formatDateTime(value),
    },
    { title: '操作者', dataIndex: 'actor', key: 'actor', width: 160, ellipsis: true },
    { title: '动作', dataIndex: 'action', key: 'action', width: 200 },
    {
      title: '结果',
      dataIndex: 'result',
      key: 'result',
      width: 260,
      render: (value: string, row) => (
        <Space size={4}>
          <Tag color={resultColor(value)}>{value}</Tag>
          {row.errorCode ? <Text type="danger" style={{ fontSize: 11 }}>{row.errorCode}</Text> : null}
        </Space>
      ),
    },
    {
      title: '设备',
      dataIndex: 'deviceId',
      key: 'deviceId',
      width: 320,
      render: (value?: string) =>
        value ? (
          <Text
            copyable={{ text: value }}
            ellipsis={{ tooltip: value }}
            style={{ fontSize: 12, maxWidth: 260 }}
          >
            {value}
          </Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '来源 IP',
      dataIndex: 'sourceIp',
      key: 'sourceIp',
      width: 140,
      render: (value?: string) => value || <Text type="secondary">—</Text>,
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ marginBottom: 2 }}>
          审计日志
        </Title>
        <Text type="secondary">只追加的管理与 Connector 动作记录；不包含会话正文</Text>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input
            allowClear
            placeholder="动作，例如 admin.user.create"
            prefix={<SearchOutlined />}
            style={{ width: 260 }}
            value={action}
            onChange={(event) => setAction(event.target.value)}
            onPressEnter={search}
          />
          <Input
            allowClear
            placeholder="操作者，例如 bootstrap"
            style={{ width: 220 }}
            value={actor}
            onChange={(event) => setActor(event.target.value)}
            onPressEnter={search}
          />
          <Select
            allowClear
            placeholder="结果"
            style={{ width: 140 }}
            value={result}
            onChange={setResult}
            options={[
              { value: 'success', label: 'success' },
              { value: 'error', label: 'error' },
              { value: 'waiting_desktop_authorization', label: '等待授权' },
            ]}
          />
          <RangePicker value={range} onChange={(value) => setRange(value as [Dayjs, Dayjs] | null)} />
          <Button type="primary" onClick={search} loading={loading}>
            查询
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              void load(page);
            }}
          >
            刷新
          </Button>
        </Space>
      </Card>

      <Card>
        <Table<AuditEntry>
          rowKey={(row) => `${row.occurredAt}-${row.action}-${row.actor}-${row.requestId ?? ''}`}
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={entries}
          scroll={{ x: 1270 }}
          locale={{ emptyText: <Empty description="没有匹配的审计记录" /> }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            showTotal: (count) => `共 ${count} 条`,
            onChange: (nextPage) => setPage(nextPage),
          }}
        />
      </Card>
    </div>
  );
}