import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(websiteRoot, 'out');
const html = await readFile(path.join(outDir, 'index.html'), 'utf8');
let checks = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks += 1;
  console.log(`PASS: ${message}`);
}

for (const content of [
  '离开桌面，',
  '继续把',
  '想法做成。',
  '不只查看进度，',
  '安全不是附加项，',
  'DSH Connect 是远程桌面工具吗？',
  '不是。它聚焦 DSH 会话的查看与推进',
  'DSH Session Log 是会话事实源',
]) {
  assert(html.includes(content), `静态 HTML 包含正文：${content}`);
}

for (const tag of [
  '<link rel="canonical" href="https://lxy.app/dsh-connect/"',
  '<meta name="description"',
  '<meta property="og:title"',
  '<meta property="og:image"',
  '<link rel="manifest" href="/dsh-connect/manifest.webmanifest"',
]) {
  assert(html.includes(tag), `Metadata 存在：${tag}`);
}

const schemaMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
assert(schemaMatch, 'JSON-LD 结构化数据存在');
const schema = JSON.parse(schemaMatch[1]);
const graph = schema['@graph'];
assert(Array.isArray(graph), 'JSON-LD 使用可解析的 @graph');
assert(graph.some(item => item['@type'] === 'SoftwareApplication' && item.codeRepository === 'https://github.com/lxy-app/dsh-connect'), 'SoftwareApplication 包含真实开源仓库');
assert(graph.some(item => item['@type'] === 'FAQPage' && item.mainEntity.length === 5), 'FAQPage 包含五项问答');

const localAssets = [...html.matchAll(/(?:src|href)="(\/dsh-connect\/[^"]+)"/g)]
  .map(match => match[1])
  .filter(value => !value.endsWith('/dsh-connect/'));
assert(localAssets.length > 0, '发现带部署前缀的本地资源');
for (const asset of localAssets) {
  const relative = asset.slice('/dsh-connect/'.length).split(/[?#]/, 1)[0];
  await readFile(path.join(outDir, relative, relative.endsWith('/') ? 'index.html' : ''));
}
assert(localAssets.every(asset => asset.startsWith('/dsh-connect/')), '所有本地静态资源使用 /dsh-connect/ 前缀');
assert(!html.includes('src="/_next/') && !html.includes('href="/_next/'), '没有遗漏部署前缀的 Next.js 资源');

const sitemap = await readFile(path.join(outDir, 'sitemap.xml'), 'utf8');
const base = 'https://lxy.app/dsh-connect/';
const guides = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map(match => match[1]).filter(url => url.startsWith(base + 'docs/'));
assert(guides.length === 6, 'Sitemap 包含六篇用户指南');
for (const url of guides) {
  const page = await readFile(path.join(outDir, url.slice(base.length), 'index.html'), 'utf8');
  assert(page.includes(`rel="canonical" href="${url}"`) && page.includes('<h1>'), `指南可直接访问：${url}`);
  for (const [, href] of page.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const target = new URL(href, url);
    if (target.origin !== new URL(base).origin) continue;
    if (!target.href.startsWith(base)) throw new Error(`指南链接缺少部署前缀：${target.href}`);
    await readFile(path.join(outDir, target.pathname.slice('/dsh-connect/'.length), target.pathname.endsWith('/') ? 'index.html' : ''));
  }
}
const robots = await readFile(path.join(outDir, 'robots.txt'), 'utf8');
const llms = await readFile(path.join(outDir, 'llms.txt'), 'utf8');
assert(sitemap.includes('<loc>https://lxy.app/dsh-connect/</loc>'), 'Sitemap 使用正式 Canonical 地址');
assert(robots.includes('Sitemap: https://lxy.app/dsh-connect/sitemap.xml'), 'robots.txt 指向 Sitemap');
assert(llms.includes('## Core capabilities') && llms.includes('## Boundaries'), 'llms.txt 包含产品能力与边界');

const digest = data => createHash('sha256').update(data).digest('hex');
const sourceIcon = await readFile(path.join(websiteRoot, 'public/images/icon.png'));
const outputIcon = await readFile(path.join(outDir, 'images/icon.png'));
assert(digest(sourceIcon) === digest(outputIcon), '导出的品牌图标与指定 PNG 完全一致');

console.log(`Static export verification passed: ${checks} checks.`);
