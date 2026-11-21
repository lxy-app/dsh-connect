import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveResponsiveLayout } from '@shared/lib/responsive-layout';

test('phone and narrow windows keep compact navigation', () => {
  for (const size of [
    { width: 390, height: 844 },
    { width: 743, height: 1200 },
    { width: 800, height: 600 },
    { width: 1023, height: 600 },
  ]) {
    const layout = resolveResponsiveLayout(size);
    assert.equal(layout.mode, 'compact');
    assert.equal(layout.isExpanded, false);
    assert.equal(layout.navigationRailWidth, 0);
    assert.equal(layout.sessionMasterWidth, 0);
    assert.equal(layout.detailWidth, size.width);
  }
});

test('Pad portrait uses a 76pt rail and 300pt session master', () => {
  const boundary = resolveResponsiveLayout({ width: 744, height: 1024 });
  assert.equal(boundary.isExpanded, true);
  assert.equal(boundary.detailWidth, 368);

  const layout = resolveResponsiveLayout({ width: 834, height: 1194 });
  assert.equal(layout.mode, 'expanded');
  assert.equal(layout.orientation, 'portrait');
  assert.equal(layout.navigationRailWidth, 76);
  assert.equal(layout.sessionMasterWidth, 300);
  assert.equal(layout.detailWidth, 458);
});

test('Pad landscape widens the session master without changing navigation', () => {
  const layout = resolveResponsiveLayout({ width: 1194, height: 834 });
  assert.equal(layout.mode, 'expanded');
  assert.equal(layout.orientation, 'landscape');
  assert.equal(layout.navigationRailWidth, 76);
  assert.equal(layout.sessionMasterWidth, 324);
  assert.equal(layout.detailWidth, 794);

  const boundary = resolveResponsiveLayout({ width: 1024, height: 768 });
  assert.equal(boundary.isExpanded, true);
  assert.equal(boundary.detailWidth, 624);
});

test('tall large windows keep the portrait master width', () => {
  const layout = resolveResponsiveLayout({ width: 1024, height: 1366 });
  assert.equal(layout.orientation, 'portrait');
  assert.equal(layout.sessionMasterWidth, 300);
  assert.equal(layout.detailWidth, 648);
});

test('invalid and extreme sizes never produce a negative detail width', () => {
  assert.equal(resolveResponsiveLayout({ width: Number.NaN, height: 800 }).detailWidth, 0);
  assert.equal(resolveResponsiveLayout({ width: -100, height: 800 }).detailWidth, 0);
  assert.equal(resolveResponsiveLayout({ width: 320, height: 200 }).detailWidth, 320);
});

test('reading, form, sheet and touch tokens stay bounded', () => {
  const layout = resolveResponsiveLayout({ width: 1194, height: 834 });
  assert.equal(layout.readingMaxWidth, 760);
  assert.equal(layout.formMaxWidth, 680);
  assert.equal(layout.sheetMaxWidth, 520);
  assert.equal(layout.attachmentSheetMaxWidth, 640);
  assert.equal(layout.touchTargetSize, 44);
  assert.equal(resolveResponsiveLayout({ width: 390, height: 844 }).touchTargetSize, 36);
});
