import { expect, test } from '@playwright/test';

test('uses the purple app icon and palette, persists dark mode and stays within a narrow viewport', async ({ page }, testInfo) => {
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
  await expect(page.locator('.ant-spin-spinning')).toHaveCount(0);
  const selectedNav = page.locator('.ant-menu-item-selected');
  await expect(selectedNav).toHaveCSS('background-color', 'rgb(238, 237, 255)');
  await expect(selectedNav).toHaveCSS('color', 'rgb(85, 67, 214)');
  await page.screenshot({ path: testInfo.outputPath('overview-light.png'), fullPage: true });

  await page.getByRole('button', { name: '切换为深色主题' }).click();
  await expect(selectedNav).toHaveCSS('background-color', 'rgb(50, 47, 81)');
  await expect(selectedNav).toHaveCSS('color', 'rgb(242, 242, 245)');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('dsh-connect.admin.theme'))).toBe('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: '切换为浅色主题' })).toBeVisible();
  await expect(page.locator('.ant-spin-spinning')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('overview-dark.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(logo).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('uses exact violet and contrasting text on light and dark primary buttons', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('dsh-connect.admin.session');
    if (!localStorage.getItem('dsh-connect.admin.theme')) {
      localStorage.setItem('dsh-connect.admin.theme', 'light');
    }
  });
  await page.goto('/login');
  const login = page.getByRole('button', { name: /登\s*录/ });
  await expect(login).toHaveCSS('background-color', 'rgb(98, 91, 246)');
  await expect(login).toHaveCSS('color', 'rgb(255, 255, 255)');

  await page.evaluate(() => localStorage.setItem('dsh-connect.admin.theme', 'dark'));
  await page.reload();
  await expect(login).toHaveCSS('background-color', 'rgb(146, 139, 255)');
  await expect(login).toHaveCSS('color', 'rgb(24, 26, 34)');
});
