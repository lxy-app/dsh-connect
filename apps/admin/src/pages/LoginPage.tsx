import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography, theme } from 'antd';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { useAuth } from '../auth/AuthProvider';
import { ApiError } from '../api/client';

const { Title, Text } = Typography;

interface LoginForm {
  email: string;
  password: string;
}

export function LoginPage() {
  const { signIn } = useAuth();
  const { token } = theme.useToken();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (values: LoginForm) => {
    setSubmitting(true);
    setError(null);
    try {
      await signIn(values.email, values.password);
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.status === 401 ? '邮箱或密码不正确' : cause.message);
      } else {
        setError(cause instanceof Error ? cause.message : '登录失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: `linear-gradient(160deg, ${token.colorBgLayout} 0%, ${token.colorBgContainer} 100%)`,
        padding: 24,
      }}
    >
      <Card style={{ width: 400, boxShadow: '0 18px 60px rgba(23, 33, 63, 0.12)' }}>
        <div style={{ marginBottom: 24 }}>
          <Title level={3} style={{ marginBottom: 4 }}>
            DSH Connect
          </Title>
          <Text type="secondary">管理后台 · 登录以管理用户、设备与审计</Text>
        </div>
        {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
        <Form<LoginForm> layout="vertical" onFinish={submit} requiredMark={false} disabled={submitting}>
          <Form.Item
            name="email"
            label="邮箱"
            rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '邮箱格式不正确' }]}
          >
            <Input size="large" prefix={<MailOutlined />} placeholder="owner@example.com" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password size="large" prefix={<LockOutlined />} placeholder="••••••••" autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}