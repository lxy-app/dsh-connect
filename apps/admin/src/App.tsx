import { lazy, Suspense, useState } from 'react';
import type { ReactNode } from 'react';
import { Avatar, Button, Dropdown, Grid, Layout, Menu, Result, Space, Spin, Tag, Typography, theme } from 'antd';
import {
  AuditOutlined,
  CheckSquareOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  MonitorOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  SunOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { LoginPage } from './pages/LoginPage';
import type { Role } from './api/client';
import { roleColors, roleLabels } from './utils/format';
import { useAdminTheme } from './theme/ThemeProvider';
import appIcon from './assets/app-icon.png';

// Route-level code splitting: the login screen stays in the entry chunk while
// each authenticated page loads on demand.
const OverviewPage = lazy(() => import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const DevicesPage = lazy(() => import('./pages/DevicesPage').then((m) => ({ default: m.DevicesPage })));
const PoliciesPage = lazy(() => import('./pages/PoliciesPage').then((m) => ({ default: m.PoliciesPage })));
const RunningPage = lazy(() => import('./pages/RunningPage').then((m) => ({ default: m.RunningPage })));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage').then((m) => ({ default: m.ApprovalsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const AuditPage = lazy(() => import('./pages/AuditPage').then((m) => ({ default: m.AuditPage })));

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const MANAGEMENT_ROLES: readonly Role[] = ['owner', 'admin', 'auditor'];
const SETTINGS_ROLES: readonly Role[] = ['owner', 'admin'];

const NAV: ReadonlyArray<{ key: string; icon: ReactNode; label: string; roles?: readonly Role[] }> = [
  { key: '/overview', icon: <DashboardOutlined />, label: '概览' },
  { key: '/users', icon: <TeamOutlined />, label: '用户与角色' },
  { key: '/devices', icon: <CloudServerOutlined />, label: '设备管理' },
  { key: '/policies', icon: <SafetyCertificateOutlined />, label: '访问策略' },
  { key: '/running', icon: <MonitorOutlined />, label: '运行会话' },
  { key: '/approvals', icon: <CheckSquareOutlined />, label: '远程审批' },
  { key: '/settings', icon: <SettingOutlined />, label: '系统设置', roles: SETTINGS_ROLES },
  { key: '/audit', icon: <AuditOutlined />, label: '审计日志' },
];

export function App() {
  const { user, loading, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const { token } = theme.useToken();
  const { dark, toggle: toggleTheme } = useAdminTheme();
  const screens = Grid.useBreakpoint();
  const narrow = !screens.md;
  const effectiveCollapsed = collapsed || narrow;

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
  const navItems = canViewManagement ? NAV.filter((item) => !item.roles || item.roles.includes(user.role)) : [];
  const selected = navItems.find((item) => location.pathname.startsWith(item.key))?.key ?? '/overview';
  const guardRoute = (page: ReactNode, roles: readonly Role[], title: string, subTitle: string) =>
    roles.includes(user.role) ? <>{page}</> : <Result status="403" title={title} subTitle={subTitle} />;
  const guardManagementPage = (page: ReactNode) =>
    guardRoute(
      page,
      MANAGEMENT_ROLES,
      '当前账号没有全局管理权限',
      'Member 仅能使用本人身份；用户、设备、配对和审计数据不会加载。请联系 Owner 或 Admin。',
    );
  const guardSettingsPage = (page: ReactNode) =>
    guardRoute(
      page,
      SETTINGS_ROLES,
      '当前账号没有系统设置权限',
      '运行配置仅向 Owner / Admin 开放；Server 会独立强制相同权限。',
    );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={effectiveCollapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={216}
        theme={dark ? 'dark' : 'light'}
        style={{ borderRight: `1px solid ${token.colorBorderSecondary}` }}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: effectiveCollapsed ? '0 16px' : '0 20px',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        >
          <img
            className="admin-app-logo"
            src={appIcon}
            alt=""
            style={{ width: 30, height: 30, flex: '0 0 30px', borderRadius: 9, objectFit: 'cover' }}
          />
          {effectiveCollapsed ? null : (
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>DSH Connect</div>
              <div style={{ fontSize: 11, color: token.colorTextTertiary }}>CONTROL CENTER</div>
            </div>
          )}
        </div>
        <Menu
          theme={dark ? 'dark' : 'light'}
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
            icon={effectiveCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            disabled={narrow}
            aria-label={effectiveCollapsed ? '展开导航' : '收起导航'}
            onClick={() => setCollapsed(!effectiveCollapsed)}
          />
          <Text strong style={{ fontSize: 16 }}>
            {canViewManagement ? NAV.find((item) => item.key === selected)?.label : '账号访问'}
          </Text>
          <Space style={{ marginLeft: 'auto' }}>
            <Button
              type="text"
              icon={dark ? <SunOutlined /> : <MoonOutlined />}
              aria-label={dark ? '切换为浅色主题' : '切换为深色主题'}
              title={dark ? '切换为浅色主题' : '切换为深色主题'}
              onClick={toggleTheme}
            />
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
        <Content style={{ padding: narrow ? 16 : 24, background: token.colorBgLayout, overflow: 'auto' }}>
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
              <Route path="/policies" element={guardManagementPage(<PoliciesPage />)} />
              <Route path="/running" element={guardManagementPage(<RunningPage />)} />
              <Route path="/approvals" element={guardManagementPage(<ApprovalsPage />)} />
              <Route path="/settings" element={guardSettingsPage(<SettingsPage />)} />
              <Route path="/pairing" element={<Navigate to="/devices" replace />} />
              <Route path="/mobile" element={<Navigate to="/devices?tab=mobile" replace />} />
              <Route path="/audit" element={guardManagementPage(<AuditPage />)} />
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Routes>
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
}