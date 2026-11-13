'use client';

import { useEffect, useState } from 'react';
import { BrandLogo } from './BrandLogo';
import { GITHUB_URL, navItems } from './content';
import { manualRoot } from './manual';
import { Icon } from './Icon';
import { useToast } from './Toast';

type Theme = 'light' | 'dark';

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [theme, setTheme] = useState<Theme>('light');
  const [activeSection, setActiveSection] = useState('');
  const notify = useToast();

  useEffect(() => {
    const updateHeader = () => setScrolled(window.scrollY > 18);
    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive: true });
    return () => window.removeEventListener('scroll', updateHeader);
  }, []);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  }, []);

  useEffect(() => {
    document.body.classList.toggle('menu-open', menuOpen);
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.classList.remove('menu-open');
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) setActiveSection(entry.target.id);
      });
    }, { rootMargin: '-30% 0px -55%', threshold: 0 });
    navItems.forEach(({ id }) => {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    });
    return () => observer.disconnect();
  }, []);

  function toggleTheme() {
    const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem('dsh-connect-theme', nextTheme);
    } catch {
      // Theme persistence is optional in privacy-restricted browser contexts.
    }
    notify(nextTheme === 'dark' ? '已切换为深色主题' : '已切换为浅色主题');
  }

  return (
    <>
      <header className={`site-header${scrolled ? ' scrolled' : ''}`}>
        <div className="container nav-wrap">
          <a className="brand" href="#top" aria-label="DSH Connect 首页" onClick={() => setMenuOpen(false)}>
            <BrandLogo className="brand-mark" eager />
            <span className="brand-name">DSH <span>Connect</span></span>
          </a>
          <nav className="desktop-nav" aria-label="主导航">
            {navItems.map(item => (
              <a key={item.id} href={item.href} className={activeSection === item.id ? 'active' : ''}>
                {item.label}
              </a>
            ))}
            <a href={manualRoot}>用户手册</a>
          </nav>
          <div className="nav-actions">
            <a className="nav-github" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              <Icon name="github" size={17} />GitHub
            </a>
            <button
              className="icon-button"
              type="button"
              aria-label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
              title="切换明暗主题"
              onClick={toggleTheme}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>
            <a className="btn btn-light nav-cta" href={manualRoot}>
              开始使用<Icon name="arrowUp" size={15} />
            </a>
            <button
              className="icon-button menu-toggle"
              type="button"
              aria-label={menuOpen ? '关闭导航菜单' : '打开导航菜单'}
              aria-expanded={menuOpen}
              aria-controls="mobileNav"
              onClick={() => setMenuOpen(open => !open)}
            >
              <Icon name={menuOpen ? 'x' : 'menu'} />
            </button>
          </div>
        </div>
      </header>
      <nav className={`mobile-nav${menuOpen ? ' open' : ''}`} id="mobileNav" aria-label="移动端导航">
        {navItems.map(item => (
          <a key={item.id} href={item.href} onClick={() => setMenuOpen(false)}>
            {item.label}<Icon name="arrow" />
          </a>
        ))}
        <a href={manualRoot} onClick={() => setMenuOpen(false)}>
          用户手册<Icon name="arrow" />
        </a>
      </nav>
    </>
  );
}
