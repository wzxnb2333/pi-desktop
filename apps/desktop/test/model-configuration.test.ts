import assert from 'node:assert/strict';
import test from 'node:test';
import { modelCatalog } from '../src/main/model-catalog.ts';
import { modelCatalogSchema, providerSchema, requestSchema } from '../src/shared/contracts.ts';
import {
  builtinConnection, connectionMode, connectionValues, convertEndpointOverride, customConnection,
  validateModelConfiguration,
} from '../src/shared/model-configuration.ts';
import { allowedThinkingLevels, resolveThinkingLevel } from '../src/shared/thinking.ts';

const catalog = modelCatalog();
const provider = providerSchema.parse({ id: 'configured-model', name: '测试模型', ...builtinConnection(catalog) });

test('the offline catalog exposes model definitions without credentials or endpoints', () => {
  assert.deepEqual(modelCatalogSchema.parse(catalog), catalog);
  assert.ok(catalog.length > 0);
  assert.ok(catalog.every(({ models }) => models.length > 0));
  assert.ok(catalog.find(({ id }) => id === 'opencode-go')?.models.some(({ id }) => id === 'deepseek-v4.1-flash'));
  for (const item of catalog.flatMap(({ models }) => models))
    assert.deepEqual(Object.keys(item).sort(), ['api', 'contextWindow', 'id', 'imageInput', 'maxTokens', 'name', 'reasoning', 'thinkingLevels']);
  assert.ok(catalog.flatMap(({ models }) => models).every(item => typeof item.imageInput === 'boolean'));
  assert.deepEqual(requestSchema.parse({ op: 'models.catalog' }), { op: 'models.catalog' });
});

test('a built-in selection couples provider and model, resets the endpoint, and uses real capabilities', () => {
  const values = builtinConnection(catalog, 'opencode-go', 'deepseek-v4.1-flash');
  const model = catalog.find(({ id }) => id === values.provider)?.models.find(({ id }) => id === values.model);
  assert.ok(model);
  assert.equal(values.custom, false);
  assert.equal(values.baseUrl, '');
  assert.equal(values.contextWindow, model.contextWindow);
  assert.equal(values.maxTokens, model.maxTokens);
  assert.equal(values.api, model.api);
  assert.deepEqual(values.thinkingLevels, model.thinkingLevels);
  assert.doesNotThrow(() => validateModelConfiguration({ ...provider, ...values }, catalog, 'builtin'));
  assert.throws(() => validateModelConfiguration({ ...provider, model: 'deepseek-flash' }, catalog, 'builtin'), /不在该供应商/);
});

test('new custom connections have a stable independent namespace and never query the built-in catalog', () => {
  const values = customConnection(provider.id);
  assert.deepEqual(values, customConnection(provider.id));
  assert.notEqual(values.provider, customConnection('another-model').provider);
  const custom = { ...provider, ...values, model: 'deepseek-flash', baseUrl: 'http://127.0.0.1:9876/v1' };
  assert.equal(connectionMode(custom), 'custom');
  assert.doesNotThrow(() => validateModelConfiguration(custom, null, 'custom'));
  for (const url of ['', 'api.example.com', 'file:///tmp/model', 'https://key:secret@example.com'])
    assert.throws(() => validateModelConfiguration({ ...custom, baseUrl: url }, null, 'custom'), /Base URL/);
  assert.throws(() => validateModelConfiguration({ ...custom, maxTokens: 0 }, null, 'custom'), /最大输出/);
  assert.throws(() => validateModelConfiguration({ ...custom, contextWindow: 1.5 }, null, 'custom'), /上下文窗口/);
});

test('legacy endpoint overrides remain intact until explicitly converted using real model metadata', () => {
  const legacy = { ...provider, api: 'anthropic-messages' as const, baseUrl: 'http://localhost:9876/v1' };
  const original = structuredClone(legacy);
  assert.equal(connectionMode(legacy), 'custom');
  assert.doesNotThrow(() => validateModelConfiguration(legacy, catalog, 'custom'));
  const converted = convertEndpointOverride(legacy, catalog);
  assert.equal(converted.baseUrl, legacy.baseUrl);
  assert.equal(converted.model, legacy.model);
  assert.equal(converted.custom, true);
  assert.equal(converted.api, provider.api);
  assert.deepEqual(legacy, original);
  assert.throws(() => convertEndpointOverride({ ...legacy, model: 'missing' }, catalog), /不能自动转换/);
  assert.throws(() => validateModelConfiguration({ ...legacy, baseUrl: '' }, catalog, 'custom'), /Base URL/);
});

test('connection drafts exclude shared record identity, display name and encrypted-key state', () => {
  const values = connectionValues(provider);
  assert.ok(!('id' in values));
  assert.ok(!('name' in values));
  assert.ok(!('hasKey' in values));
  assert.deepEqual({ ...provider, ...values }, provider);
  assert.throws(() => validateModelConfiguration(provider, null, 'builtin'), /尚未加载/);
});

test('custom reasoning levels include low, high, xhigh and max and survive validation and drafts', () => {
  const custom = providerSchema.parse({ ...provider, ...customConnection(provider.id), reasoning: true,
    model: 'reasoner', baseUrl: 'http://localhost:9876/v1' });
  assert.deepEqual(allowedThinkingLevels(custom), ['low', 'high', 'xhigh', 'max']);
  assert.deepEqual(connectionValues(custom).thinkingLevels, custom.thinkingLevels);
  assert.doesNotThrow(() => validateModelConfiguration(custom, null, 'custom'));
  assert.deepEqual(requestSchema.parse({ op: 'thread.update', id: 'task', thinking: 'max' }),
    { op: 'thread.update', id: 'task', thinking: 'max' });
  assert.throws(() => providerSchema.parse({ ...custom, thinkingLevels: [] }));
  assert.throws(() => providerSchema.parse({ ...custom, thinkingLevels: ['ultra'] }));
  assert.throws(() => validateModelConfiguration({ ...custom, thinkingLevels: [] }, null, 'custom'), /至少选择/);
});

test('model switches and removed levels resolve to an allowed level without changing valid selections', () => {
  const custom = { ...provider, ...customConnection(provider.id), reasoning: true };
  for (const level of ['low', 'high', 'xhigh', 'max'] as const)
    assert.equal(resolveThinkingLevel(custom, level), level);
  assert.equal(resolveThinkingLevel(custom, 'medium'), 'high');
  assert.equal(resolveThinkingLevel(custom, 'off'), 'low');
  assert.equal(resolveThinkingLevel({ ...custom, thinkingLevels: ['low', 'high'] }, 'max'), 'high');
  assert.deepEqual(allowedThinkingLevels({ ...custom, reasoning: false }), ['off']);
  assert.equal(resolveThinkingLevel({ ...custom, reasoning: false }, 'max'), 'off');
  assert.deepEqual(allowedThinkingLevels({ ...custom, thinkingLevels: undefined }), ['off', 'minimal', 'low', 'medium', 'high']);
  assert.deepEqual(allowedThinkingLevels({ ...custom, thinkingLevels: ['max', 'low', 'low'] }), ['low', 'max']);
});

test('built-in models reject reasoning levels absent from their actual SDK capabilities', () => {
  assert.deepEqual(provider.thinkingLevels, ['off']);
  assert.throws(() => validateModelConfiguration({ ...provider, thinkingLevels: ['max'] }, catalog, 'builtin'), /支持的范围/);
  assert.ok(catalog.some(({ models }) => models.some(({ thinkingLevels }) => thinkingLevels.includes('xhigh'))));
  assert.ok(catalog.some(({ models }) => models.some(({ thinkingLevels }) => thinkingLevels.includes('max'))));
});
