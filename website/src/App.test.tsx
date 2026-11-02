import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import HomePage from './app/page';
import { GITHUB_URL } from './components/content';

function renderWebsite() {
  return render(<HomePage />);
}

describe('DSH Connect website', () => {
  it('renders crawlable product content, brand assets and structured data', () => {
    const { container } = renderWebsite();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('离开桌面，继续把想法做成。');
    expect(screen.getByText('安全不是附加项，', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /吗？|吗$|吗？$/ }).length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('.faq-item')).toHaveLength(5);
    expect(container.querySelectorAll('img[src="/dsh-connect/images/icon.png"]')).toHaveLength(4);
    expect(screen.getAllByRole('link', { name: /开始使用/ }).every(link => link.getAttribute('href') === GITHUB_URL)).toBe(true);

    const schema = container.querySelector('script[type="application/ld+json"]');
    expect(schema?.textContent).toContain('SoftwareApplication');
    expect(schema?.textContent).toContain('FAQPage');
    expect(schema?.textContent).toContain('DSH Connect 是远程桌面工具吗？');
  });

  it('completes and resets the simulated conversation', async () => {
    const user = userEvent.setup();
    renderWebsite();
    const input = screen.getByRole('textbox', { name: '输入模拟会话指令' });
    const send = screen.getByRole('button', { name: '发送模拟指令' });

    await user.click(send);
    expect(screen.getByRole('status')).toHaveTextContent('先输入一条演示指令');
    await user.click(screen.getByRole('button', { name: '检查移动布局' }));
    expect(input).toHaveValue('检查一下移动端布局');
    await user.click(send);
    expect(send).toBeDisabled();
    expect(await screen.findByText(/此处展示的是模拟回复。/, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(input).toBeEnabled();
    expect(screen.getByText('演示回复完成 · 模拟数据')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重置演示' }));
    expect(input).toHaveValue('');
    expect(screen.queryByText('检查一下移动端布局')).not.toBeInTheDocument();
  });

  it('supports allow-once, rejection and approval reset', async () => {
    const user = userEvent.setup();
    renderWebsite();

    await user.click(screen.getByRole('button', { name: '允许一次' }));
    expect(screen.getByText('已允许一次')).toBeVisible();
    expect(screen.getByText('模拟结果，不执行真实命令')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '重置' }));
    await user.click(screen.getByRole('button', { name: '拒绝' }));
    expect(screen.getByText('已拒绝本次请求')).toBeVisible();
  });

  it('updates independent workspace action grants', async () => {
    const user = userEvent.setup();
    renderWebsite();

    await user.click(screen.getByRole('button', { name: '远程审批' }));
    expect(screen.getByText('3 项动作已授权')).toBeInTheDocument();
    for (const name of ['查看会话', '发送指令', '取消执行']) {
      await user.click(screen.getByRole('button', { name }));
    }
    expect(screen.getByText('未授权任何动作')).toBeInTheDocument();
    for (const name of ['查看会话', '发送指令', '取消执行', '远程审批']) {
      await user.click(screen.getByRole('button', { name }));
    }
    expect(screen.getByText('4 项动作已授权')).toBeInTheDocument();
  });

  it('switches workflow tabs with click and keyboard', async () => {
    const user = userEvent.setup();
    renderWebsite();
    const grantTab = screen.getByRole('tab', { name: /选择愿意开放的范围/ });

    await user.click(grantTab);
    expect(grantTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('配对不等于授权。');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /在手机上推进会话/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('已接受不等于已完成。');
  });

  it('expands and collapses FAQ answers independently', async () => {
    const user = userEvent.setup();
    renderWebsite();
    const firstQuestion = screen.getByRole('button', { name: 'DSH Connect 是远程桌面工具吗？' });
    const secondQuestion = screen.getByRole('button', { name: '手机完成配对后，就能查看所有桌面会话吗？' });
    const firstAnswer = screen.getByText(/不是。它聚焦 DSH 会话的查看与推进/);
    const secondAnswer = screen.getByText(/不能。手机配对只证明设备身份/);

    expect(firstAnswer).toBeVisible();
    expect(secondAnswer).not.toBeVisible();
    await user.click(firstQuestion);
    expect(firstAnswer).not.toBeVisible();
    await user.click(secondQuestion);
    expect(secondAnswer).toBeVisible();
  });

  it('switches theme and closes the mobile menu with Escape', async () => {
    const user = userEvent.setup();
    renderWebsite();

    await user.click(screen.getByRole('button', { name: '切换深色主题' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(window.localStorage.getItem('dsh-connect-theme')).toBe('dark');
    const menu = screen.getByRole('button', { name: '打开导航菜单' });
    await user.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(document.body).toHaveClass('menu-open');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(menu).toHaveAttribute('aria-expanded', 'false'));
    expect(document.body).not.toHaveClass('menu-open');
  });
});
