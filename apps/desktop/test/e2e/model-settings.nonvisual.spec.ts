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
  await expect(fixture.page.getByRole('radio', { name: '自定义接口', exact: true })).toBeChecked();
  await expect(fixture.page.getByLabel('Base URL', { exact: true })).toHaveValue(fixture.url + '/v1');
  await fixture.page.getByRole('radio', { name: '内置供应商', exact: true }).check();
  await fixture.page.getByLabel('供应商', { exact: true }).selectOption('opencode-go');
  await fixture.page.getByLabel('内置模型', { exact: true }).selectOption('deepseek-v4.1-flash');
  await expect(fixture.page.getByLabel('Base URL', { exact: true })).toHaveCount(0);
  await fixture.page.getByRole('button', { name: '保存设置' }).click();
  await expect(fixture.page.getByRole('status')).toHaveText('设置已保存');
  expect((await fixture.snapshot()).data.settings.providers[0]).toMatchObject({
    id: 'local', custom: false, provider: 'opencode-go', model: 'deepseek-v4.1-flash', baseUrl: '',
  });
  expect(fixture.calls).toHaveLength(0);
  await fixture.restart();
  await fixture.page.keyboard.press('Control+,');
  await expect(fixture.page.getByRole('radio', { name: '内置供应商', exact: true })).toBeChecked();
  await expect(fixture.page.getByLabel('内置模型', { exact: true })).toHaveValue('deepseek-v4.1-flash');
  await fixture.page.getByRole('radio', { name: '自定义接口', exact: true }).check();
  await fixture.page.getByLabel('Base URL', { exact: true }).fill(fixture.url + '/v1');
  await fixture.page.getByLabel('模型 ID', { exact: true }).fill('acceptance');
  await fixture.page.getByLabel(/^API Key/).fill('model-settings-fake-key');
  await fixture.page.getByRole('button', { name: '保存设置' }).click();
  await expect(fixture.page.getByRole('status')).toHaveText('设置已保存');
  expect((await fixture.snapshot()).data.settings.providers[0]).toMatchObject({
    id: 'local', custom: true, provider: 'desktop-local', model: 'acceptance', baseUrl: fixture.url + '/v1', hasKey: true,
  });
  expect(await readFile(join(fixture.storage, 'secrets.json'), 'utf8')).not.toContain('model-settings-fake-key');
  await fixture.restart();
  await fixture.page.keyboard.press('Control+,');
  await expect(fixture.page.getByRole('radio', { name: '自定义接口', exact: true })).toBeChecked();
  await expect(fixture.page.getByLabel('Base URL', { exact: true })).toHaveValue(fixture.url + '/v1');
  await expect(fixture.page.getByLabel('模型 ID', { exact: true })).toHaveValue('acceptance');
  await expect(fixture.page.getByLabel(/^API Key/)).toHaveValue('');
  await expect(fixture.page.getByLabel('供应商', { exact: true })).toHaveCount(0);
  await fixture.page.getByRole('button', { name: '返回工作台' }).click();
  await fixture.invoke({ op: 'thread.send', id: 't', text: '验证自定义连接', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  expect((await fixture.snapshot()).data.threads[0].items.some((item) => item.role === 'assistant' && item.text.includes('验收回复完成'))).toBe(true);
});

test('allowed thinking levels reach the provider and persist through model changes and Electron restart', async () => {
  await fixture.page.keyboard.press('Control+,');
  await fixture.page.locator('.connection-advanced summary').click();
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
  expect((await fixture.snapshot()).data.settings.providers[0].thinkingLevels).toEqual(levels);
  await expect(fixture.page.getByLabel('模型与能力', { exact: true })).toContainText('最高');
  await fixture.page.getByLabel('向 Pi 发送消息').fill('重启后继续最高程度');
  await fixture.page.getByLabel('发送消息', { exact: true }).click();
  await expect.poll(() => fixture.calls.length).toBe(5);
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  expect(fixture.calls[4].reasoning_effort).toBe('max');
  await fixture.page.keyboard.press('Control+,');
  for (const level of ['low', 'xhigh', 'max'])
    await fixture.page.getByRole('checkbox', { name: levelNames[level], exact: true }).uncheck();
  await fixture.page.getByRole('button', { name: '保存设置' }).click();
  await expect(fixture.page.getByRole('status')).toHaveText('设置已保存');
  expect((await fixture.snapshot()).data.threads[0].thinking).toBe('high');
  await expect(fixture.invoke({ op: 'thread.update', id: 't', thinking: 'max' })).rejects.toThrow('未允许');
  await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false });
  expect((await fixture.snapshot()).data.threads.every((thread) => thread.thinking === 'high')).toBe(true);
  const { settings } = (await fixture.snapshot()).data;
  settings.providers.push({ ...settings.providers[0], id: 'low-only', name: '低档模型', thinkingLevels: ['low'] });
  await fixture.invoke({ op: 'settings.save', settings });
  await fixture.invoke({ op: 'thread.update', id: 't', providerId: 'low-only' });
  expect((await fixture.snapshot()).data.threads.find(({ id }) => id === 't')?.thinking).toBe('low');
  await fixture.invoke({ op: 'thread.update', id: 't', providerId: 'local' });
  expect((await fixture.snapshot()).data.threads.find(({ id }) => id === 't')?.thinking).toBe('high');
  settings.providers[0].reasoning = false;
  await fixture.invoke({ op: 'settings.save', settings });
  expect((await fixture.snapshot()).data.threads.find(({ id }) => id === 't')?.thinking).toBe('off');
});

test('model switch is announced once at the first following conversation', async () => {
  const snapshot = await fixture.snapshot();
  const settings = structuredClone(snapshot.data.settings);
  settings.providers.push({ ...settings.providers[0], id: 'local-2', name: '第二验收模型', model: 'acceptance-2' });
  await fixture.invoke({ op: 'settings.save', settings });
  await fixture.invoke({ op: 'thread.update', id: 't', providerId: 'local-2' });
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
