import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Client bundle is a classic script accepted by the DSH module loader', async () => {
  const source = await readFile(new URL('../../dist/client.js', import.meta.url), 'utf8');
  assert.match(source, /window\.__ModuleLoader__\.load\(/);
  assert.doesNotMatch(source, /^\s*(?:export|import)\b/m);
});

test('Desktop panel uses silver-white brand tokens with contrasting foregrounds', async () => {
  const source = await readFile(new URL('../../dist/client.js', import.meta.url), 'utf8');
  for (const token of [
    '--dsc-brand:#4B5563', '--dsc-brand-soft:#E8EDF2', '--dsc-on-brand:#FFFFFF',
    '--dsc-brand:#F4F6F8', '--dsc-brand-soft:#353B43', '--dsc-on-brand:#171A1F',
  ]) {
    assert.ok(source.includes(token), `missing Connector brand token: ${token}`);
  }
  assert.doesNotMatch(source, /--dsw-alias-brand-primary/);
  assert.match(source, /hostIsDark\(\) \? 'dark' : 'light'/);
});

test('Desktop panel can still change its own grants after pairing', async () => {
  const source = await readFile(new URL('../../dist/client.js', import.meta.url), 'utf8');
  // Only the post-pairing grant editor calls this RPC; pairing itself uses
  // pair.authorize. Losing the call would silently make grants read-only again.
  assert.match(source, /pair\.updateGrants/);
});

test('Desktop grant editor supports bounded search, selected-only review and global select all', async () => {
  const source = await readFile(new URL('../../dist/client.js', import.meta.url), 'utf8');
  for (const token of [
    '.dsc-grant-workspace-list{max-height:326px;overflow-y:auto',
    'grantWorkspaceQuery', 'grantOnlySelected', 'grantWorkspaceListRef',
    'noWorkspaceMatches', 'clearWorkspaceFilter', 'grantsInvalid',
    'Search workspace names or paths', 'Selected only',
  ]) {
    assert.ok(source.includes(token), `missing workspace grant editor capability: ${token}`);
  }
  const selectAll = source.split('const toggleAllGrantWorkspaces')[1]?.split('const toggleGrantScope')[0];
  assert.ok(selectAll, 'select-all handler must remain in the client bundle');
  assert.match(selectAll, /workspaces\.map\(\(workspace\) => workspace\.id\)/);
  assert.doesNotMatch(selectAll, /visibleGrantWorkspaces|normalizedGrantWorkspaceQuery|grantOnlySelected/);
  const filter = source.split('const visibleGrantWorkspaces')[1]?.split('const grantSelectionValid')[0];
  assert.ok(filter, 'workspace filter must remain in the client bundle');
  assert.match(filter, /workspace\.title/);
  assert.match(filter, /workspace\.path/);
  assert.match(source, /input\.indeterminate = selectedWorkspaceCount > 0/);
  assert.match(source, /!grantDirty \|\| !grantSelectionValid/);
});

test('Background status polling does not erase authorization errors', async () => {
  const source = await readFile(new URL('../../dist/client.js', import.meta.url), 'utf8');
  const refresh = source.split('const refresh = useCallback')[1]?.split('useEffect')[0];
  assert.ok(refresh, 'refresh callback must remain in the client bundle');
  assert.doesNotMatch(refresh, /setError\(''\)/);
  assert.match(source, /DSH Connect authorization submitted/);
});
