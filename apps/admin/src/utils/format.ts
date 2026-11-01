import dayjs from 'dayjs';

export function formatDateTime(value?: string): string {
  if (!value) return '—';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm:ss') : value;
}

export function formatRelative(value?: string): string {
  if (!value) return '从未';
  const parsed = dayjs(value);
  if (!parsed.isValid()) return value;
  return parsed.fromNow();
}

/** Maps an audit result to an Ant Design tag color. */
export function resultColor(result: string): string {
  switch (result) {
    case 'success':
      return 'success';
    case 'error':
      return 'error';
    case 'waiting_desktop_authorization':
      return 'warning';
    default:
      return 'default';
  }
}

/** Maps a device status to a tag color and label. */
export function deviceStatusMeta(status: string): { color: string; label: string } {
  switch (status) {
    case 'online':
      return { color: 'success', label: '在线' };
    case 'offline':
      return { color: 'default', label: '离线' };
    case 'waiting_desktop_authorization':
      return { color: 'processing', label: '等待桌面授权' };
    case 'revoked':
      return { color: 'error', label: '已吊销' };
    default:
      return { color: 'default', label: status };
  }
}

export const roleLabels: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
  auditor: '审计员',
};

export const roleColors: Record<string, string> = {
  owner: 'gold',
  admin: 'blue',
  member: 'default',
  auditor: 'purple',
};