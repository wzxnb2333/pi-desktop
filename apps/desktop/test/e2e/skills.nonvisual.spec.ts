import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { OpenDialogOptions } from 'electron';
import type { Thread } from '../../src/shared/contracts.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
const content = '---\nname: common-workflow\ndescription: Common workflow test\n---\nCOMMON_SKILL_BODY';

test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => {
  if (fixture) {
    const errors = [...fixture.errors];
    await fixture.close();
    expect(errors).toEqual([]);
  }
});

async function readThroughAgent(path: string) {
  const thread = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }) as Thread;
  const before = fixture.calls.length;
  fixture.requestTool('read', { path });
  await fixture.invoke({ op: 'thread.send', id: thread.id, text: '读取可用的通用 Skill', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(before + 2);
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find((item) => item.id === thread.id)?.status).toBe('idle');
  return fixture.calls.slice(before);
}

async function approveLocalExtension(path: string) {
  await expect.poll(async () => (await fixture.snapshot()).approvals.filter(item => item.scope === 'external-tools').length).toBe(1);
  const approval = (await fixture.snapshot()).approvals.find(item => item.scope === 'external-tools')!;
  expect(approval.description).toBe(path);
  await fixture.invoke({ op: 'approval.reply', id: approval.id, approved: true });
}

test('shared user skills are discovered, readable, disableable and restored after restart', async () => {
  const path = join(fixture.home, '.agents', 'skills', 'common-workflow', 'SKILL.md');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  await fixture.restart();
  await fixture.page.getByRole('button', { name: 'Skills 与扩展', exact: true }).click();
  await expect(fixture.page.getByLabel('启用 common-workflow')).toBeChecked();
  expect((await fixture.snapshot()).data.settings.resources).toHaveLength(1);
  const enabledCalls = await readThroughAgent(path);
  expect(JSON.stringify(enabledCalls[0].messages.filter((message) => message.role === 'system'))).toContain('common-workflow');
  expect(JSON.stringify(enabledCalls[1].messages.filter((message) => message.role === 'tool'))).toContain('COMMON_SKILL_BODY');
  const unrelated = join(fixture.home, 'private.txt');
  await writeFile(unrelated, 'UNRELATED_PRIVATE_BODY');
  const unrelatedCalls = await readThroughAgent(unrelated);
  expect(JSON.stringify(unrelatedCalls[1].messages.filter((message) => message.role === 'tool'))).not.toContain('UNRELATED_PRIVATE_BODY');
  await fixture.page.getByLabel('启用 common-workflow').click();
  await expect.poll(async () => (await fixture.snapshot()).data.settings.resources[0].enabled).toBe(false);
  await fixture.restart();
  await expect(fixture.page.getByLabel('启用 common-workflow')).not.toBeChecked();
  const disabledCalls = await readThroughAgent(path);
  expect(JSON.stringify(disabledCalls[0].messages.filter((message) => message.role === 'system'))).not.toContain('common-workflow');
  expect(JSON.stringify(disabledCalls[1].messages.filter((message) => message.role === 'tool'))).not.toContain('COMMON_SKILL_BODY');
  await fixture.page.getByLabel('启用 common-workflow').click();
  await expect.poll(async () => (await fixture.snapshot()).data.settings.resources[0].enabled).toBe(true);
  expect(JSON.stringify((await readThroughAgent(path))[1].messages)).toContain('COMMON_SKILL_BODY');
});

test('new skills use the shared directory and removal persists without changing shared files', async () => {
  const resource = await fixture.invoke({ op: 'resource.create', name: '通用工作流', content }) as { id: string; path: string };
  expect(dirname(dirname(resource.path))).toBe(join(fixture.home, '.agents', 'skills'));
  expect(await readFile(resource.path, 'utf8')).toBe(content);
  await fixture.page.getByRole('button', { name: 'Skills 与扩展', exact: true }).click();
  await fixture.page.getByLabel('移除 通用工作流').click();
  await expect.poll(async () => (await fixture.snapshot()).data.settings.resources.length).toBe(0);
  await fixture.restart();
  expect((await fixture.snapshot()).data.settings.resources).toHaveLength(0);
  expect((await fixture.snapshot()).data.settings.ignoredSkillPaths).toContain(resource.path);
  expect(await readFile(resource.path, 'utf8')).toBe(content);
  const calls = await readThroughAgent(resource.path);
  expect(JSON.stringify(calls[0].messages.filter((message) => message.role === 'system'))).not.toContain('common-workflow');
  expect(JSON.stringify(calls[1].messages.filter((message) => message.role === 'tool'))).not.toContain('COMMON_SKILL_BODY');
  await fixture.app.evaluate(({ dialog }, values) => {
    dialog.showOpenDialog = async (_window: unknown, options?: OpenDialogOptions) => {
      if (options?.defaultPath !== values.directory) throw new Error('Incorrect default skill picker directory');
      return { canceled: false, filePaths: [values.path] };
    };
  }, { directory: join(fixture.home, '.agents', 'skills'), path: resource.path });
  for (let index = 0; index < 2; index++) {
    await fixture.page.getByRole('button', { name: '导入', exact: true }).click();
    await fixture.page.getByRole('menuitemradio', { name: '导入 SKILL.md' }).click();
    await expect(fixture.page.getByRole('status')).toContainText('已导入');
    await expect.poll(async () => (await fixture.snapshot()).data.settings.resources.length).toBe(1);
  }
  expect((await fixture.snapshot()).data.settings.ignoredSkillPaths).toEqual([]);
  await fixture.restart();
  expect((await fixture.snapshot()).data.settings.resources).toHaveLength(1);
  expect(JSON.stringify((await readThroughAgent(resource.path))[1].messages)).toContain('COMMON_SKILL_BODY');
});

test('failed skill persistence retains the form without enabling or leaving duplicate shared skills', async () => {
  await fixture.page.getByRole('button', { name: 'Skills 与扩展', exact: true }).click();
  await fixture.page.getByRole('button', { name: '创建 Skill', exact: true }).click();
  await fixture.page.locator('#skill-name').fill('保存失败后重试');
  await fixture.page.locator('#skill-content').fill(content);
  const blocked = join(fixture.storage, 'desktop.json.tmp');
  await mkdir(blocked);
  try {
    await fixture.page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(fixture.page.getByRole('status')).toContainText(/EISDIR|EPERM|EACCES/);
    await expect(fixture.page.locator('#skill-content')).toHaveValue(content);
    expect((await fixture.snapshot()).data.settings.resources).toEqual([]);
    expect(await readdir(join(fixture.home, '.agents', 'skills'))).toEqual([]);
  } finally { await rm(blocked, { recursive: true }); }
  await fixture.page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(fixture.page.getByRole('status')).toContainText('已创建 保存失败后重试');
  expect((await fixture.snapshot()).data.settings.resources).toHaveLength(1);
  expect(await readdir(join(fixture.home, '.agents', 'skills'))).toHaveLength(1);
  await fixture.restart();
  expect((await fixture.snapshot()).data.settings.resources).toHaveLength(1);
});

test('resource discovery and toggles acknowledge only durable changes and recover after a write failure', async () => {
  const path = join(fixture.home, '.agents', 'skills', 'persistent', 'SKILL.md');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  const blocked = join(fixture.storage, 'desktop.json.tmp');
  await mkdir(blocked);
  try {
    await expect(fixture.invoke({ op: 'resource.refresh' })).rejects.toThrow(/EISDIR|EPERM|EACCES/);
    expect((await fixture.snapshot()).data.settings.resources).toEqual([]);
  } finally { await rm(blocked, { recursive: true }); }
  await fixture.invoke({ op: 'resource.refresh' });
  const resources = (await fixture.snapshot()).data.settings.resources;
  expect(resources).toHaveLength(1);
  expect(JSON.parse(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')).settings.resources).toEqual(resources);
  await mkdir(blocked);
  try {
    await expect(fixture.invoke({ op: 'settings.patch', patch: { resources: resources.map(item => ({ ...item, enabled: false })) }, base: { resources } })).rejects.toThrow(/EISDIR|EPERM|EACCES/);
    expect((await fixture.snapshot()).data.settings.resources).toEqual(resources);
  } finally { await rm(blocked, { recursive: true }); }
  await fixture.invoke({ op: 'settings.patch', patch: { resources: resources.map(item => ({ ...item, enabled: false })) }, base: { resources } });
  expect(JSON.parse(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')).settings.resources[0].enabled).toBe(false);
  await fixture.restart();
  expect((await fixture.snapshot()).data.settings.resources).toEqual(resources.map(item => ({ ...item, enabled: false })));
  const disabled = (await fixture.snapshot()).data.settings.resources;
  await mkdir(blocked);
  try {
    await expect(fixture.invoke({ op: 'settings.patch', patch: { resources: [] }, base: { resources: disabled } })).rejects.toThrow(/EISDIR|EPERM|EACCES/);
    expect((await fixture.snapshot()).data.settings.resources).toEqual(disabled);
    expect((await fixture.snapshot()).data.settings.ignoredSkillPaths).toEqual([]);
  } finally { await rm(blocked, { recursive: true }); }
  await fixture.invoke({ op: 'settings.patch', patch: { resources: [] }, base: { resources: disabled } });
  await fixture.restart();
  expect((await fixture.snapshot()).data.settings.resources).toEqual([]);
  expect((await fixture.snapshot()).data.settings.ignoredSkillPaths).toContain(path);
  expect(await readFile(path, 'utf8')).toBe(content);
});

test('shared discovery diagnostics recover after repair and actual extension failures survive restart', async () => {
  const path = join(fixture.home, '.agents', 'skills', 'repair', 'SKILL.md');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '---\nname: repair\n---\nMISSING_DESCRIPTION');
  const extension = join(fixture.project, 'broken-extension.mjs');
  const marker = join(fixture.project, 'extension-ran.txt');
  await writeFile(extension, 'import { writeFileSync } from "node:fs"; export default () => { writeFileSync(' + JSON.stringify(marker) + ', "ran"); throw new Error("ACTUAL_EXTENSION_LOAD_FAILURE"); };');
  const settings = (await fixture.snapshot()).data.settings;
  await fixture.invoke({ op: 'settings.save', settings: { ...settings, resources: [{ id: 'broken', name: '待修复扩展', path: extension, kind: 'extension', enabled: true }] } });
  await fixture.page.getByRole('button', { name: 'Skills 与扩展', exact: true }).click();
  await expect(fixture.page.getByRole('region', { name: '资源源文件检查' })).toContainText('description is required');
  expect((await fixture.snapshot()).data.settings.resources).toHaveLength(1);
  await expect(access(marker)).rejects.toThrow();
  await fixture.invoke({ op: 'thread.send', id: 't', text: '记录实际扩展加载失败', attachments: [] });
  await expect(access(marker)).rejects.toThrow();
  await approveLocalExtension(extension);
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')?.resourceLoad?.diagnostics.some(item => item.message.includes('ACTUAL_EXTENSION_LOAD_FAILURE'))).toBe(true);
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')?.status).toBe('idle');
  expect(await readFile(marker, 'utf8')).toBe('ran');
  const report = (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.resourceLoad!;
  await fixture.restart();
  expect((await fixture.snapshot()).data.threads.find(thread => thread.id === 't')!.resourceLoad).toEqual(report);
  const history = fixture.page.getByRole('region', { name: '任务资源加载记录' });
  await history.locator('summary').click();
  await expect(history).toContainText('ACTUAL_EXTENSION_LOAD_FAILURE');
  await writeFile(path, '---\nname: repaired-workflow\ndescription: 可搜索的修复流程\n---\nREPAIRED_SKILL_BODY');
  await writeFile(extension, 'export default () => {};');
  await fixture.page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(fixture.page.getByRole('status')).toContainText('已刷新资源');
  await expect(fixture.page.getByRole('region', { name: '资源源文件检查' })).toContainText('0 条诊断');
  await fixture.page.getByLabel('搜索 Skills 与扩展').fill('可搜索的修复流程');
  await expect(fixture.page.getByLabel('启用 repaired-workflow')).toBeChecked();
  await expect(history).toContainText('ACTUAL_EXTENSION_LOAD_FAILURE');
  const before = fixture.calls.length;
  await fixture.invoke({ op: 'thread.send', id: 't', text: '/skill:repaired-workflow', attachments: [] });
  await approveLocalExtension(extension);
  await expect.poll(() => fixture.calls.length).toBeGreaterThan(before);
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')?.status).toBe('idle');
  expect(JSON.stringify(fixture.calls.at(-1)?.messages)).toContain('REPAIRED_SKILL_BODY');
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')?.resourceLoad?.diagnostics).toEqual([]);
  await expect(fixture.page.getByRole('region', { name: '任务资源加载记录' })).toHaveCount(0);
});

test('resource source details retry missing files and preserve shared files after removing configuration', async () => {
  const resource = await fixture.invoke({ op: 'resource.create', name: '详情工作流', content }) as { id: string; path: string };
  await fixture.page.getByRole('button', { name: 'Skills 与扩展', exact: true }).click();
  const row = fixture.page.locator('.resource-list .field-row').filter({ hasText: '详情工作流' });
  await rename(resource.path, resource.path + '.away');
  const trigger = row.getByRole('button', { name: '详情', exact: true });
  await trigger.click();
  const detail = fixture.page.getByRole('region', { name: '资源详情 详情工作流' });
  await expect(detail.getByRole('alert')).toContainText('ENOENT');
  await rename(resource.path + '.away', resource.path);
  await detail.getByRole('button', { name: '重试读取' }).click();
  await expect(detail).toContainText('COMMON_SKILL_BODY');
  await detail.press('Escape');
  await expect(trigger).toBeFocused();
  await fixture.app.evaluate(({ shell }, expected) => {
    shell.showItemInFolder = path => { if (path !== expected) throw new Error('Incorrect resource source path'); };
  }, resource.path);
  await row.getByRole('button', { name: '打开文件位置' }).click();
  fixture.setMode('hold');
  await fixture.invoke({ op: 'thread.send', id: 't', text: '保持运行以验证资源配置隔离', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  expect(JSON.stringify(fixture.calls[0].messages.filter(message => message.role === 'system'))).toContain('common-workflow');
  await expect(fixture.page.getByRole('button', { name: '刷新', exact: true })).toBeEnabled();
  await expect(fixture.page.getByLabel('移除 详情工作流')).toBeEnabled();
  await trigger.click();
  await expect(detail).toContainText('COMMON_SKILL_BODY');
  await fixture.page.getByLabel('移除 详情工作流').click();
  await expect(detail).toHaveCount(0);
  expect((await fixture.snapshot()).data.threads.find(thread => thread.id === 't')?.status).toBe('running');
  expect((await fixture.snapshot()).data.settings.resources).toHaveLength(0);
  expect(fixture.calls).toHaveLength(1);
  await fixture.invoke({ op: 'thread.stop', id: 't' });
  expect(await readFile(resource.path, 'utf8')).toBe(content);
  await fixture.restart();
  expect((await fixture.snapshot()).data.settings.resources).toHaveLength(0);
  expect(await readFile(resource.path, 'utf8')).toBe(content);
});
