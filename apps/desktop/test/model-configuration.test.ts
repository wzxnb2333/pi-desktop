import assert from 'node:assert/strict';
import test from 'node:test';
import { modelCatalog } from '../src/main/model-catalog.ts';
import { modelCatalogSchema, modelProviderSchema, providerModelSchema, requestSchema } from '../src/shared/contracts.ts';
import {
  builtinProvider, catalogProvider, customModel, customProvider, modelFromCatalog, validateModel, validateProvider,
} from '../src/shared/model-configuration.ts';
import { allowedThinkingLevels, resolveThinkingLevel } from '../src/shared/thinking.ts';

const catalog = modelCatalog();
const namespace = catalog[0].id;

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

test('a built-in provider keeps its catalog namespace and validates models against real capabilities', () => {
  const provider = builtinProvider('provider-1', namespace);
  assert.equal(provider.kind, 'builtin');
  assert.equal(provider.namespace, namespace);
  assert.doesNotThrow(() => validateProvider(provider, catalog));
  const limited = catalogProvider(catalog, namespace)?.models.find(item => !item.thinkingLevels.includes('max'));
  assert.ok(limited);
  const model = modelFromCatalog(provider.id, limited);
  assert.equal(model.provider, provider.id);
  assert.equal(model.model, limited.id);
  assert.equal(model.name, limited.name);
  assert.equal(model.contextWindow, limited.contextWindow);
  assert.equal(model.maxTokens, limited.maxTokens);
  assert.deepEqual(model.thinkingLevels, limited.thinkingLevels);
  assert.ok(!('hasKey' in model));
  assert.doesNotThrow(() => validateModel(model, provider, catalog));
  // The catalogue's levels seed the model; the user may add levels the pinned catalogue does not list.
  assert.doesNotThrow(() => validateModel({ ...model, thinkingLevels: ['max'] }, provider, catalog));
  assert.throws(() => validateModel({ ...model, model: 'not-in-catalog' }, provider, catalog), /不在该提供商/);
  assert.throws(() => validateProvider({ ...provider, namespace: 'missing' }, catalog), /内置供应商已不存在/);
  assert.throws(() => validateProvider(provider, null), /尚未加载/);
  assert.throws(() => validateModel(model, provider, null), /尚未加载/);
});

test('a custom provider owns one endpoint, one protocol and a namespace derived from its id', () => {
  const provider = customProvider('custom-1', '本地中转');
  assert.equal(provider.kind, 'custom');
  assert.equal(provider.namespace, 'desktop-custom-1');
  assert.notEqual(customProvider('custom-2', '另一个').namespace, provider.namespace);
  assert.throws(() => validateProvider(provider, null), /接口服务地址/);
  for (const url of ['api.example.com', 'file:///tmp/model', 'https://key:secret@example.com'])
    assert.throws(() => validateProvider({ ...provider, baseUrl: url }, null), /Base URL/);
  const ready = { ...provider, baseUrl: 'http://127.0.0.1:9876/v1' };
  assert.doesNotThrow(() => validateProvider(ready, null));
  const model = customModel(provider.id, 'deepseek-flash');
  assert.equal(model.provider, provider.id);
  assert.equal(model.model, 'deepseek-flash');
  assert.deepEqual(model.thinkingLevels, ['low', 'high', 'xhigh', 'max']);
  assert.doesNotThrow(() => validateModel(model, ready, null));
  assert.throws(() => validateModel({ ...model, maxTokens: 0 }, ready, null), /最大输出/);
  assert.throws(() => validateModel({ ...model, contextWindow: 1.5 }, ready, null), /上下文窗口/);
  assert.throws(() => validateModel(model, undefined, null), /所属提供商已不存在/);
});

test('a built-in provider may override its endpoint without becoming a custom provider', () => {
  const provider = { ...builtinProvider('provider-1', namespace), baseUrl: 'http://localhost:9876/v1' };
  assert.equal(provider.kind, 'builtin');
  assert.doesNotThrow(() => validateProvider(provider, catalog));
  assert.throws(() => validateProvider({ ...provider, baseUrl: 'file:///tmp/model' }, catalog), /Base URL/);
  assert.throws(() => validateProvider({ ...provider, name: '   ' }, catalog), /显示名称/);
});

test('providers and models are separate records with strict schemas', () => {
  assert.deepEqual(modelProviderSchema.parse({ id: 'provider-1', name: 'OpenAI', namespace: 'openai' }),
    { id: 'provider-1', name: 'OpenAI', kind: 'builtin', namespace: 'openai', baseUrl: '', api: 'openai-completions', hasKey: false, authMethod: 'api_key' });
  assert.throws(() => modelProviderSchema.parse({ id: 'provider-1', name: 'OpenAI', namespace: 'openai', model: 'gpt-4.1' }));
  const model = { id: 'model-1', provider: 'provider-1', name: '测试模型', model: 'gpt-4.1' };
  assert.equal(providerModelSchema.parse(model).contextWindow, 128000);
  assert.throws(() => providerModelSchema.parse({ ...model, thinkingLevels: [] }));
  assert.throws(() => providerModelSchema.parse({ ...model, thinkingLevels: ['ultra'] }));
  assert.throws(() => providerModelSchema.parse({ ...model, hasKey: true }));
  assert.deepEqual(requestSchema.parse({ op: 'thread.update', id: 'task', modelId: 'model-1' }),
    { op: 'thread.update', id: 'task', modelId: 'model-1' });
  assert.throws(() => requestSchema.parse({ op: 'thread.update', id: 'task', providerId: 'model-1' }));
});

test('reasoning levels come from the model, not from the connection', () => {
  const provider = { ...customProvider('custom-1', '本地中转'), baseUrl: 'http://localhost:9876/v1' };
  const model = customModel(provider.id, 'reasoner');
  assert.deepEqual(allowedThinkingLevels(model), ['low', 'high', 'xhigh', 'max']);
  for (const level of ['low', 'high', 'xhigh', 'max'] as const)
    assert.equal(resolveThinkingLevel(model, level), level);
  assert.equal(resolveThinkingLevel(model, 'medium'), 'high');
  assert.equal(resolveThinkingLevel(model, 'off'), 'low');
  assert.equal(resolveThinkingLevel({ ...model, thinkingLevels: ['low', 'high'] }, 'max'), 'high');
  assert.deepEqual(allowedThinkingLevels({ ...model, reasoning: false }), ['off']);
  assert.equal(resolveThinkingLevel({ ...model, reasoning: false }, 'max'), 'off');
  assert.deepEqual(allowedThinkingLevels({ ...model, thinkingLevels: undefined }), ['off', 'minimal', 'low', 'medium', 'high']);
  assert.deepEqual(allowedThinkingLevels({ ...model, thinkingLevels: ['max', 'low', 'low'] }), ['low', 'max']);
  assert.equal(resolveThinkingLevel(undefined, 'max'), 'max');
  assert.throws(() => validateModel({ ...model, thinkingLevels: [] }, provider, null), /至少选择/);
  assert.ok(catalog.some(({ models }) => models.some(({ thinkingLevels }) => thinkingLevels.includes('xhigh'))));
  assert.ok(catalog.some(({ models }) => models.some(({ thinkingLevels }) => thinkingLevels.includes('max'))));
});
