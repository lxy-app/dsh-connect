import { lazy, Suspense, useState } from 'react';
import type { ReactNode } from 'react';
import { Avatar, Button, Dropdown, Layout, Menu, Result, Space, Spin, Tag, Typography, theme } from 'antd';
import {
  AuditOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MobileOutlined,
  QrcodeOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { LoginPage } from './pages/LoginPage';
import type { Role } from './api/client';
import { roleColors, roleLabels } from './utils/format';

// Route-level code splitting: the login screen stays in the entry chunk while
// each authenticated page loads on demand.
const OverviewPage = lazy(() => import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const DevicesPage = lazy(() => import('./pages/DevicesPage').then((m) => ({ default: m.DevicesPage })));
const AuditPage = lazy(() => import('./pages/AuditPage').then((m) => ({ default: m.AuditPage })));
const PairingPage = lazy(() => import('./pages/PairingPage').then((m) => ({ default: m.PairingPage })));
const MobilePage = lazy(() => import('./pages/MobilePage').then((m) => ({ default: m.MobilePage })));

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const MANAGEMENT_ROLES: readonly Role[] = ['owner', 'admin', 'auditor'];

const NAV = [
  { key: '/overview', icon: <DashboardOutlined />, label: '概览' },
  { key: '/users', icon: <TeamOutlined />, label: '用户与角色' },
  { key: '/devices', icon: <CloudServerOutlined />, label: '设备管理' },
  { key: '/pairing', icon: <QrcodeOutlined />, label: '桌面配对' },
  { key: '/mobile', icon: <MobileOutlined />, label: '手机配对' },
  { key: '/audit', icon: <AuditOutlined />, label: '审计日志' },
];

export function App() {
  const { user, loading, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const { token } = theme.useToken();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <Text type="secondary">正在验证会话…</Text>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const canViewManagement = MANAGEMENT_ROLES.includes(user.role);
  const navItems = canViewManagement ? NAV : [];
  const selected = navItems.find((item) => location.pathname.startsWith(item.key))?.key ?? '/overview';
  const guardManagementPage = (page: ReactNode) =>
    canViewManagement ? (
      page
    ) : (
      <Result
        status="403"
        title="当前账号没有全局管理权限"
        subTitle="Member 仅能使用本人身份；用户、设备、配对和审计数据不会加载。请联系 Owner 或 Admin。"
      />
    );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={216}
        theme="light"
        style={{ borderRight: `1px solid ${token.colorBorderSecondary}` }}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: collapsed ? '0 20px' : '0 20px',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              flex: '0 0 30px',
              borderRadius: 9,
              background: 'linear-gradient(135deg, #4f6ef7, #7b61ff)',
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            DC
          </div>
          {collapsed ? null : (
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>DSH Connect</div>
              <div style={{ fontSize: 11, color: token.colorTextTertiary }}>CONTROL CENTER</div>
            </div>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          items={navItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none' }}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            paddingInline: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
          />
          <Text strong style={{ fontSize: 16 }}>
            {canViewManagement ? NAV.find((item) => item.key === selected)?.label : '账号访问'}
          </Text>
          <Space style={{ marginLeft: 'auto' }}>
            <Tag color={roleColors[user.role]}>{roleLabels[user.role] ?? user.role}</Tag>
            <Dropdown
              menu={{
                items: [{ key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true }],
                onClick: ({ key }) => {
                  if (key === 'logout') void signOut();
                },
              }}
            >
              <Space style={{ cursor: 'pointer' }}>
                <Avatar size="small" icon={<UserOutlined />} />
                <span>{user.displayName}</span>
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content style={{ padding: 24, background: token.colorBgLayout, overflow: 'auto' }}>
          <Suspense
            fallback={
              <div style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
                <Spin />
              </div>
            }
          >
            <Routes>
              <Route path="/overview" element={guardManagementPage(<OverviewPage />)} />
              <Route path="/users" element={guardManagementPage(<UsersPage />)} />
              <Route path="/devices" element={guardManagementPage(<DevicesPage />)} />
              <Route path="/pairing" element={guardManagementPage(<PairingPage />)} />
              <Route path="/mobile" element={guardManagementPage(<MobilePage />)} />
              <Route path="/audit" element={guardManagementPage(<AuditPage />)} />
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Routes>
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
}