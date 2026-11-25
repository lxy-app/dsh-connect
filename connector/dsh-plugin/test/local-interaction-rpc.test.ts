import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConnectorRuntime } from '../src/lib/runtime.js';
import { localInteractionRpc } from '../src/index.js';

const interactionId = 'int_00000000-0000-4000-8000-000000000001';
const owner = { principal: { kind: 'owner' } };
const remote = { principal: { kind: 'remote' } };

test('desktop interaction RPC is accessible only to the local owner', () => {
  let reads = 0;
  let handoffs = 0;
  const runtime = {
    pendingForDesktop() { reads += 1; return []; },
    takeover() { handoffs += 1; return true; },
  } as unknown as Pick<ConnectorRuntime, 'pendingForDesktop' | 'takeover'>;
  for (const endpoint of ['interaction.pending', 'interaction.takeover'] as const) {
    const result = localInteractionRpc(endpoint, { interactionId }, remote, runtime);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'remote-access/denied');
  }
  assert.equal(reads, 0);
  assert.equal(handoffs, 0);
  assert.deepEqual(localInteractionRpc('interaction.pending', undefined, owner, runtime), { ok: true, value: [] });
  assert.equal(reads, 1);
});

test('local takeover never grants approval itself and stale or malformed requests fail', () => {
  let handoffs = 0;
  const runtime = {
    pendingForDesktop() { return []; },
    takeover(id: string) {
      assert.equal(id, interactionId);
      handoffs += 1;
      return handoffs === 1;
    },
  } as unknown as Pick<ConnectorRuntime, 'pendingForDesktop' | 'takeover'>;
  assert.deepEqual(localInteractionRpc('interaction.takeover', { interactionId }, owner, runtime), {
    ok: true,
    value: { accepted: true, interactionId },
  });
  assert.throws(() => localInteractionRpc('interaction.takeover', { interactionId }, owner, runtime),
    (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'interaction_not_found');
  assert.throws(() => localInteractionRpc('interaction.takeover', { interactionId, decision: 'allow-once' }, owner, runtime),
    (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'invalid_request');
  assert.equal(handoffs, 2);
  assert.throws(() => localInteractionRpc('interaction.takeover', { interactionId }, owner, null), /no longer awaiting/);
});
