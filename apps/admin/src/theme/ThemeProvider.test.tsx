import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it } from 'vitest';
import { AdminThemeProvider, useAdminTheme } from './ThemeProvider';

function ThemeProbe() {
  const { dark, toggle } = useAdminTheme();
  return <button onClick={toggle}>{dark ? '深色' : '浅色'}</button>;
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
  expect(screen.getByRole('button', { name: '浅色' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '浅色' }));
  expect(screen.getByRole('button', { name: '深色' })).toBeInTheDocument();
  expect(localStorage.getItem('dsh-connect.admin.theme')).toBe('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
});
