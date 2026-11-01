import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Client bundle is a classic script accepted by the DSH module loader', async () => {
  const source = await readFile(new URL('../../dist/client.js', import.meta.url), 'utf8');
  assert.match(source, /window\.__ModuleLoader__\.load\(/);
  assert.doesNotMatch(source, /^\s*(?:export|import)\b/m);
});
