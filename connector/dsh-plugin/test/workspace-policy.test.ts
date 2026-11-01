import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceGrants } from '../src/types.js';
import { WorkspacePolicy } from '../src/lib/workspace-policy.js';

const grants: WorkspaceGrants = {
  workspaces: [{ id: 'workspace-a', name: 'Project A', path: '/work/a' }],
  scopes: ['read', 'prompt'],
};

test('only explicitly granted workspaces and scopes are allowed', () => {
  const policy = new WorkspacePolicy(grants);
  assert.equal(policy.authorize('workspace-a', 'read').name, 'Project A');
  assert.throws(() => policy.authorize('workspace-b', 'read'), { code: 'workspace_forbidden' });
  assert.throws(() => policy.authorize('workspace-a', 'cancel'), { code: 'permission_denied' });
});

test('empty grants fail closed', () => {
  const policy = new WorkspacePolicy();
  assert.throws(() => policy.authorize('workspace-a', 'read'), { code: 'permission_denied' });
  assert.deepEqual(policy.list(), []);
});

test('grant replacement takes effect immediately', () => {
  const policy = new WorkspacePolicy(grants);
  policy.replace({ workspaces: [], scopes: ['read'] });
  assert.throws(() => policy.authorize('workspace-a', 'read'), { code: 'workspace_forbidden' });
});
