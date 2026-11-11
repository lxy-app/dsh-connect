import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { theme } from 'antd';
import { beforeEach, expect, it } from 'vitest';
import { AdminThemeProvider, useAdminTheme } from './ThemeProvider';

function ThemeProbe() {
  const { dark, toggle } = useAdminTheme();
  const { token } = theme.useToken();
  return (
    <button
      data-primary={token.colorPrimary.toLowerCase()}
      data-primary-bg={token.colorPrimaryBg.toLowerCase()}
      data-layout-bg={token.colorBgLayout.toLowerCase()}
      onClick={toggle}
    >
      {dark ? '深色' : '浅色'}
    </button>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = '';
});

it('persists and applies the selected Admin theme', async () => {
  const user = userEvent.setup();
  render(
    <AdminThemeProvider>
      <ThemeProbe />
    </AdminThemeProvider>,
  );
  expect(screen.getByRole('button', { name: '浅色' })).toHaveAttribute('data-primary', '#625bf6');
  expect(screen.getByRole('button', { name: '浅色' })).toHaveAttribute('data-primary-bg', '#eeedff');
  expect(screen.getByRole('button', { name: '浅色' })).toHaveAttribute('data-layout-bg', '#f4f5f9');
  await user.click(screen.getByRole('button', { name: '浅色' }));
  expect(screen.getByRole('button', { name: '深色' })).toHaveAttribute('data-primary-bg', '#322f51');
  expect(screen.getByRole('button', { name: '深色' })).toHaveAttribute('data-layout-bg', '#17181e');
  expect(localStorage.getItem('dsh-connect.admin.theme')).toBe('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
});
