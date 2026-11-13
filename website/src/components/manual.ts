import { SITE_URL } from './content';

export const manualRoot = '/dsh-connect/docs/';
export const chapters = [
  { path: '', title: '快速上手', description: '连接已有服务，在手机上打开第一个桌面会话。' },
  { path: 'deploy/', title: '使用 Docker 部署 DSH Connect', description: '使用 Docker Compose 启动 Server 和管理后台，配置数据库与外部访问。' },
  { path: 'desktop/', title: '安装 DSH 插件并连接桌面', description: '安装 Connector，配对桌面并批准手机可以使用的工作区与动作。' },
  { path: 'mobile/', title: '编译与安装手机端', description: '在 iPhone、Android 或鸿蒙真机上编译、签名和安装 DSH Connect。' },
  { path: 'sessions/', title: '在手机上使用会话', description: '阅读桌面会话、发送消息、停止执行，并处理一次性审批和提问。' },
  { path: 'troubleshooting/', title: '常见问题与恢复', description: '按症状排查配对、工作区权限、离线、审批与开发包连接问题。' },
] as const;

export function chapterMetadata(path: typeof chapters[number]['path']) {
  const chapter = chapters.find(item => item.path === path)!;
  const url = new URL(manualRoot + path, SITE_URL).href;
  const title = chapter.title + ' · DSH Connect 用户手册';
  return {
    title,
    description: chapter.description,
    alternates: { canonical: url },
    openGraph: { title, description: chapter.description, url },
    twitter: { card: 'summary' as const, title, description: chapter.description },
  };
}
