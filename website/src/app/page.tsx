import { ClosingAndFooter } from '@/components/ClosingAndFooter';
import { Faq } from '@/components/Faq';
import { FactStrip, Features } from '@/components/Features';
import { Header } from '@/components/Header';
import { Hero } from '@/components/Hero';
import { RevealManager } from '@/components/RevealManager';
import { Security } from '@/components/Security';
import { ToastProvider } from '@/components/Toast';
import { Workflow } from '@/components/Workflow';
import { faqs, GITHUB_URL, SITE_URL } from '@/components/content';

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}#website`,
      url: SITE_URL,
      name: 'DSH Connect',
      inLanguage: 'zh-CN',
      description: 'DeepSeek Harness 的移动会话控制与团队治理入口。',
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE_URL}#software`,
      name: 'DSH Connect',
      url: SITE_URL,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'iOS, Android, Web',
      description: '安全查看和推进桌面 DeepSeek Harness 会话，支持实时回复、提示词、取消、一次性审批、工作区授权与审计。',
      codeRepository: GITHUB_URL,
      license: `${GITHUB_URL}/blob/main/LICENSE`,
      isAccessibleForFree: true,
    },
    {
      '@type': 'FAQPage',
      '@id': `${SITE_URL}#faq`,
      inLanguage: 'zh-CN',
      mainEntity: faqs.map(faq => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: { '@type': 'Answer', text: faq.answer },
      })),
    },
  ],
};

export default function HomePage() {
  return (
    <ToastProvider>
      <a className="skip-link" href="#main">跳到主要内容</a>
      <RevealManager />
      <Header />
      <main id="main">
        <Hero />
        <FactStrip />
        <Features />
        <Workflow />
        <Security />
        <Faq />
      </main>
      <ClosingAndFooter />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }}
      />
    </ToastProvider>
  );
}
