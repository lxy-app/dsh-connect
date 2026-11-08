import { Empty, Table, Tag, Typography } from 'antd';
import type { ColumnsType, TableProps } from 'antd/es/table';
import type { AdminSession } from '../api/client';
import { formatDateTime } from '../utils/format';

const { Text } = Typography;

const columns: ColumnsType<AdminSession> = [
  {
    title: '会话',
    key: 'session',
    render: (_, session) => (
      <div>
        <div style={{ fontWeight: 600 }}>{session.title || session.sessionId}</div>
        <Text type="secondary" style={{ fontSize: 12 }}>{session.sessionId}</Text>
      </div>
    ),
  },
  {
    title: '桌面',
    key: 'device',
    width: 220,
    render: (_, session) => (
      <div>
        <div>{session.deviceName}</div>
        <Text type="secondary" style={{ fontSize: 12 }}>{session.deviceId}</Text>
      </div>
    ),
  },
  {
    title: '工作区',
    key: 'workspace',
    width: 220,
    render: (_, session) => (
      <div>
        <div>{session.workspaceName}</div>
        <Text type="secondary" style={{ fontSize: 12 }}>{session.workspaceId}</Text>
      </div>
    ),
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 120,
    render: (status: string) => <Tag>{status}</Tag>,
  },
  {
    title: '更新时间',
    dataIndex: 'updatedAt',
    key: 'updatedAt',
    width: 180,
    render: (value: string) => formatDateTime(value),
  },
];

interface SessionTableProps {
  sessions: AdminSession[];
  loading?: boolean;
  pagination?: TableProps<AdminSession>['pagination'];
  emptyDescription?: string;
}

/** Shared metadata-only session table. Session content and actions stay out of Admin. */
export function SessionTable({
  sessions,
  loading = false,
  pagination = { pageSize: 10, showSizeChanger: false, hideOnSinglePage: true },
  emptyDescription = '暂无会话',
}: SessionTableProps) {
  return (
    <Table<AdminSession>
      rowKey={(session) => `${session.deviceId}/${session.sessionId}`}
      size="middle"
      loading={loading}
      columns={columns}
      dataSource={sessions}
      pagination={pagination}
      scroll={{ x: 1100 }}
      locale={{ emptyText: <Empty description={emptyDescription} /> }}
    />
  );
}
