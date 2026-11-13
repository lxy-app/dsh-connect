import type { ReactNode } from 'react';
import { chapters, manualRoot } from '@/components/manual';
import { GITHUB_URL } from '@/components/content';
import './manual.css';

export default function ManualLayout({ children }: { children: ReactNode }) {
  return (
    <div className="manual">
      <a className="skip-link" href="#article">跳到正文</a>
      <header><a href="/dsh-connect/">DSH Connect</a><a href={GITHUB_URL}>GitHub</a></header>
      <div className="manual-body">
        <nav aria-label="用户手册目录">
          <strong>用户手册</strong>
          {chapters.map(({ path, title }) => <a key={path} href={manualRoot + path}>{title}</a>)}
        </nav>
        <main id="article">{children}</main>
      </div>
    </div>
  );
}
