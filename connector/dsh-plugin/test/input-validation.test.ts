import assert from 'node:assert/strict';
import test from 'node:test';
import { pageInput, promptInput, sessionAddress } from '../src/lib/input-validation.js';

test('prompt defaults to queue and preserves the end-to-end requestId', () => {
  assert.deepEqual(promptInput({
    sessionId: 'session-1', content: [{ type: 'text', text: 'Continue' }], clientTimeZone: 'Asia/Shanghai',
  }, 'req-1'), {
    requestId: 'req-1',
    sessionId: 'session-1',
    mode: 'queue',
    content: [{ type: 'text', text: 'Continue' }],
    clientTimeZone: 'Asia/Shanghai',
  });
});

test('P0 rejects files, images and arbitrary session addresses', () => {
  assert.throws(() => promptInput({
    sessionId: 'session-1', content: [{ type: 'file', receiptId: 'receipt-1' }],
  }, 'req-2'), { code: 'unsupported_content' });
  assert.throws(() => sessionAddress(''), { code: 'invalid_request' });
});

test('history input is bounded and uses the DSH SessionAddress shape', () => {
  assert.deepEqual(pageInput({ sessionId: 'session-1', cursor: 20, limit: 500 }), {
    address: { kind: 'session', sessionId: 'session-1' },
    throughSeq: -1,
    beforeSeq: 20,
    maxMessages: 200,
  });
  assert.throws(() => pageInput({ sessionId: 'session-1', throughSeq: -2 }), { code: 'invalid_request' });
  assert.equal(pageInput({ sessionId: 'session-1' }).throughSeq, -1);
});
