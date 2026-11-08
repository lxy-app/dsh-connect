import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Select, Space, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { adminApi } from '../api/client';
import type { AdminSession, AdminSessionWarning } from '../api/client';
import { SessionTable } from '../components/SessionTable';
import { SessionWarnings } from '../components/SessionWarnings';

const { Title, Text } = Typography;

export function RunningPage() {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [warnings, setWarnings] = useState<AdminSessionWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deviceFilter, setDeviceFilter] = useState<string>();
  const [statusFilter, setStatusFilter] = useState<string>();
  const [workspaceFilter, setWorkspaceFilter] = useState<string>();

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await adminApi.sessions(signal);
      if (signal?.aborted) return;
      setSessions(response.sessions ?? []);
      setWarnings(response.warnings ?? []);
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : '加载会话失败');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const devices = useMemo(
    () => Array.from(new Map(sessions.map((session) => [session.deviceId, {
      value: session.deviceId,
      label: `${session.deviceName} (${session.deviceId})`,
    }])).values()),
    [sessions],
  );
  const statuses = useMemo(
    () => Array.from(new Set(sessions.map((session) => session.status))).map((status) => ({ value: status, label: status })),
    [sessions],
  );
  const workspaces = useMemo(
    () => Array.from(new Map(sessions.map((session) => {
      const key = `${session.deviceId}/${session.workspaceId}`;
      return [key, {
        value: key,
        label: `${session.workspaceName} · ${session.deviceName}`,
        deviceId: session.deviceId,
        workspaceId: session.workspaceId,
      }];
    })).values()),
    [sessions],
  );

  const filteredSessions = useMemo(
    () => sessions.filter((session) => {
      if (deviceFilter && session.deviceId !== deviceFilter) return false;
      if (statusFilter && session.status !== statusFilter) return false;
      if (workspaceFilter && `${session.deviceId}/${session.workspaceId}` !== workspaceFilter) return false;
      return true;
    }),
    [sessions, deviceFilter, statusFilter, workspaceFilter],
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
        <div>
          <Title level={4} style={{ marginBottom: 2 }}>运行会话</Title>
          <Text type="secondary">查看 Connector 上报的会话元数据；此处不展示会话正文，也不提供远程操作</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
      </div>

      <SessionWarnings warnings={warnings} />
      {error ? (
        <Alert
          type="error"
          showIcon
          title="无法加载会话"
          description={error}
          action={<Button size="small" onClick={() => void load()}>重试</Button>}
        />
      ) : (
        <>
          <Card style={{ marginBottom: 16 }}>
            <Space wrap>
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                aria-label="按设备筛选"
                placeholder="全部设备"
                value={deviceFilter}
                options={devices}
                onChange={setDeviceFilter}
                style={{ minWidth: 260 }}
              />
              <Select
                allowClear
                aria-label="按状态筛选"
                placeholder="全部状态"
                value={statusFilter}
                options={statuses}
                onChange={setStatusFilter}
                style={{ minWidth: 160 }}
              />
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                aria-label="按工作区筛选"
                placeholder="全部工作区"
                value={workspaceFilter}
                options={workspaces}
                onChange={setWorkspaceFilter}
                style={{ minWidth: 260 }}
              />
              <Text type="secondary">显示 {filteredSessions.length} / {sessions.length} 条会话</Text>
            </Space>
          </Card>
          <Card>
            <SessionTable
              sessions={filteredSessions}
              loading={loading}
              emptyDescription={sessions.length ? '没有符合筛选条件的会话' : '当前没有可展示的会话'}
            />
          </Card>
        </>
      )}
    </div>
  );
}
