import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  LlmRuntime,
  ModelCatalog,
  ModelSelection,
  SessionController,
  SessionFollowFrame,
  WorkspaceRegistry,
} from '../src/host-api.js';
import type { ConnectorScope } from '../src/types.js';
import { HostSessionAdapter } from '../src/lib/host-session-adapter.js';
import { WorkspacePolicy } from '../src/lib/workspace-policy.js';

const defaultSelection: ModelSelection = { provider: 'deepseek', model: 'deepseek-chat' };
const reasonerSelection: ModelSelection = {
  provider: 'deepseek',
  model: 'deepseek-reasoner',
  reasoningEffort: 'high',
};

const catalog: ModelCatalog = {
  default: defaultSelection,
  routableProviders: ['deepseek'],
  groups: [{
    id: 'deepseek',
    name: 'DeepSeek',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', description: 'General purpose' },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek Reasoner',
        reasoning: {
          efforts: [
            { id: 'medium', name: 'Medium' },
            { id: 'high', name: 'High', description: 'More reasoning' },
          ],
          defaultEffort: 'medium',
        },
        badge: { text: { en: 'Reasoning', zh: '推理' }, tone: 'blue' },
      },
    ],
  }],
  failures: [{ id: 'broken', name: 'Broken Provider', message: 'Credentials are not configured' }],
};

interface SetupOptions {
  readonly scopes?: readonly ConnectorScope[];
  readonly projections?: SessionController['projections'];
  readonly resolveAgent?: SessionController['resolveAgent'];
  readonly prompt?: SessionController['prompt'];
  readonly llm?: Partial<LlmRuntime>;
}

function setup(options: SetupOptions = {}) {
  const calls: string[] = [];
  const selections: ModelSelection[] = [];
  const controller: SessionController = {
    async list() {
      return {
        items: [{
          sessionId: 's1', updatedAt: 1_000, running: false, blank: false, agentAvailable: true,
        }],
      };
    },
    async create() { return { sessionId: 'unused' }; },
    async events() { return { records: [], hasMore: false }; },
    async prompt(request, signal) {
      calls.push('prompt');
      if (options.prompt) return options.prompt(request, signal);
      return { accepted: true as const };
    },
    async modelCatalog() {
      calls.push('modelCatalog');
      return catalog;
    },
    async projections(request, signal) {
      calls.push('projections');
      if (options.projections) return options.projections(request, signal);
      return {
        kind: 'sequenced' as const,
        asOfSeq: 4,
        values: { modelSelection: { lastUsed: defaultSelection, next: null } },
      };
    },
    async resolveAgent(sessionId) {
      calls.push('resolveAgent');
      if (options.resolveAgent) return options.resolveAgent(sessionId);
      return {
        agent: {
          id: sessionId,
          model: {
            select(selection: ModelSelection) {
              calls.push('agent.model.select');
              selections.push(selection);
            },
          },
        },
      };
    },
    cancel() { return { accepted: true as const }; },
    async *follow(): AsyncGenerator<SessionFollowFrame, void, unknown> {},
  };
  const llm: LlmRuntime = {
    listProviders: () => [{ id: 'deepseek' }],
    async listModels(provider) {
      return [
        { provider, id: 'deepseek-chat' },
        { provider, id: 'deepseek-reasoner' },
      ];
    },
    async resolveCallConfig(selection) {
      calls.push('resolveCallConfig');
      if (selection.reasoningEffort !== undefined && selection.model !== 'deepseek-reasoner') {
        throw new Error('reasoning effort is unsupported');
      }
      return selection;
    },
    ...options.llm,
  };
  const workspaceRegistry: WorkspaceRegistry = {
    list: () => [{
      id: 'ws-1', path: '/work/one', title: 'One', sessionIds: ['s1'], createdAt: 'now', updatedAt: 'now',
    }],
  };
  const adapter = new HostSessionAdapter({
    controller,
    llm,
    workspaceRegistry,
    policy: new WorkspacePolicy({
      workspaces: [{ id: 'ws-1', name: 'One', path: '/work/one' }],
      scopes: options.scopes ?? ['read', 'prompt', 'cancel'],
    }),
    deviceId: 'dev-1',
    emit: () => {},
    logger: { warn() {} },
  });
  return { adapter, calls, selections };
}

const context = { signal: new AbortController().signal };

test('model catalog combines catalog and projection without resolving an Agent', async () => {
  const { adapter, calls } = setup({
    projections: async () => ({
      kind: 'sequenced',
      asOfSeq: 7,
      values: { modelSelection: { lastUsed: defaultSelection, next: reasonerSelection } },
    }),
  });
  const result = await adapter['model.catalog']({ sessionId: 's1', workspaceId: 'ws-1' }, { signal: context.signal });
  assert.equal(result.sessionId, 's1');
  assert.equal(result.deviceId, 'dev-1');
  assert.equal(result.workspaceId, 'ws-1');
  assert.deepEqual(result.default, defaultSelection);
  assert.deepEqual(result.lastUsed, defaultSelection);
  assert.deepEqual(result.next, reasonerSelection);
  assert.deepEqual(result.effective, reasonerSelection);
  assert.equal(result.projectionKind, 'sequenced');
  assert.equal(result.groups[0]?.models[1]?.reasoning?.defaultEffort, 'medium');
  assert.deepEqual(result.groups[0]?.models[1]?.badge, {
    text: { en: 'Reasoning', zh: '推理' }, tone: 'blue',
  });
  assert.equal(result.failures[0]?.message, 'Credentials are not configured');
  assert.equal(calls.includes('resolveAgent'), false);
  assert.equal(calls.includes('agent.model.select'), false);
});

test('read-only grants can inspect but cannot select a model', async () => {
  const { adapter, selections } = setup({ scopes: ['read'] });
  await assert.doesNotReject(
    adapter['model.catalog']({ sessionId: 's1', workspaceId: 'ws-1' }, { signal: context.signal }),
  );
  await assert.rejects(
    adapter['model.select']({
      sessionId: 's1', workspaceId: 'ws-1', provider: 'deepseek', model: 'deepseek-chat',
    }, { signal: context.signal, requestId: 'model-read-only' }),
    { code: 'permission_denied' },
  );
  assert.equal(selections.length, 0);
});

test('session selection uses AgentModel directly and preserves the deployment default', async () => {
  const { adapter, calls, selections } = setup();
  const result = await adapter['model.select']({
    sessionId: 's1',
    workspaceId: 'ws-1',
    provider: reasonerSelection.provider,
    model: reasonerSelection.model,
    reasoningEffort: reasonerSelection.reasoningEffort,
  }, { signal: context.signal, requestId: 'model-1' });
  assert.deepEqual(result, {
    sessionId: 's1',
    requestId: 'model-1',
    selected: reasonerSelection,
  });
  assert.deepEqual(selections, [reasonerSelection]);
  assert.deepEqual(catalog.default, defaultSelection);
  assert.ok(calls.indexOf('resolveCallConfig') < calls.indexOf('agent.model.select'));
});

test('unavailable routes and unsupported effort fail before appending a Session selection', async (t) => {
  const cases = [
    { provider: 'missing', model: 'deepseek-chat' },
    { provider: 'deepseek', model: 'missing' },
    { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
  ];
  for (const [index, selection] of cases.entries()) {
    await t.test(`invalid selection ${index + 1}`, async () => {
      const { adapter, selections } = setup();
      await assert.rejects(
        adapter['model.select']({ sessionId: 's1', workspaceId: 'ws-1', ...selection }, {
          signal: context.signal,
          requestId: `invalid-model-${index}`,
        }),
        { code: 'model_unavailable' },
      );
      assert.equal(selections.length, 0);
    });
  }
});

test('migration-required selection fails closed before resolving an Agent', async () => {
  const { adapter, calls, selections } = setup({
    projections: async () => ({
      kind: 'migration-required',
      values: { modelSelection: { lastUsed: defaultSelection, next: defaultSelection } },
    }),
  });
  await assert.rejects(
    adapter['model.select']({
      sessionId: 's1', workspaceId: 'ws-1', provider: 'deepseek', model: 'deepseek-reasoner',
    }, { signal: context.signal, requestId: 'migration-1' }),
    { code: 'session_migration_required' },
  );
  assert.equal(calls.includes('resolveAgent'), false);
  assert.equal(selections.length, 0);
});

test('a held Session writer maps to conflict without selecting', async () => {
  const { adapter, selections } = setup({
    resolveAgent: async () => ({ error: { code: 'session/writer-held', message: 'another writer holds the Session' } }),
  });
  await assert.rejects(
    adapter['model.select']({
      sessionId: 's1', workspaceId: 'ws-1', provider: 'deepseek', model: 'deepseek-chat',
    }, { signal: context.signal, requestId: 'held-1' }),
    { code: 'conflict' },
  );
  assert.equal(selections.length, 0);
});

test('prompt admission and model selection are serialized per Session', async () => {
  let releasePrompt: (() => void) | undefined;
  const promptGate = new Promise<void>((resolve) => { releasePrompt = resolve; });
  const { adapter, calls, selections } = setup({
    prompt: async () => {
      calls.push('prompt:start');
      await promptGate;
      calls.push('prompt:end');
      return { accepted: true as const };
    },
  });
  const prompting = adapter.prompt({
    sessionId: 's1', workspaceId: 'ws-1', content: [{ type: 'text', text: 'image admission placeholder' }],
  }, { signal: context.signal, requestId: 'prompt-before-model' });
  for (let index = 0; index < 10 && !calls.includes('prompt:start'); index += 1) await new Promise(setImmediate);
  const selecting = adapter['model.select']({
    sessionId: 's1', workspaceId: 'ws-1', provider: 'deepseek', model: 'deepseek-reasoner',
  }, { signal: context.signal, requestId: 'model-after-prompt' });
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.equal(calls.includes('resolveAgent'), false);
  assert.ok(releasePrompt);
  releasePrompt();
  await Promise.all([prompting, selecting]);
  assert.ok(calls.indexOf('prompt:end') < calls.indexOf('resolveAgent'));
  assert.equal(selections.length, 1);
});

test('model commands reject unknown params before Host access', async () => {
  const { adapter, calls } = setup();
  await assert.rejects(
    adapter['model.catalog']({ sessionId: 's1', workspaceId: 'ws-1', persistDefault: false } as unknown as {
      sessionId: string;
      workspaceId: string;
    }, { signal: context.signal }),
    { code: 'invalid_request' },
  );
  assert.equal(calls.length, 0);
});
