import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { FileContent, Thread } from '../../src/shared/contracts.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); await writeFile(join(fixture.project, 'README.md'), '# Changed\nreview this line\n'); });
test.afterEach(async () => {
  if (fixture) {
    const errors = [...fixture.errors]; await fixture.close();
    await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]);
  }
});
const submission = { summary: '发现实际问题。', findings: [{ priority: 1, title: 'Missing guard', body: 'The new path omits a guard.', path: 'README.md', line: 2, endLine: 2 }] };
async function showReview() {
  const snapshot = await fixture.snapshot();
  await fixture.invoke({ op: 'ui.update', ui: { ...snapshot.data.ui, reviewOpen: true } });
  await fixture.page.getByRole('button', { name: '新标签', exact: true }).click();
  await fixture.page.locator('.tool-launcher').getByRole('button', { name: '审查', exact: true }).click();
  await expect(fixture.page.getByRole('region', { name: '只读审查', exact: true })).toBeVisible();
}
test('user starts an isolated read-only review; structured findings retain source version and recover after restart', async () => {
  const beforeIndex = await readFile(join(fixture.project, '.git', 'index'));
  await showReview(); expect(fixture.calls).toHaveLength(0);
  fixture.requestTool('submit_review', submission);
  await fixture.page.getByLabel('自定义审查要求', { exact: true }).fill('check guards');
  await fixture.page.getByRole('button', { name: '开始只读审查', exact: true }).click();
  await expect(fixture.page.getByText('审查已完成', { exact: true })).toBeVisible({ timeout: 30000 });
  const run = (await fixture.snapshot()).data.threads.find(item => item.review)!;
  expect(run.review?.phase).toBe('complete'); expect(run.review?.findings).toHaveLength(1);
  expect((await fixture.snapshot()).data.threads.find(item => item.id === 't')!.items).toHaveLength(0);
  const tools = fixture.calls[0].tools?.map(tool => tool.function.name) ?? [];
  expect(tools).toEqual(expect.arrayContaining(['submit_review', 'read_review_file', 'read']));
  expect(tools).not.toEqual(expect.arrayContaining(['write'])); expect(tools).not.toContain('powershell');
  expect(await readFile(join(fixture.project, '.git', 'index'))).toEqual(beforeIndex);
  expect(await readFile(join(fixture.project, 'README.md'), 'utf8')).toBe('# Changed\nreview this line\n');
  await fixture.page.getByRole('button', { name: '忽略发现', exact: true }).click();
  await expect(fixture.page.getByRole('button', { name: '恢复发现', exact: true })).toBeVisible();
  await fixture.page.getByLabel('追加审查反馈', { exact: true }).fill('checked by user');
  await fixture.page.getByRole('button', { name: '保存反馈', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(item => item.id === run.id)?.review?.findings[0].feedback).toEqual(['checked by user']);
  await fixture.page.getByRole('button', { name: '追加到任务草稿', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.draft?.text).toContain('Missing guard');
  const calls = fixture.calls.length;
  await writeFile(join(fixture.project, 'README.md'), '# Changed externally\nNEW LOCATION\n');
  await fixture.page.getByRole('button', { name: '检查位置状态', exact: true }).click();
  await expect(fixture.page.getByText('位置已过期', { exact: true })).toBeVisible();
  await expect(fixture.invoke({ op: 'review.locate', threadId: run.id, findingId: run.review!.findings[0].id })).rejects.toThrow('文件已变化');
  await fixture.page.getByRole('button', { name: '查看捕获版本', exact: true }).click();
  await expect(fixture.page.locator('.review-captured')).toContainText('review this line');
  await fixture.restart();
  await expect(fixture.page.getByRole('button', { name: '恢复发现', exact: true })).toBeVisible();
  expect(fixture.calls.length).toBe(calls);
  expect((await fixture.snapshot()).data.threads.find(item => item.id === run.id)?.review?.findings[0].feedback).toEqual(['checked by user']);
});
test('review rejects write tools and incomplete results; cancellation and retry do not affect the parent task', async () => {
  fixture.requestTool('write', { path: 'SHOULD_NOT_EXIST.txt', content: 'not allowed' });
  const failed = await fixture.invoke({ op: 'review.start', threadId: 't', scope: 'uncommitted', ref: '', instructions: '' }) as Thread;
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(item => item.id === failed.id)?.review?.phase, { timeout: 30000 }).toBe('error');
  await expect(access(join(fixture.project, 'SHOULD_NOT_EXIST.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await fixture.snapshot()).data.threads.find(item => item.id === failed.id)?.error).toContain('结构化');
  fixture.setMode('hold');
  const waiting = await fixture.invoke({ op: 'review.start', threadId: 't', scope: 'uncommitted', ref: '', instructions: '' }) as Thread;
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(item => item.id === waiting.id)?.status).toBe('running');
  await fixture.invoke({ op: 'review.cancel', threadId: waiting.id });
  expect((await fixture.snapshot()).data.threads.find(item => item.id === waiting.id)?.review?.phase).toBe('cancelled');
  expect((await fixture.snapshot()).data.threads.find(item => item.id === 't')?.status).toBe('idle');
  fixture.setMode('reply'); fixture.requestTool('submit_review', { summary: 'No defects', findings: [] });
  const next = await fixture.invoke({ op: 'review.start', threadId: 't', scope: 'uncommitted', ref: '', instructions: '' }) as Thread;
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(item => item.id === next.id)?.review?.phase, { timeout: 30000 }).toBe('complete');
  await expect(fixture.invoke({ op: 'thread.send', id: next.id, text: 'write something', attachments: [] })).rejects.toThrow('审查入口');
});
test('diff line comments persist their version and never relocate silently after external edits', async () => {
  const { data } = await fixture.snapshot();
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { reviewTab: 'changes', selectedPath: 'README.md' } });
  await fixture.invoke({ op: 'ui.update', ui: { ...data.ui, reviewOpen: true } });
  await fixture.page.getByRole('button', { name: '评论第 2 行', exact: true }).click();
  const form = fixture.page.locator('form').filter({ has: fixture.page.getByRole('button', { name: '保存评论', exact: true }) });
  await form.locator('textarea').fill('Please explain this line'); await form.getByRole('button', { name: '保存评论', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(item => item.id === 't')?.comments?.length).toBe(1);
  const comment = (await fixture.snapshot()).data.threads.find(item => item.id === 't')!.comments![0];
  expect(await fixture.invoke({ op: 'comment.locate', threadId: 't', commentId: comment.id })).toMatchObject({ path: 'README.md', line: 2 });
  const original = await fixture.invoke({ op: 'file.read', threadId: 't', path: 'README.md' }) as FileContent;
  await writeFile(join(fixture.project, 'README.md'), 'inserted\n# Changed\nreview this line\n');
  await expect(fixture.invoke({ op: 'comment.add', threadId: 't', path: 'README.md', version: original.version!, line: 2, endLine: 2, body: 'stale' })).rejects.toThrow('文件已变化');
  await expect(fixture.invoke({ op: 'comment.locate', threadId: 't', commentId: comment.id })).rejects.toThrow('过期');
  await showReview(); await expect(fixture.page.getByText('位置已过期', { exact: true })).toBeVisible();
  await fixture.restart(); await expect(fixture.page.getByText('Please explain this line', { exact: true })).toBeVisible();
  await fixture.page.getByRole('button', { name: '删除评论', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(item => item.id === 't')?.comments?.length).toBe(0);
});

test('same-name file comments stay in their directory after navigation and restart', async () => {
  const extra = join(fixture.storage, 'extra-comments');
  await mkdir(extra);
  await writeFile(join(extra, 'README.md'), 'EXTRA_DIRECTORY\n');
  await fixture.app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, extra);
  const directory = await fixture.invoke({ op: 'project.directoryAdd', projectId: 'p' }) as { id: string };
  for (const [directoryId, body] of [['p', '主目录的审查评论'], [directory.id, '附加目录的审查评论']]) {
    const file = await fixture.invoke({ op: 'file.read', threadId: 't', directoryId, path: 'README.md' }) as FileContent;
    await fixture.invoke({ op: 'comment.add', threadId: 't', directoryId, path: 'README.md', version: file.version!, line: 1, endLine: 1, body });
  }
  await showReview();
  await expect(fixture.page.getByText('主目录的审查评论', { exact: true })).toBeVisible();
  await expect(fixture.page.getByText('附加目录的审查评论', { exact: true })).toHaveCount(0);
  await fixture.page.getByRole('button', { name: '浏览目录与仓库', exact: true }).click();
  await fixture.page.getByRole('menuitemradio', { name: /extra-comments/ }).click();
  await expect(fixture.page.getByText('附加目录的审查评论', { exact: true })).toBeVisible();
  await expect(fixture.page.getByText('主目录的审查评论', { exact: true })).toHaveCount(0);
  await fixture.restart();
  await expect(fixture.page.getByText('附加目录的审查评论', { exact: true })).toBeVisible();
  await fixture.page.getByRole('button', { name: '删除评论', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(item => item.id === 't')?.comments?.map(item => item.body)).toEqual(['主目录的审查评论']);
  expect(await readFile(join(extra, 'README.md'), 'utf8')).toBe('EXTRA_DIRECTORY\n');
  expect(await readFile(join(fixture.project, 'README.md'), 'utf8')).toBe('# Changed\nreview this line\n');
});

test('review feedback disk failures preserve committed findings and the UI draft for one retry', async () => {
  fixture.requestTool('submit_review', submission);
  const run = await fixture.invoke({ op: 'review.start', threadId: 't', scope: 'uncommitted', ref: '', instructions: '' }) as Thread;
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(item => item.id === run.id)?.review?.phase).toBe('complete');
  await showReview();
  const feedback = fixture.page.getByRole('textbox', { name: '追加审查反馈', exact: true });
  await feedback.fill('磁盘恢复后只保存一次');
  const blocked = join(fixture.storage, 'desktop.json.tmp');
  await mkdir(blocked);
  try {
    await fixture.page.getByRole('button', { name: '保存反馈', exact: true }).click();
    await expect(fixture.page.locator('.review-finding').getByRole('alert')).toContainText(/EISDIR|EPERM|EACCES/);
    await expect(feedback).toHaveValue('磁盘恢复后只保存一次');
    expect((await fixture.snapshot()).data.threads.find(item => item.id === run.id)?.review?.findings[0].feedback).toEqual([]);
    const disk = JSON.parse(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')) as { threads: Thread[] };
    expect(disk.threads.find(item => item.id === run.id)?.review?.findings[0].feedback).toEqual([]);
    await fixture.page.getByRole('button', { name: '忽略发现', exact: true }).click();
    await expect(fixture.page.locator('.review-finding').getByRole('alert')).toContainText(/EISDIR|EPERM|EACCES/);
    expect((await fixture.snapshot()).data.threads.find(item => item.id === run.id)?.review?.findings[0].ignored).toBe(false);
    await expect(feedback).toHaveValue('磁盘恢复后只保存一次');
  } finally { await rm(blocked, { recursive: true, force: true }); }
  await fixture.page.getByRole('button', { name: '保存反馈', exact: true }).click();
  await expect(feedback).toHaveValue('');
  await expect(fixture.page.locator('.review-finding li')).toHaveText(['磁盘恢复后只保存一次']);
  await fixture.page.getByRole('button', { name: '忽略发现', exact: true }).click();
  await expect(fixture.page.getByRole('button', { name: '恢复发现', exact: true })).toBeVisible();
  await fixture.restart();
  expect((await fixture.snapshot()).data.threads.find(item => item.id === run.id)?.review?.findings[0].feedback).toEqual(['磁盘恢复后只保存一次']);
  expect((await fixture.snapshot()).data.threads.find(item => item.id === run.id)?.review?.findings[0].ignored).toBe(true);
});

test('comment disk failures preserve committed additions and removals through retry and restart', async () => {
  const original = await fixture.invoke({ op: 'file.read', threadId: 't', path: 'README.md' }) as FileContent;
  const request = { op: 'comment.add' as const, threadId: 't', path: 'README.md', version: original.version!, line: 2, endLine: 2, body: '持久保存的行评论' };
  const blocked = join(fixture.storage, 'desktop.json.tmp');
  await mkdir(blocked);
  try {
    await expect(fixture.invoke(request)).rejects.toThrow(/EISDIR|EPERM|EACCES/);
    expect((await fixture.snapshot()).data.threads.find(item => item.id === 't')?.comments ?? []).toEqual([]);
    const disk = JSON.parse(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')) as { threads: Thread[] };
    expect(disk.threads.find(item => item.id === 't')?.comments ?? []).toEqual([]);
  } finally { await rm(blocked, { recursive: true, force: true }); }
  await fixture.invoke(request);
  await fixture.restart();
  const comment = (await fixture.snapshot()).data.threads.find(item => item.id === 't')!.comments![0];
  expect((await fixture.snapshot()).data.threads.find(item => item.id === 't')!.comments).toHaveLength(1);
  await showReview();
  await mkdir(blocked);
  try {
    await fixture.page.getByRole('button', { name: '删除评论', exact: true }).click();
    await expect(fixture.page.getByRole('region', { name: '只读审查', exact: true }).getByRole('alert')).toContainText(/EISDIR|EPERM|EACCES/);
    await expect(fixture.page.getByText(request.body, { exact: true })).toBeVisible();
    expect((await fixture.snapshot()).data.threads.find(item => item.id === 't')?.comments).toEqual([comment]);
    const disk = JSON.parse(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')) as { threads: Thread[] };
    expect(disk.threads.find(item => item.id === 't')?.comments).toEqual([comment]);
  } finally { await rm(blocked, { recursive: true, force: true }); }
  await fixture.page.getByRole('button', { name: '删除评论', exact: true }).click();
  await expect(fixture.page.getByText(request.body, { exact: true })).toHaveCount(0);
  await fixture.restart();
  expect((await fixture.snapshot()).data.threads.find(item => item.id === 't')?.comments).toEqual([]);
  expect(await readFile(join(fixture.project, 'README.md'), 'utf8')).toBe(original.content);
});
