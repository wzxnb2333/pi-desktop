import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
const levelNames: Record<string, string> = { off: '关闭思考', minimal: '极低', low: '低', medium: '中等', high: '高', xhigh: '极高', max: '最高' };
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => {
  if (!fixture) return;
  const errors = [...fixture.errors];
  await fixture.close();
  expect(errors).toEqual([]);
});

test('exclusive connection modes persist across Electron restarts and reach only the fake provider', async () => {
  await fixture.page.keyboard.press('Control+,');
  // The fixture provider points at the loopback server, so its connection shows an endpoint and no catalog namespace.
  await expect(fixture.page.getByLabel('Base URL', { exact: true })).toHaveValue(fixture.url + '/v1');
  await expect(fixture.page.getByLabel('供应商', { exact: true })).toHaveCount(0);
  // A built-in provider keeps a Pi catalog namespace instead of an endpoint, and its models come from that catalog.
  await fixture.page.getByRole('button', { name: '添加提供商' }).click();
  await fixture.page.getByLabel('供应商', { exact: true }).click();
  await fixture.page.getByRole('menuitemradio', { name: 'opencode-go', exact: true }).click();
  await fixture.page.getByRole('button', { name: '创建提供商' }).click();
  await fixture.page.getByRole('button', { name: '添加模型' }).click();
  await fixture.page.locator('.model-catalog-options input[value="deepseek-v4.1-flash"]').check();
  await fixture.page.getByRole('button', { name: '添加所选模型' }).click();
  await fixture.page.getByRole('button', { name: '保存设置' }).click();
  await expect(fixture.page.getByRole('status')).toHaveText('设置已保存');
  const builtin = (await fixture.snapshot()).data.settings;
  expect(builtin.modelProviders.at(-1)).toMatchObject({ kind: 'builtin', namespace: 'opencode-go', baseUrl: '' });
  expect(builtin.models.at(-1)).toMatchObject({ provider: builtin.modelProviders.at(-1)?.id, model: 'deepseek-v4.1-flash' });
  expect(fixture.calls).toHaveLength(0);
  await fixture.restart();
  await fixture.page.keyboard.press('Control+,');
  await fixture.page.getByRole('tab', { name: 'opencode-go' }).click();
  await expect(fixture.page.getByLabel('供应商', { exact: true })).toContainText('opencode-go');
  // A built-in connection keeps its optional endpoint override collapsed, so the field is hidden.
  await expect(fixture.page.getByLabel('Base URL', { exact: true })).toBeHidden();
  await expect(fixture.page.locator('.model-row-id')).toHaveText('deepseek-v4.1-flash');
  // The custom connection keeps its endpoint, protocol and credential across restarts.
  await fixture.page.getByRole('tab', { name: '验收模型' }).click();
  await fixture.page.getByLabel('Base URL', { exact: true }).fill(fixture.url + '/v1');
  await fixture.page.locator('.model-row-toggle').first().click();
  await fixture.page.getByLabel('模型 ID', { exact: true }).fill('acceptance');
  await fixture.page.getByLabel(/^API Key/).fill('model-settings-fake-key');
  await fixture.page.getByRole('button', { name: '保存设置' }).click();
  await expect(fixture.page.getByRole('status')).toHaveText('设置已保存');
  expect((await fixture.snapshot()).data.settings.modelProviders[0]).toMatchObject({
    id: 'local-provider', kind: 'custom', namespace: 'desktop-local-provider', baseUrl: fixture.url + '/v1', hasKey: true,
  });
  expect((await fixture.snapshot()).data.settings.models[0]).toMatchObject({
    id: 'local', provider: 'local-provider', model: 'acceptance',
  });
  expect(await readFile(join(fixture.storage, 'secrets.json'), 'utf8')).not.toContain('model-settings-fake-key');
  await fixture.restart();
  await fixture.page.keyboard.press('Control+,');
  await expect(fixture.page.getByLabel('Base URL', { exact: true })).toHaveValue(fixture.url + '/v1');
  await expect(fixture.page.getByLabel('供应商', { exact: true })).toHaveCount(0);
  await fixture.page.locator('.model-row-toggle').first().click();
  await expect(fixture.page.getByLabel('模型 ID', { exact: true })).toHaveValue('acceptance');
  await expect(fixture.page.getByLabel(/^API Key/)).toHaveValue('');
  await fixture.page.getByRole('button', { name: '返回工作台' }).click();
  await fixture.invoke({ op: 'thread.send', id: 't', text: '验证自定义连接', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  expect((await fixture.snapshot()).data.threads[0].items.some((item) => item.role === 'assistant' && item.text.includes('验收回复完成'))).toBe(true);
});

test('allowed thinking levels reach the provider and persist through model changes and Electron restart', async () => {
  await fixture.page.keyboard.press('Control+,');
  // Model capabilities live under the provider: open its model to allow the reasoning levels.
  await fixture.page.locator('.model-row-toggle').first().click();
  await fixture.page.getByRole('checkbox', { name: /^支持思考/ }).check();
  const levels = ['low', 'high', 'xhigh', 'max'] as const;
  for (const level of ['off', 'minimal', 'medium'])
    await fixture.page.getByRole('checkbox', { name: levelNames[level], exact: true }).uncheck();
  for (const level of levels)
    await fixture.page.getByRole('checkbox', { name: levelNames[level], exact: true }).check();
  await fixture.page.getByRole('button', { name: '保存设置' }).click();
  await expect(fixture.page.getByRole('status')).toHaveText('设置已保存');
  await fixture.page.getByRole('button', { name: '返回工作台' }).click();
  expect((await fixture.snapshot()).data.threads[0].thinking).toBe('low');
  const labels = ['低', '高', '极高', '最高'];
  for (const [index, level] of levels.entries()) {
    await fixture.page.getByLabel('模型与能力', { exact: true }).click();
    const slider = fixture.page.getByRole('slider', { name: '思考级别', exact: true });
    await expect(slider).toHaveAttribute('max', '3');
    await slider.press('Home'); await expect(slider).toHaveValue('0');
    for (let step = 1; step <= index; step++) { await slider.press('ArrowRight'); await expect(slider).toHaveValue(String(step)); }
    await expect(slider).toHaveAttribute('aria-valuetext', labels[index]);
    await slider.press('Escape');
    await expect(fixture.page.getByLabel('模型与能力', { exact: true })).toBeFocused();
    await expect.poll(async () => (await fixture.snapshot()).data.threads[0].thinking).toBe(level);
    await fixture.page.getByLabel('向 Pi 发送消息').fill('验证思考程度 ' + level);
    await fixture.page.getByLabel('发送消息', { exact: true }).click();
    await expect.poll(() => fixture.calls.length).toBe(index + 1);
    await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
    expect(fixture.calls[index].reasoning_effort).toBe(level);
  }
  await fixture.restart();
  expect((await fixture.snapshot()).data.threads[0].thinking).toBe('max');
  expect((await fixture.snapshot()).data.settings.models[0].thinkingLevels).toEqual(levels);
  await expect(fixture.page.getByLabel('模型与能力', { exact: true })).toContainText('最高');
  await fixture.page.getByLabel('向 Pi 发送消息').fill('重启后继续最高程度');
  await fixture.page.getByLabel('发送消息', { exact: true }).click();
  await expect.poll(() => fixture.calls.length).toBe(5);
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  expect(fixture.calls[4].reasoning_effort).toBe('max');
  await fixture.page.keyboard.press('Control+,');
  await fixture.page.locator('.model-row-toggle').first().click();
  for (const level of ['low', 'xhigh', 'max'])
    await fixture.page.getByRole('checkbox', { name: levelNames[level], exact: true }).uncheck();
  await fixture.page.getByRole('button', { name: '保存设置' }).click();
  await expect(fixture.page.getByRole('status')).toHaveText('设置已保存');
  expect((await fixture.snapshot()).data.threads[0].thinking).toBe('high');
  await expect(fixture.invoke({ op: 'thread.update', id: 't', thinking: 'max' })).rejects.toThrow('未允许');
  await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false });
  expect((await fixture.snapshot()).data.threads.every((thread) => thread.thinking === 'high')).toBe(true);
  const { settings } = (await fixture.snapshot()).data;
  settings.models.push({ ...settings.models[0], id: 'low-only', name: '低档模型', thinkingLevels: ['low'] });
  await fixture.invoke({ op: 'settings.save', settings });
  await fixture.invoke({ op: 'thread.update', id: 't', modelId: 'low-only' });
  expect((await fixture.snapshot()).data.threads.find(({ id }) => id === 't')?.thinking).toBe('low');
  await fixture.invoke({ op: 'thread.update', id: 't', modelId: 'local' });
  expect((await fixture.snapshot()).data.threads.find(({ id }) => id === 't')?.thinking).toBe('high');
  settings.models[0].reasoning = false;
  await fixture.invoke({ op: 'settings.save', settings });
  expect((await fixture.snapshot()).data.threads.find(({ id }) => id === 't')?.thinking).toBe('off');
});

test('model switch is announced once at the first following conversation', async () => {
  const snapshot = await fixture.snapshot();
  const settings = structuredClone(snapshot.data.settings);
  settings.models.push({ ...settings.models[0], id: 'local-2', name: '第二验收模型', model: 'acceptance-2' });
  await fixture.invoke({ op: 'settings.save', settings });
  await fixture.invoke({ op: 'thread.update', id: 't', modelId: 'local-2' });
  expect((await fixture.snapshot()).data.threads[0].modelSwitchNotice).toEqual({ from: '验收模型', to: '第二验收模型' });

  await fixture.invoke({ op: 'thread.send', id: 't', text: '第一次使用新模型', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  const first = (await fixture.snapshot()).data.threads[0];
  const notices = first.items.filter(item => item.noticeKind === 'model-switch');
  expect(notices).toHaveLength(1);
  expect(notices[0].text).toContain('已将模型从 验收模型 切换到 第二验收模型');
  expect(first.modelSwitchNotice).toBeUndefined();

  await fixture.invoke({ op: 'thread.send', id: 't', text: '第二次使用新模型', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(2);
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  expect((await fixture.snapshot()).data.threads[0].items.filter(item => item.noticeKind === 'model-switch')).toHaveLength(1);
});

test('new sessions inherit the fixed defaults while existing sessions keep their own', async () => {
  const seeded = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!;
  expect({ modelId: seeded.modelId, thinking: seeded.thinking, policy: seeded.policy }).toEqual({ modelId: 'local', thinking: 'off', policy: 'auto' });

  // Fix model, reasoning level and approval policy for future sessions in the settings page. The seeded
  // model starts without explicit levels, so give it the one the default uses first.
  const initial = structuredClone((await fixture.snapshot()).data.settings);
  initial.models[0].reasoning = true;
  initial.models[0].thinkingLevels = ['off', 'low', 'high', 'max'];
  await fixture.invoke({ op: 'settings.save', settings: initial });
  await fixture.page.keyboard.press('Control+,');
  await fixture.page.getByRole('button', { name: '模型', exact: true }).click();
  await expect(fixture.page.getByRole('heading', { name: '新会话默认' })).toBeVisible();
  await expect(fixture.page.getByLabel('默认模型', { exact: true })).toContainText('验收模型');
  // The control is the app's own popover, not the operating system's select popup.
  await fixture.page.getByLabel('默认思考程度', { exact: true }).click();
  await fixture.page.getByRole('menuitemradio', { name: '最高', exact: true }).click();
  await expect(fixture.page.getByLabel('默认思考程度', { exact: true })).toContainText('最高');
  await fixture.page.getByRole('button', { name: '审批与信任', exact: true }).click();
  await fixture.page.getByLabel('默认审批', { exact: true }).click();
  await fixture.page.getByRole('menuitemradio', { name: '请求批准', exact: true }).click();
  await fixture.page.getByRole('button', { name: '保存设置' }).click();
  await expect(fixture.page.getByRole('status')).toHaveText('设置已保存');

  // A new task starts from those defaults.
  const created = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }) as { id: string; modelId: string; thinking: string; policy: string };
  expect({ modelId: created.modelId, thinking: created.thinking, policy: created.policy }).toEqual({ modelId: 'local', thinking: 'max', policy: 'ask' });
  // A quick chat without a project starts from them too.
  const chat = await fixture.invoke({ op: 'chat.create', requestId: crypto.randomUUID() }) as { thinking: string; policy: string };
  expect({ thinking: chat.thinking, policy: chat.policy }).toEqual({ thinking: 'max', policy: 'ask' });
  // The session that existed before the change keeps its own values.
  const later = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!;
  expect({ modelId: later.modelId, thinking: later.thinking, policy: later.policy }).toEqual({ modelId: 'local', thinking: 'off', policy: 'auto' });
  await fixture.restart();
  const reloaded = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!;
  expect({ thinking: reloaded.thinking, policy: reloaded.policy }).toEqual({ thinking: 'off', policy: 'auto' });
  const defaults = (await fixture.snapshot()).data.settings;
  expect({ modelId: defaults.modelId, thinking: defaults.thinking, policy: defaults.policy }).toEqual({ modelId: 'local', thinking: 'max', policy: 'ask' });
});

test('a built-in catalogue model keeps the reasoning levels the user adds', async () => {
  await fixture.page.keyboard.press('Control+,');
  await fixture.page.getByRole('button', { name: '添加提供商' }).click();
  await fixture.page.getByLabel('供应商', { exact: true }).click();
  await fixture.page.getByRole('menuitemradio', { name: 'opencode-go', exact: true }).click();
  await fixture.page.getByRole('button', { name: '创建提供商' }).click();
  await fixture.page.getByRole('button', { name: '添加模型' }).click();
  await fixture.page.locator('.model-catalog-options input[value="deepseek-v4.1-flash"]').check();
  await fixture.page.getByRole('button', { name: '添加所选模型' }).click();
  await fixture.page.getByRole('button', { name: '保存设置' }).click();
  await expect(fixture.page.getByRole('status')).toHaveText('设置已保存');

  // The catalogue's list is information, not a fence: the page says so, and the save must agree.
  const catalog = await fixture.invoke({ op: 'models.catalog' }) as { id: string; models: { id: string; thinkingLevels: string[] }[] }[];
  const entry = catalog.find(item => item.id === 'opencode-go')!.models.find(item => item.id === 'deepseek-v4.1-flash')!;
  const all = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  const extra = all.filter(level => !entry.thinkingLevels.includes(level));
  expect(extra.length, 'this catalogue entry should not list every level').toBeGreaterThan(0);

  await fixture.page.getByRole('tab', { name: 'opencode-go' }).click();
  // The model panel may still be open from the save above, so only open it when the levels are hidden.
  const openModel = async () => {
    if (!(await fixture.page.locator('.thinking-levels').first().isVisible().catch(() => false)))
      await fixture.page.locator('.model-row-toggle').first().click();
  };
  await openModel();
  for (const level of extra) await fixture.page.getByRole('checkbox', { name: levelNames[level], exact: true }).check();
  await fixture.page.getByRole('button', { name: '保存设置' }).click();
  await expect(fixture.page.getByRole('status')).toHaveText('设置已保存');

  const saved = (await fixture.snapshot()).data.settings.models.find(model => model.model === 'deepseek-v4.1-flash')!;
  for (const level of extra) expect(saved.thinkingLevels).toContain(level);
  // Narrowing is the user's call too: leaving exactly one level must stick instead of snapping back.
  const only = entry.thinkingLevels[0];
  await openModel();
  for (const level of all.filter(level => level !== only))
    await fixture.page.getByRole('checkbox', { name: levelNames[level], exact: true }).uncheck();
  await fixture.page.getByRole('button', { name: '保存设置' }).click();
  await expect(fixture.page.getByRole('status')).toHaveText('设置已保存');
  await fixture.restart();
  const reloaded = (await fixture.snapshot()).data.settings.models.find(model => model.model === 'deepseek-v4.1-flash')!;
  expect(reloaded.thinkingLevels).toEqual([only]);
});
