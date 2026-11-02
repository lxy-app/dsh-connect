import type { IconName } from './Icon';

export const SITE_URL = 'https://lxy.app/dsh-connect/';
export const GITHUB_URL = 'https://github.com/lxy-app/dsh-connect';
export const ICON_URL = '/dsh-connect/images/icon.png';

export const navItems = [
  { href: '#features', label: '产品能力', id: 'features' },
  { href: '#workflow', label: '工作方式', id: 'workflow' },
  { href: '#security', label: '安全设计', id: 'security' },
  { href: '#faq', label: '常见问题', id: 'faq' },
] as const;

export type WorkflowKey = 'connect' | 'grant' | 'work';

export type WorkflowNode = {
  icon: IconName;
  title: string;
  copy: string;
  active: boolean;
};

export const workflowContent: Record<WorkflowKey, {
  label: string;
  badge: string;
  nodes: [WorkflowNode, WorkflowNode, WorkflowNode];
  note: string;
  notePrefix: string;
}> = {
  connect: {
    label: '01 / Pair your desktop',
    badge: '一次性配对',
    nodes: [
      { icon: 'monitor', title: '管理后台', copy: '生成短时配对码', active: false },
      { icon: 'link', title: 'Connector', copy: '主动连接并确认指纹', active: true },
      { icon: 'check', title: '桌面在线', copy: '成为受控设备', active: false },
    ],
    notePrefix: '无需公网入站端口。',
    note: 'Connector 从桌面主动建立持久 WSS 连接。',
  },
  grant: {
    label: '02 / Choose your grants',
    badge: '默认拒绝',
    nodes: [
      { icon: 'phone', title: '手机申请', copy: '选择工作区与动作', active: false },
      { icon: 'shield', title: '桌面确认', copy: 'Connector 明确批准', active: true },
      { icon: 'lock', title: '最小授权', copy: '范围可随时撤销', active: false },
    ],
    notePrefix: '配对不等于授权。',
    note: '查看、发送、取消和审批分别确认，权限变化立即收紧。',
  },
  work: {
    label: '03 / Keep work moving',
    badge: '状态清晰可见',
    nodes: [
      { icon: 'chat', title: '发送指令', copy: '稳定 requestId 幂等', active: false },
      { icon: 'zap', title: 'DSH 执行', copy: '流式返回真实进展', active: true },
      { icon: 'check', title: '继续推进', copy: '追问、取消或审批', active: false },
    ],
    notePrefix: '已接受不等于已完成。',
    note: '完成状态等待对应的 DSH 持久事件确认。',
  },
};

export const workflowSteps: { key: WorkflowKey; number: string; name: string; copy: string }[] = [
  { key: 'connect', number: '01', name: '接入你的 DSH 桌面', copy: '通过一次性配对码连接 Server，在桌面确认设备指纹。' },
  { key: 'grant', number: '02', name: '选择愿意开放的范围', copy: '按工作区与动作授权，不默认开放整台电脑。' },
  { key: 'work', number: '03', name: '在手机上推进会话', copy: '查看、追问、取消或审批，状态清楚可见。' },
];

export const faqs = [
  {
    question: 'DSH Connect 是远程桌面工具吗？',
    answer: '不是。它聚焦 DSH 会话的查看与推进，而不是远程控制整块屏幕。你可以查看消息、发送提示词、取消当前任务和处理一次性审批，但不会获得任意 Shell 或任意文件路径访问能力。',
  },
  {
    question: '手机完成配对后，就能查看所有桌面会话吗？',
    answer: '不能。手机配对只证明设备身份。桌面用户还需要通过 Connector 明确批准手机可访问的工作区与动作；撤销授权或吊销设备后，后续访问会被收紧。',
  },
  {
    question: '桌面需要开放公网端口吗？',
    answer: '不需要。桌面 Connector 主动建立到 Go Server 的持久出站 WSS 连接。跨不可信网络部署时，Server 与手机之间仍应使用 HTTPS/WSS。',
  },
  {
    question: '断线重连会重复发送同一条指令吗？',
    answer: '提示词请求全链路使用稳定 requestId 幂等。恢复时按照会话快照与持久事件游标对齐；“DSH 已接受”与“执行完成”也会明确区分，不把准入当作任务完成。',
  },
  {
    question: '可以私有部署吗？',
    answer: '可以。项目提供 Go Server、Web Admin、桌面 Connector 与移动 App，并支持使用 Docker 部署 Server 与 Admin。项目以 Apache License 2.0 发布。',
  },
] as const;
