import { expect, test } from '@playwright/test';

test('uses the app icon, persists dark mode and stays within a narrow viewport', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('dsh-connect.admin.session', 'theme-e2e-session');
    if (!localStorage.getItem('dsh-connect.admin.theme')) {
      localStorage.setItem('dsh-connect.admin.theme', 'light');
    }
  });
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/v1/admin/auth/me' ? {
      id: 'usr-theme-owner', email: 'owner@example.com', displayName: 'Theme Owner', role: 'owner', status: 'active',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    } : {
      devices: { total: 0, online: 0, offline: 0, waiting: 0, revoked: 0 },
      users: { total: 1, active: 1, disabled: 0 }, auditEntries: 0, recentActivity: [],
      activeSessions: 0, todayPrompts: 0, pendingInteractions: 0,
      promptTrend: [], sessions: [], pendingRequests: [], warnings: [],
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/overview');
  const logo = page.locator('img.admin-app-logo');
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);

  await page.getByRole('button', { name: '切换为深色主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('dsh-connect.admin.theme'))).toBe('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: '切换为浅色主题' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(logo).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
