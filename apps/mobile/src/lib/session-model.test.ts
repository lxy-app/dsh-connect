import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isModelSelectionEvent,
  isUncertainModelSelectionError,
  modelBadgeText,
  modelLabel,
  sameModelSelection,
  selectionForRoute,
  selectionInCatalog,
} from './session-model';
import type { MobileSessionModelCatalog } from '@/types/mobile';

const catalog: MobileSessionModelCatalog = {
  sessionId: 's1',
  deviceId: 'dev-1',
  workspaceId: 'ws-1',
  default: { provider: 'deepseek', model: 'chat' },
  lastUsed: null,
  next: null,
  effective: { provider: 'deepseek', model: 'chat' },
  routableProviders: ['deepseek', 'other'],
  groups: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      models: [
        { id: 'chat', name: 'DeepSeek Chat' },
        {
          id: 'reasoner',
          name: 'DeepSeek Reasoner',
          reasoning: {
            efforts: [{ id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }],
            defaultEffort: 'medium',
          },
        },
      ],
    },
    {
      id: 'other',
      name: 'Other',
      models: [{
        id: 'advanced',
        name: 'Advanced',
        reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
      }],
    },
  ],
  failures: [],
  projectionKind: 'sequenced',
};

test('selection comparison includes reasoning effort', () => {
  assert.equal(sameModelSelection(
    { provider: 'deepseek', model: 'reasoner', reasoningEffort: 'high' },
    { provider: 'deepseek', model: 'reasoner', reasoningEffort: 'high' },
  ), true);
  assert.equal(sameModelSelection(
    { provider: 'deepseek', model: 'reasoner', reasoningEffort: 'high' },
    { provider: 'deepseek', model: 'reasoner' },
  ), false);
});

test('selection availability checks route and explicit effort', () => {
  assert.equal(selectionInCatalog(catalog, { provider: 'deepseek', model: 'reasoner', reasoningEffort: 'high' }), true);
  assert.equal(selectionInCatalog(catalog, { provider: 'deepseek', model: 'reasoner', reasoningEffort: 'low' }), false);
  assert.equal(selectionInCatalog(catalog, { provider: 'deepseek', model: 'chat', reasoningEffort: 'high' }), false);
  assert.equal(selectionInCatalog(catalog, { provider: 'missing', model: 'reasoner' }), false);
});

test('route selection retains supported effort and falls back to the target default', () => {
  assert.deepEqual(
    selectionForRoute(catalog, { provider: 'deepseek', model: 'reasoner', reasoningEffort: 'high' }, {
      provider: 'other', model: 'advanced',
    }),
    { provider: 'other', model: 'advanced', reasoningEffort: 'high' },
  );
  assert.deepEqual(
    selectionForRoute(catalog, { provider: 'deepseek', model: 'chat' }, { provider: 'deepseek', model: 'reasoner' }),
    { provider: 'deepseek', model: 'reasoner', reasoningEffort: 'medium' },
  );
  assert.deepEqual(
    selectionForRoute(catalog, { provider: 'deepseek', model: 'reasoner', reasoningEffort: 'high' }, {
      provider: 'deepseek', model: 'chat',
    }),
    { provider: 'deepseek', model: 'chat' },
  );
  assert.equal(selectionForRoute(catalog, catalog.effective, { provider: 'missing', model: 'none' }), null);
  assert.equal(selectionForRoute(catalog, catalog.effective, { provider: 'deepseek', model: 'reasoner' }, 'low'), null);
});

test('labels and badges remain display-safe with route fallback', () => {
  assert.equal(modelLabel(catalog, { provider: 'deepseek', model: 'reasoner' }), 'DeepSeek Reasoner');
  assert.equal(modelLabel(catalog, { provider: 'missing', model: 'custom' }), 'missing/custom');
  assert.equal(modelBadgeText({ en: 'Reasoning', 'zh-CN': '推理' }), '推理');
  assert.equal(modelBadgeText('Recommended'), 'Recommended');
});

test('uncertain failures retain a model request while definite failures do not', () => {
  assert.equal(isUncertainModelSelectionError({ code: 'command_timeout', retryable: false }), true);
  assert.equal(isUncertainModelSelectionError({ code: 'network_error', retryable: true }), true);
  assert.equal(isUncertainModelSelectionError({ code: 'internal_error', retryable: true }), true);
  assert.equal(isUncertainModelSelectionError({ code: 'model_unavailable', retryable: false }), false);
  assert.equal(isUncertainModelSelectionError(new Error('programming failure')), false);
});

test('only durable model selection events trigger model refresh', () => {
  assert.equal(isModelSelectionEvent({ type: 'model/selection', provider: 'deepseek', model: 'chat' }), true);
  assert.equal(isModelSelectionEvent({ type: 'assistant/message' }), false);
  assert.equal(isModelSelectionEvent(null), false);
});
