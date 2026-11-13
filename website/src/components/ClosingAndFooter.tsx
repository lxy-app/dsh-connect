import { BrandLogo } from './BrandLogo';
import { GITHUB_URL, SITE_URL } from './content';
import { manualRoot } from './manual';
import { Icon } from './Icon';

export function ClosingAndFooter() {
  return (
    <>
      <section className="closing">
        <div className="container closing-card reveal">
          <BrandLogo className="closing-mark" />
          <h2>下一次灵感来时，<br />不必先回到电脑前。</h2>
          <p>从一条消息、一个决定开始，让桌面 Agent 的工作节奏与你同行。</p>
          <div className="closing-actions">
            <a className="btn btn-light" href={manualRoot}>开始使用<Icon name="arrowUp" /></a>
            <a className="btn btn-ghost" href="#features">重新探索产品能力<Icon name="arrow" /></a>
          </div>
        </div>
      </section>
      <footer className="site-footer">
        <div className="container">
          <div className="footer-top">
            <a className="brand" href="#top"><BrandLogo className="brand-mark" /><span className="brand-name">DSH <span>Connect</span></span></a>
            <span className="footer-tagline">你的桌面 Agent，现在触手可及。</span>
            <div className="footer-links"><a href="#features">产品能力</a><a href="#security">安全设计</a><a href={manualRoot}>用户手册</a><a href={manualRoot + 'deploy/'}>Docker 部署</a><a href={manualRoot + 'desktop/'}>DSH 插件安装</a><a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a></div>
          </div>
          <div className="footer-bottom"><span>© 2026 DSH Connect · Apache License 2.0</span><a className="footer-address" href={SITE_URL}>lxy.app/dsh-connect</a><span>产品演示数据均为模拟值</span></div>
        </div>
      </footer>
    </>
  );
}
