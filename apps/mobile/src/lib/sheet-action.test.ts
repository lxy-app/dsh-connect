import assert from 'node:assert/strict';
import test from 'node:test';
import { SheetAction } from './sheet-action';

test('iOS launches only the selected picker after native dismissal', () => {
  const sheet = new SheetAction();
  const events: string[] = [];
  const close = () => events.push('close');
  sheet.dismissed(); // Closing the backdrop has no pending picker.
  sheet.select(close, () => events.push('library'), true);
  sheet.select(close, () => events.push('camera'), true);
  assert.deepEqual(events, ['close']);
  sheet.dismissed();
  sheet.dismissed();
  sheet.select(close, () => events.push('document'), true);
  sheet.dismissed();
  assert.deepEqual(events, ['close', 'library', 'close', 'document']);
});

test('platforms without a dismissal callback launch the picker immediately', () => {
  const events: string[] = [];
  new SheetAction().select(() => events.push('close'), () => events.push('picker'), false);
  assert.deepEqual(events, ['close', 'picker']);
});
