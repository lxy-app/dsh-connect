import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';

const STORAGE_KEY = 'dsh-connect.admin.theme';

interface AdminThemeState {
  dark: boolean;
  toggle: () => void;
}

const AdminThemeContext = createContext<AdminThemeState | null>(null);

function initialDarkMode(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
  } catch {
    // Storage can be unavailable in private mode; system preference remains.
  }
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function AdminThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(initialDarkMode);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try {
      localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
    } catch {
      // The active tab still keeps the selected theme in memory.
    }
  }, [dark]);
  const toggle = useCallback(() => setDark((value) => !value), []);
  const value = useMemo(() => ({ dark, toggle }), [dark, toggle]);

  return (
    <AdminThemeContext.Provider value={value}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: {
            colorPrimary: dark ? '#928BFF' : '#625BF6',
            colorPrimaryBg: dark ? '#322F51' : '#EEEDFF',
            colorPrimaryBgHover: dark ? '#322F51' : '#EEEDFF',
            colorBgLayout: dark ? '#17181E' : '#F4F5F9',
            borderRadius: 8,
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
          },
          components: {
            Button: {
              primaryColor: dark ? '#181A22' : '#FFFFFF',
            },
            Layout: {
              siderBg: dark ? '#17181E' : '#FFFFFF',
            },
            Menu: {
              itemSelectedColor: '#5543D6',
              itemSelectedBg: '#EEEDFF',
              darkItemBg: '#17181E',
              darkPopupBg: '#17181E',
              darkSubMenuItemBg: '#17181E',
              darkItemSelectedColor: '#F2F2F5',
              darkItemSelectedBg: '#322F51',
            },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </AdminThemeContext.Provider>
  );
}

export function useAdminTheme(): AdminThemeState {
  const context = useContext(AdminThemeContext);
  if (!context) throw new Error('useAdminTheme must be used within AdminThemeProvider');
  return context;
}
