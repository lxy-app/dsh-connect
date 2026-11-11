import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/manifest.webmanifest'), 'utf8'),
) as { background_color: string; theme_color: string };

describe('website purple brand theme', () => {
  it('keeps the confirmed light and dark violet tokens', () => {
    expect(styles).toContain('--violet:#6c5ce7');
    expect(styles).toContain('--violet-deep:#5543d6');
    expect(styles).toContain('--violet-soft:#ebe8ff');
    expect(styles).toContain('--violet:#9082ff');
    expect(styles).toContain('--violet-deep:#7969ed');
    expect(styles).toContain('--violet-soft:#2a2547');
    expect(styles).not.toContain('--accent:#4b5563');
    expect(styles).not.toContain('--accent:#f4f6f8');
  });

  it('uses the original dark purple-family browser theme color', () => {
    expect(manifest.background_color).toBe('#0b0c12');
    expect(manifest.theme_color).toBe('#0b0c12');
  });
});
