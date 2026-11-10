import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  InputNumber,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { adminApi, ApiError } from '../api/client';
import type { AdminInteraction, ApprovalPolicy } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { formatDateTime } from '../utils/format';

const { Title, Text } = Typography;

interface PolicyDraft {
  remoteEnabled: boolean;
  ttlSeconds: number;
}

function isRevisionConflict(cause: unknown): boolean {
  if (!(cause instanceof ApiError)) return false;
  const code = cause.code.toLowerCase();
  const text = cause.message.toLowerCase();
  return cause.status === 409 || code.includes('revision') || text.includes('revision');
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function fullText(value?: string) {
  return value ? <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value}</Text> : <Text type="secondary">—</Text>;
}

export function ApprovalsPage() {
  const { message } = AntApp.useApp();
  const { user } = useAuth();
  const [interactions, setInteractions] = useState<AdminInteraction[]>([]);
  const [policy, setPolicy] = useState<ApprovalPolicy | null>(null);
  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  const [selected, setSelected] = useState<AdminInteraction | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const canManage = user?.role === 'owner' || user?.role === 'admin';

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [nextInteractions, nextPolicy] = await Promise.all([
        adminApi.interactions(signal),
        adminApi.approvalPolicy(signal),
      ]);
      if (signal?.aborted) return;
      setInteractions(nextInteractions);
      setPolicy(nextPolicy);
      setDraft({ remoteEnabled: nextPolicy.remoteEnabled, ttlSeconds: nextPolicy.ttlSeconds });
    } catch (cause) {
      if (!signal?.aborted) setError(errorMessage(cause, '加载审批数据失败'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const savePolicy = async () => {
    if (!policy || !draft || !canManage) return;
    if (!Number.isSafeInteger(draft.ttlSeconds) || draft.ttlSeconds < 30 || draft.ttlSeconds > 600) {
      message.warning('审批 TTL 必须是 30–600 秒的整数');
      return;
    }

    setSubmitting(true);
    setConflict(null);
    try {
      await adminApi.updateApprovalPolicy({
        remoteEnabled: draft.remoteEnabled,
        ttlSeconds: draft.ttlSeconds,
        revision: policy.revision,
      });
      message.success('远程审批策略已保存');
      await load();
    } catch (cause) {
      if (isRevisionConflict(cause)) {
        setConflict('其他管理员已更新此策略。当前开关与 TTL 修改均已保留，请记录选择并刷新到最新 revision 后重新核对。');
        message.error('保存失败：审批策略 revision 已冲突');
      } else {
        message.error(errorMessage(cause, '保存远程审批策略失败'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnsType<AdminInteraction> = [
    {
      title: '类型',
      dataIndex: 'kind',
      key: 'kind',
      width: 100,
      render: (kind: string) => <Tag color={kind === 'approval' ? 'gold' : 'default'}>{kind === 'approval' ? '审批' : kind === 'question' ? '提问' : kind}</Tag>,
    },
    {
      title: '请求',
      key: 'request',
      render: (_, interaction) => (
        <div>
          <div style={{ fontWeight: 600 }}>{interaction.title}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {interaction.toolName || '未指定工具'} · {interaction.interactionId}
          </Text>
        </div>
      ),
    },
    {
      title: '桌面 / 工作区',
      key: 'source',
      width: 280,
      render: (_, interaction) => (
        <div>
          <div>{interaction.deviceName}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{interaction.workspaceName} · {interaction.sessionId}</Text>
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
    {
      title: '操作',
      key: 'actions',
      width: 110,
      render: (_, interaction) => <Button type="link" size="small" onClick={() => setSelected(interaction)}>查看详情</Button>,
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
        <div>
          <Title level={4} style={{ marginBottom: 2 }}>远程审批</Title>
          <Text type="secondary">查看待处理审批与提问的完整上下文；Admin 不提供代为决定的操作</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
      </div>

      <Alert
        type="info"
        showIcon
        title="一次性、超时失败关闭，桌面链保留"
        description="每个交互只接受一次明确决定；超时、离线、撤回或协议错误均失败关闭，不会自动批准。Connector 未处理时保留桌面审批链。"
        style={{ marginBottom: 16 }}
      />

      <Card title="远程审批策略" style={{ marginBottom: 16 }} loading={loading && !policy}>
        {policy && draft ? (
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            {conflict ? <Alert type="warning" showIcon title="审批策略版本已变化" description={conflict} /> : null}
            {canManage ? (
              <>
                <Space wrap size={16}>
                  <Space>
                    <Switch
                      checked={draft.remoteEnabled}
                      onChange={(remoteEnabled) => setDraft((current) => current ? { ...current, remoteEnabled } : current)}
                      aria-label="远程审批"
                    />
                    <Text strong>{draft.remoteEnabled ? '允许远程审批' : '已关闭远程审批'}</Text>
                  </Space>
                  <Space wrap>
                    <label htmlFor="approval-ttl"><Text strong>审批 TTL（秒）</Text></label>
                    <InputNumber
                      id="approval-ttl"
                      aria-label="审批 TTL（秒）"
                      min={30}
                      max={600}
                      precision={0}
                      value={draft.ttlSeconds}
                      onChange={(ttlSeconds) => setDraft((current) => current ? { ...current, ttlSeconds: ttlSeconds ?? 0 } : current)}
                    />
                  </Space>
                  <Button type="primary" loading={submitting} onClick={() => void savePolicy()}>保存审批策略</Button>
                </Space>
                <Text type="secondary">保存携带 revision；发生冲突时不会覆盖你当前的开关与 TTL 选择。</Text>
              </>
            ) : (
              <>
                <Alert type="info" showIcon title="当前角色只读，仅 Owner / Admin 可修改审批策略。" />
                <Space wrap size={16}>
                  <Text>远程审批：<Tag color={policy.remoteEnabled ? 'success' : 'default'}>{policy.remoteEnabled ? '已启用' : '已关闭'}</Tag></Text>
                  <Text>审批 TTL：<Text code>{policy.ttlSeconds} 秒</Text></Text>
                </Space>
              </>
            )}
            <Space wrap separator={<Text type="secondary">·</Text>}>
              <Text type="secondary">revision：<Text code>{policy.revision}</Text></Text>
              <Text type="secondary">更新时间：{formatDateTime(policy.updatedAt)}</Text>
            </Space>
            <div>
              <Text strong>移动端生物识别</Text>{' '}<Tag>移动端待接入</Tag>
              <div><Text type="secondary">此处不提供模拟开关，也不会改变移动端认证行为。</Text></div>
            </div>
          </Space>
        ) : null}
      </Card>

      {error ? (
        <Alert
          type="error"
          showIcon
          title="加载审批数据失败"
          description={error}
          action={<Button size="small" onClick={() => void load()}>重试</Button>}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Card title={`待处理交互（${interactions.length}）`}>
        <Table<AdminInteraction>
          rowKey="interactionId"
          loading={loading}
          columns={columns}
          dataSource={interactions}
          scroll={{ x: 1120 }}
          pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty description="暂无待处理审批或提问" /> }}
        />
      </Card>

      <Drawer
        open={selected !== null}
        title="交互详情（只读）"
        size={680}
        onClose={() => setSelected(null)}
        destroyOnHidden
      >
        {selected ? (
          <Space orientation="vertical" size={20} style={{ width: '100%' }}>
            <Alert type="info" showIcon title="完整上下文仅供核对；请前往受权移动端或桌面处理。" />
            <Descriptions
              bordered
              column={1}
              size="small"
              items={[
                { key: 'interactionId', label: '交互 ID', children: <Text code>{selected.interactionId}</Text> },
                { key: 'kind', label: '类型', children: selected.kind },
                { key: 'title', label: '标题', children: fullText(selected.title) },
                { key: 'toolName', label: '工具', children: fullText(selected.toolName) },
                { key: 'reason', label: '原因', children: fullText(selected.reason) },
                { key: 'callId', label: '调用 ID', children: selected.callId ? <Text code>{selected.callId}</Text> : <Text type="secondary">—</Text> },
                { key: 'device', label: '桌面', children: `${selected.deviceName} (${selected.deviceId})` },
                { key: 'sessionId', label: '会话 ID', children: <Text code>{selected.sessionId}</Text> },
                { key: 'workspace', label: '工作区', children: `${selected.workspaceName} (${selected.workspaceId})` },
                { key: 'createdAt', label: '创建时间', children: formatDateTime(selected.createdAt) },
                { key: 'expiresAt', label: '过期时间', children: formatDateTime(selected.expiresAt) },
              ]}
            />
            <div>
              <Title level={5}>问题与选项</Title>
              {selected.questions?.length ? (
                <Space orientation="vertical" size={16} style={{ width: '100%' }}>
                  {selected.questions.map((question, index) => (
                    <Card key={question.id} size="small" title={question.header || `问题 ${index + 1}`}>
                      <Space orientation="vertical" size={10} style={{ width: '100%' }}>
                        <Text code>{question.id}</Text>
                        <Text strong style={{ whiteSpace: 'pre-wrap' }}>{question.question}</Text>
                        {question.detail ? <Text type="secondary" style={{ whiteSpace: 'pre-wrap' }}>{question.detail}</Text> : null}
                        <Text type="secondary">{question.multiSelect ? '可多选' : '单选'}（此处只读）</Text>
                        {question.options?.length ? (
                          <ol style={{ margin: 0, paddingInlineStart: 22 }}>
                            {question.options.map((option) => (
                              <li key={option.label} style={{ marginBottom: 8 }}>
                                <div>{option.label}</div>
                                {option.description ? <Text type="secondary">{option.description}</Text> : null}
                              </li>
                            ))}
                          </ol>
                        ) : <Text type="secondary">无预设选项</Text>}
                      </Space>
                    </Card>
                  ))}
                </Space>
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="此交互没有问题字段" />}
            </div>
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
