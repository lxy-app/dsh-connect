import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { GITHUB_URL, ICON_URL, SITE_URL } from '@/components/content';
import '@/styles.css';

const title = 'DSH Connect — 离开桌面，继续把想法做成';
const description = 'DSH Connect 将桌面 DeepSeek Harness 会话安全延伸到手机，支持实时进展、远程指令、一次性审批、工作区授权与团队审计。';

export const metadata: Metadata = {
  metadataBase: new URL('https://lxy.app'),
  title,
  description,
  applicationName: 'DSH Connect',
  keywords: ['DSH Connect', 'DeepSeek Harness', 'AI Agent', '远程审批', '移动开发', '自托管'],
  authors: [{ name: 'DSH Connect', url: GITHUB_URL }],
  creator: 'DSH Connect',
  publisher: 'DSH Connect',
  category: 'Developer Tools',
  alternates: { canonical: '/dsh-connect/' },
  icons: {
    icon: [{ url: ICON_URL, type: 'image/png', sizes: '1024x1024' }],
    apple: [{ url: ICON_URL, sizes: '1024x1024' }],
  },
  manifest: '/dsh-connect/manifest.webmanifest',
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    url: SITE_URL,
    siteName: 'DSH Connect',
    title,
    description,
    images: [{ url: ICON_URL, width: 1024, height: 1024, alt: 'DSH Connect 应用图标' }],
  },
  twitter: { card: 'summary', title, description, images: [ICON_URL] },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0b0c12' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0c12' },
  ],
};

const themeInitScript = `try{const t=localStorage.getItem('dsh-connect-theme');document.documentElement.dataset.theme=t==='dark'||t==='light'?t:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch{document.documentElement.dataset.theme='light'}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
