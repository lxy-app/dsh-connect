import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/components/content';

import { chapters, manualRoot } from '@/components/manual';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return [{
    url: SITE_URL,
    changeFrequency: 'monthly',
    priority: 1,
  }, ...chapters.map(chapter => ({ url: new URL(manualRoot + chapter.path, SITE_URL).href }))];
}
