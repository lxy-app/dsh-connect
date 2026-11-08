import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntApp } from 'antd';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { AdminThemeProvider } from './theme/ThemeProvider';
import './styles.css';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element is missing');
}

createRoot(rootElement).render(
  <StrictMode>
    <AdminThemeProvider>
      <AntApp>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </AntApp>
    </AdminThemeProvider>
  </StrictMode>,
);
