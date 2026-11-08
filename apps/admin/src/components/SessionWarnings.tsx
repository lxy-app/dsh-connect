import { Alert, Tag, Typography } from 'antd';
import type { AdminSessionWarning } from '../api/client';

const { Text } = Typography;

export function SessionWarnings({ warnings }: { warnings: AdminSessionWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <Alert
      type="warning"
      showIcon
      title="部分桌面未返回，当前为部分快照"
      description={
        <ul style={{ margin: 0, paddingInlineStart: 20 }}>
          {warnings.map((warning) => (
            <li key={`${warning.deviceId}/${warning.code}/${warning.message}`}>
              <Text strong>{warning.deviceName}</Text> <Tag>{warning.code}</Tag> {warning.message}
            </li>
          ))}
        </ul>
      }
      style={{ marginBottom: 16 }}
    />
  );
}
