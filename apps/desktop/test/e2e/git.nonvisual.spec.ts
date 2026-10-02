import { taskAction } from './fixtures/task-actions.ts';
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { gitRun } from '../../src/main/git.ts';
import type { GitInspection } from '../../src/shared/contracts.ts';
import { isGitCommitResult } from '../../src/shared/git-results.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';
import { processAlive, slowGitFixture } from '../fixtures/git-process.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]); });

const inspection = () => fixture.invoke({ op: 'git.inspect', threadId: 't' }) as Promise<GitInspection>;
const branch = async () => (await gitRun(fixture.project, ['branch', '--show-current'])).trim();
async function changes() {
  if (!await fixture.page.locator('.review-pane').isVisible()) await taskAction(fixture.page, '查看变更');
  await fixture.page.getByRole('tab', { name: /^变更/ }).click();
  await fixture.page.getByLabel('刷新 Git', { exact: true }).click();
  await expect(fixture.page.getByRole('region', { name: 'Git 工作台' })).toBeVisible();
  const controls = fixture.page.getByRole('button', { name: 'Git 操作', exact: true });
  if (await controls.getAttribute('aria-expanded') !== 'true') await controls.click();
}

test('Git workbench fetches real remote branches, tracks an explicit name and preserves active task directories', async () => {
  const remote = join(fixture.storage, 'remote.git');
  const peer = join(fixture.storage, 'peer');
  await gitRun(fixture.storage, ['init', '--bare', '-b', 'main', remote]);
  await gitRun(fixture.project, ['remote', 'add', 'origin', remote]);
  await gitRun(fixture.project, ['push', '-u', 'origin', 'main']);
  await gitRun(fixture.storage, ['clone', remote, peer]);
  await gitRun(peer, ['config', 'user.name', 'Peer Test']);
  await gitRun(peer, ['config', 'user.email', 'peer@example.invalid']);
  await gitRun(peer, ['switch', '-c', 'feature/topic']);
  await writeFile(join(peer, 'remote.txt'), 'REMOTE_BRANCH_CONTENT\n');
  await gitRun(peer, ['add', '--', 'remote.txt']);
  await gitRun(peer, ['commit', '-m', 'remote topic']);
  await gitRun(peer, ['push', '-u', 'origin', 'feature/topic']);
  await changes();
  const page = fixture.page;
  await page.getByText('分支与远端', { exact: true }).click();
  await expect(page.getByLabel('Git 远端', { exact: true })).toHaveValue('origin');
  await page.getByRole('button', { name: '获取', exact: true }).click();
  await expect.poll(async () => (await inspection()).remoteBranches.map(item => item.ref)).toContain('origin/feature/topic');
  await expect(page.getByLabel('远端分支', { exact: true }).locator('option[value="origin/feature/topic"]')).toHaveCount(1);
  await page.getByLabel('远端分支', { exact: true }).click();
  await page.locator('.menu-item[data-value="origin/feature/topic"]').click();
  await page.getByLabel('分支名称', { exact: true }).fill('local-topic');
  await page.getByRole('button', { name: '从远端创建跟踪分支' }).click();
  await expect.poll(branch).toBe('local-topic');
  await expect.poll(async () => (await inspection()).upstream).toBe('origin/feature/topic');
  expect(await readFile(join(fixture.project, 'remote.txt'), 'utf8')).toBe('REMOTE_BRANCH_CONTENT\n');
  await expect(page.locator('.branch-row')).toContainText('local-topic');
  await page.getByLabel('远端分支', { exact: true }).click();
  await page.locator('.menu-item[data-value="origin/main"]').click();
  await page.getByRole('button', { name: '设置上游', exact: true }).click();
  await expect.poll(async () => (await inspection()).upstream).toBe('origin/main');
  await page.getByLabel('远端分支', { exact: true }).click();
  await page.locator('.menu-item[data-value="origin/feature/topic"]').click();
  await page.getByRole('button', { name: '设置上游', exact: true }).click();
  await expect.poll(async () => (await inspection()).upstream).toBe('origin/feature/topic');
  await writeFile(join(peer, 'remote.txt'), 'REMOTE_UPDATED\n');
  await gitRun(peer, ['add', '--', 'remote.txt']);
  await gitRun(peer, ['commit', '-m', 'remote update']);
  await gitRun(peer, ['push']);
  await expect(page.getByLabel('拉取策略')).toHaveValue('ff-only');
  await page.getByRole('button', { name: '拉取', exact: true }).click();
  await expect.poll(() => readFile(join(fixture.project, 'remote.txt'), 'utf8')).toBe('REMOTE_UPDATED\n');
  await expect(page.getByRole('button', { name: '拉取', exact: true })).toBeEnabled();
  await writeFile(join(fixture.project, 'remote.txt'), 'LOCAL_PUSHED\n');
  await page.getByLabel('刷新 Git', { exact: true }).click();
  await page.getByLabel('暂存 remote.txt', { exact: true }).click();
  await page.getByLabel('提交信息').fill('local topic update');
  await page.getByRole('button', { name: '提交所选暂存文件', exact: true }).click();
  await expect(page.getByText('工作区是干净的。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '推送', exact: true }).click();
  await expect.poll(() => gitRun(remote, ['show', 'feature/topic:remote.txt'])).toBe('LOCAL_PUSHED\n');
  expect((await inspection()).upstream).toBe('origin/feature/topic');
  expect(await gitRun(remote, ['branch', '--list', 'local-topic'])).toBe('');
  await expect(page.getByRole('button', { name: '推送', exact: true })).toBeEnabled();
  fixture.setMode('hold');
  await fixture.invoke({ op: 'thread.send', id: 't', text: '保持运行以验证目录互斥', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  await expect(page.getByRole('button', { name: '从远端创建跟踪分支' })).toBeDisabled();
  await expect(fixture.invoke({ op: 'git.action', threadId: 't', action: 'branchTrack', value: 'blocked-topic', startPoint: 'origin/feature/topic', paths: [], remote: 'origin', strategy: 'ff-only' })).rejects.toThrow(/停止/);
  expect(await branch()).toBe('local-topic');
  await fixture.invoke({ op: 'thread.stop', id: 't' }); fixture.release();
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  await fixture.restart();
  await changes();
  await expect(fixture.page.locator('.branch-row')).toContainText('local-topic');
  await expect(fixture.page.locator('.branch-row')).toContainText('origin/feature/topic');
});

test('Git workbench shows real conflict versions, edits a resolution and continues the merge', async () => {
  await gitRun(fixture.project, ['switch', '-c', 'feature']);
  await writeFile(join(fixture.project, 'README.md'), '# Feature\n');
  await gitRun(fixture.project, ['commit', '-am', 'feature text']);
  await gitRun(fixture.project, ['switch', 'main']);
  await writeFile(join(fixture.project, 'README.md'), '# Main\n');
  await gitRun(fixture.project, ['commit', '-am', 'main text']);
  await changes();
  const page = fixture.page;
  await page.getByText('分支与远端', { exact: true }).click();
  await page.getByLabel('分支名称', { exact: true }).fill('feature');
  await page.getByRole('button', { name: '合并', exact: true }).click();
  await expect(page.getByText('正在合并', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '继续', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '查看冲突 README.md' }).click();
  const versions = page.getByRole('region', { name: '冲突版本 README.md' });
  for (const [name, content] of [['基准', '# Acceptance'], ['当前版本', '# Main'], ['传入版本', '# Feature']]) {
    await versions.getByText(name, { exact: true }).click();
    await expect(versions.locator('pre').filter({ hasText: content })).toBeVisible();
  }
  await versions.getByRole('button', { name: '编辑解决结果' }).click();
  const editor = page.getByLabel('文件内容 README.md');
  await expect(editor).toContainText('<<<<<<<');
  await editor.fill('# Resolved\n');
  await page.getByRole('button', { name: '保存 *', exact: true }).click();
  await expect.poll(async () => ({
    content: await readFile(join(fixture.project, 'README.md'), 'utf8'),
    errors: await page.locator('.files-workbench .file-navigation-error').allTextContents(),
  })).toEqual({ content: '# Resolved\n', errors: [] });
  await changes();
  await page.getByRole('button', { name: '查看冲突 README.md' }).click();
  await page.getByRole('button', { name: '标记已解决' }).click();
  await expect(page.getByRole('button', { name: '继续', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect.poll(async () => (await inspection()).operation).toBe('');
  expect((await gitRun(fixture.project, ['show', '--format=%P', '-s', 'HEAD'])).trim().split(' ')).toHaveLength(2);
  expect(await gitRun(fixture.project, ['show', 'HEAD:README.md'])).toBe('# Resolved\n');
  await expect(page.getByText('工作区是干净的。', { exact: true })).toBeVisible();
  await page.getByText('提交历史', { exact: true }).click();
  await expect(page.locator('.git-commit-row').first()).toContainText('Merge');
  await page.locator('.git-commit-row').first().click();
  await expect(page.locator('.git-commit-detail')).toContainText('Merge');
  await expect(page.locator('.git-commit-detail')).toContainText('合并提交显示相对第一父提交的改动。');
  await expect(page.locator('.git-commit-detail .diff')).toContainText('+# Resolved');
  await expect(page.locator('.git-commit-detail .diff')).toContainText('-# Main');
  await page.getByRole('button', { name: '关闭提交差异' }).click();
  await expect(page.locator('.git-commit-row').first()).toBeFocused();
});

test('Git index failures retry without losing drafts or staging a same-name file in another directory', async () => {
  const extra = join(fixture.storage, 'extra-git'); await mkdir(extra);
  await gitRun(extra, ['init', '-b', 'main']); await gitRun(extra, ['config', 'user.name', 'Test']); await gitRun(extra, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(extra, 'README.md'), 'EXTRA_BASE\n'); await gitRun(extra, ['add', '--', 'README.md']); await gitRun(extra, ['commit', '-m', 'extra fixture']);
  await writeFile(join(extra, 'README.md'), 'EXTRA_CHANGE\n');
  await writeFile(join(fixture.project, 'README.md'), 'MAIN_CHANGE\n');
  await fixture.app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, extra);
  await fixture.invoke({ op: 'project.directoryAdd', projectId: 'p' });
  await changes();
  const page = fixture.page, draft = page.getByRole('textbox', { name: '提交信息', exact: true });
  await draft.fill('主目录提交草稿');
  const lock = join(fixture.project, '.git', 'index.lock'); await writeFile(lock, 'OWNED_BY_GIT_TEST', { flag: 'wx' });
  try {
    await page.getByRole('button', { name: '暂存 README.md', exact: true }).click();
    await expect(page.locator('.git-feedback')).toContainText('index.lock');
    await expect(draft).toHaveValue('主目录提交草稿');
    expect(await gitRun(fixture.project, ['diff', '--cached', '--name-only'])).toBe('');
    expect(await readFile(lock, 'utf8')).toBe('OWNED_BY_GIT_TEST');
  } finally { await unlink(lock); }
  await page.getByRole('button', { name: '关闭辅助栏', exact: true }).click();
  await changes(); await expect(draft).toHaveValue('主目录提交草稿');
  await page.getByRole('button', { name: '暂存 README.md', exact: true }).click();
  await expect.poll(() => gitRun(fixture.project, ['show', ':README.md'])).toBe('MAIN_CHANGE\n');
  await expect(page.getByRole('checkbox', { name: '提交 README.md', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '浏览目录与仓库', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /extra-git/ }).click();
  await page.getByRole('button', { name: 'Git 操作', exact: true }).click();
  await expect(draft).toHaveValue(''); await draft.fill('附加目录提交草稿');
  expect(await gitRun(extra, ['diff', '--cached', '--name-only'])).toBe('');
  await page.getByRole('button', { name: '暂存 README.md', exact: true }).click();
  await expect.poll(() => gitRun(extra, ['show', ':README.md'])).toBe('EXTRA_CHANGE\n');
  await page.getByRole('button', { name: '浏览目录与仓库', exact: true }).click();
  await page.getByRole('menuitemradio').filter({ hasNotText: 'extra-git' }).click();
  await expect(draft).toHaveValue('主目录提交草稿');
  await expect(page.getByRole('checkbox', { name: '提交 README.md', exact: true })).toBeChecked();
  expect(await gitRun(fixture.project, ['show', ':README.md'])).toBe('MAIN_CHANGE\n');
  expect(await gitRun(extra, ['show', ':README.md'])).toBe('EXTRA_CHANGE\n');
  await fixture.restart();
  expect(await gitRun(fixture.project, ['show', ':README.md'])).toBe('MAIN_CHANGE\n');
  expect(await gitRun(extra, ['show', ':README.md'])).toBe('EXTRA_CHANGE\n');
});

test('Git cancellation from the reopened panel stops real commit hooks and preserves a retryable draft', async () => {
  const slow = await slowGitFixture(fixture.storage);
  try {
    const hooks = join(fixture.storage, 'cancel-hooks'); await mkdir(hooks);
    await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\nexec ' + slow.command + '\n', { mode: 0o755 });
    await gitRun(fixture.project, ['config', 'core.hooksPath', hooks]);
    await writeFile(join(fixture.project, 'README.md'), 'CANCELLED_COMMIT_CONTENT\n');
    await changes();
    await fixture.page.getByRole('button', { name: '暂存 README.md', exact: true }).click();
    await expect(fixture.page.getByRole('checkbox', { name: '提交 README.md', exact: true })).toBeChecked();
    const index = await readFile(join(fixture.project, '.git', 'index')); const head = await gitRun(fixture.project, ['rev-parse', 'HEAD']);
    const draft = fixture.page.getByRole('textbox', { name: '提交信息', exact: true }); await draft.fill('保留取消后的提交草稿');
    await fixture.page.getByRole('button', { name: '提交所选暂存文件', exact: true }).click();
    const ids = await slow.ready(); const temporary = dirname(await slow.indexPath());
    await fixture.page.getByRole('button', { name: '关闭辅助栏', exact: true }).click();
    await changes(); await expect(draft).toHaveValue('保留取消后的提交草稿');
    await fixture.page.getByRole('button', { name: '取消 Git 操作', exact: true }).click();
    await expect(fixture.page.locator('.git-feedback')).toContainText('Git 操作已取消');
    expect(ids.filter(processAlive)).toEqual([]); await expect(access(temporary)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await gitRun(fixture.project, ['rev-parse', 'HEAD'])).toBe(head); expect(await readFile(join(fixture.project, '.git', 'index'))).toEqual(index);
    await expect(draft).toHaveValue('保留取消后的提交草稿');
    const { data } = await fixture.snapshot(); await fixture.invoke({ op: 'ui.update', ui: { ...data.ui, locale: 'en-US' } });
    await expect(fixture.page.locator('.git-feedback')).toContainText('Git operation cancelled. Refresh the repository status.');
    await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 0\n');
    await fixture.page.getByRole('button', { name: 'Commit selected staged files', exact: true }).click();
    await expect.poll(() => gitRun(fixture.project, ['show', 'HEAD:README.md'])).toBe('CANCELLED_COMMIT_CONTENT\n');
    await expect(fixture.page.getByRole('textbox', { name: 'Commit message', exact: true })).toHaveValue('');
    expect(await gitRun(fixture.project, ['diff', '--cached', '--name-only'])).toBe('');
  } finally { await slow.cleanup(); }
});

test('Git shutdown waits for real hook descendants and temporary index cleanup before restarting', async () => {
  const slow = await slowGitFixture(fixture.storage);
  try {
    const hooks = join(fixture.storage, 'shutdown-hooks'); await mkdir(hooks);
    await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\nexec ' + slow.command + '\n', { mode: 0o755 });
    await gitRun(fixture.project, ['config', 'core.hooksPath', hooks]);
    await writeFile(join(fixture.project, 'README.md'), 'STAGED_ON_SHUTDOWN\n');
    await gitRun(fixture.project, ['add', '--', 'README.md']);
    const head = await gitRun(fixture.project, ['rev-parse', 'HEAD']); const index = await readFile(join(fixture.project, '.git', 'index'));
    const action = fixture.invoke({ op: 'git.action', threadId: 't', requestId: 'quit-commit', action: 'commitStaged', paths: ['README.md'], value: 'must not commit on quit', remote: 'origin', strategy: 'ff-only' }).then(() => '', error => String(error));
    const ids = await slow.ready(); const temporary = dirname(await slow.indexPath());
    await fixture.restart(); await action;
    expect(ids.filter(processAlive)).toEqual([]); await expect(access(temporary)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await gitRun(fixture.project, ['rev-parse', 'HEAD'])).toBe(head); expect(await readFile(join(fixture.project, '.git', 'index'))).toEqual(index);
    expect(await gitRun(fixture.project, ['show', ':README.md'])).toBe('STAGED_ON_SHUTDOWN\n');
    await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 0\n');
    await fixture.invoke({ op: 'git.action', threadId: 't', requestId: 'after-restart', action: 'commitStaged', paths: ['README.md'], value: 'explicit retry', remote: 'origin', strategy: 'ff-only' });
    expect(await gitRun(fixture.project, ['show', 'HEAD:README.md'])).toBe('STAGED_ON_SHUTDOWN\n');
  } finally { await slow.cleanup(); }
});

async function postCommitFixture() {
  const slow = await slowGitFixture(fixture.storage);
  const hooks = join(fixture.storage, 'post-commit-hooks'); await mkdir(hooks);
  await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\nprintf \'FORMATTED_COMMIT_CONTENT\\n\' > README.md\ngit add -- README.md\n', { mode: 0o755 });
  await writeFile(join(hooks, 'post-commit'), '#!/bin/sh\nexec ' + slow.command + '\n', { mode: 0o755 });
  await gitRun(fixture.project, ['config', 'core.hooksPath', hooks]);
  await writeFile(join(fixture.project, 'README.md'), 'SELECTED_COMMIT_CONTENT\n');
  await gitRun(fixture.project, ['add', '--', 'README.md']);
  return slow;
}

test('Git late cancellation shows the completed commit, clears only its draft and survives restart', async () => {
  const slow = await postCommitFixture();
  try {
    await changes(); const page = fixture.page;
    await page.getByRole('checkbox', { name: '提交 README.md', exact: true }).check();
    await page.getByRole('textbox', { name: '提交信息', exact: true }).fill('提交已经生效');
    await page.getByRole('button', { name: '提交所选暂存文件', exact: true }).click();
    const ids = await slow.ready(); const committed = (await gitRun(fixture.project, ['rev-parse', 'HEAD'])).trim();
    await page.getByRole('button', { name: '关闭辅助栏', exact: true }).click(); await changes();
    await page.getByRole('button', { name: '取消 Git 操作', exact: true }).click();
    await expect(page.locator('.git-feedback')).toContainText('提交已完成；后续步骤已中断。');
    await expect(page.locator('.git-feedback')).toContainText(committed);
    await expect(page.getByRole('textbox', { name: '提交信息', exact: true })).toHaveValue('');
    expect(ids.filter(processAlive)).toEqual([]);
    expect(await gitRun(fixture.project, ['show', ':README.md'])).toBe('FORMATTED_COMMIT_CONTENT\n');
    expect(await gitRun(fixture.project, ['diff', '--cached', '--name-only'])).toBe('');
    const { data } = await fixture.snapshot(); await fixture.invoke({ op: 'ui.update', ui: { ...data.ui, locale: 'en-US' } });
    await expect(page.locator('.git-feedback')).toContainText('Commit completed; subsequent steps were interrupted.');
    await expect(page.locator('.git-feedback')).not.toContainText('提交已完成');
    await fixture.restart();
    expect((await gitRun(fixture.project, ['rev-parse', 'HEAD'])).trim()).toBe(committed);
    expect((await gitRun(fixture.project, ['rev-list', '--count', 'HEAD'])).trim()).toBe('2');
    expect(await gitRun(fixture.project, ['diff', '--cached', '--name-only'])).toBe('');
  } finally { await slow.cleanup(); }
});

test('Git post-commit index failure warns without offering a duplicate commit or deleting an outside lock', async () => {
  const slow = await postCommitFixture(); const lock = join(fixture.project, '.git', 'index.lock');
  try {
    await changes(); const page = fixture.page;
    await page.getByRole('checkbox', { name: '提交 README.md', exact: true }).check();
    await page.getByRole('textbox', { name: '提交信息', exact: true }).fill('已提交但索引被占用');
    await page.getByRole('button', { name: '提交所选暂存文件', exact: true }).click(); await slow.ready();
    await writeFile(lock, 'native outside owner', { flag: 'wx' });
    await page.getByRole('button', { name: '取消 Git 操作', exact: true }).click();
    await expect(page.locator('.git-feedback').getByRole('alert')).toContainText('提交已完成，但暂存区同步失败。请刷新核对，不要重复提交。');
    await expect(page.getByRole('textbox', { name: '提交信息', exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: '提交所选暂存文件', exact: true })).toBeDisabled();
    expect(await readFile(lock, 'utf8')).toBe('native outside owner'); await unlink(lock);
    await page.locator('.git-feedback').getByRole('button', { name: '刷新状态', exact: true }).click();
    await page.getByRole('button', { name: '取消暂存 README.md', exact: true }).click();
    await expect.poll(() => gitRun(fixture.project, ['diff', '--cached', '--name-only'])).toBe('');
    expect((await gitRun(fixture.project, ['rev-list', '--count', 'HEAD'])).trim()).toBe('2');
  } finally { await slow.cleanup(); await unlink(lock).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
});

test('Git late shutdown reconciles an already created commit and never resubmits it on restart', async () => {
  const slow = await postCommitFixture();
  try {
    const action = fixture.invoke({ op: 'git.action', threadId: 't', requestId: 'late-quit-commit', action: 'commitStaged', paths: ['README.md'], value: 'already committed before quit', remote: 'origin', strategy: 'ff-only' }).then(result => result, error => String(error));
    const ids = await slow.ready(); const temporary = dirname(await slow.indexPath());
    const committed = (await gitRun(fixture.project, ['rev-parse', 'HEAD'])).trim();
    await fixture.restart(); const result = await action;
    if (isGitCommitResult(result)) expect(result.id).toBe(committed);
    expect(ids.filter(processAlive)).toEqual([]); await expect(access(temporary)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await gitRun(fixture.project, ['rev-parse', 'HEAD'])).trim()).toBe(committed);
    expect(await gitRun(fixture.project, ['show', ':README.md'])).toBe('FORMATTED_COMMIT_CONTENT\n');
    expect(await gitRun(fixture.project, ['diff', '--cached', '--name-only'])).toBe('');
    expect((await gitRun(fixture.project, ['rev-list', '--count', 'HEAD'])).trim()).toBe('2');
  } finally { await slow.cleanup(); }
});
