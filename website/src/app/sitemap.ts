import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/components/content';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return [{
    url: SITE_URL,
    lastModified: '2026-11-02',
    changeFrequency: 'monthly',
    priority: 1,
  }];
}
