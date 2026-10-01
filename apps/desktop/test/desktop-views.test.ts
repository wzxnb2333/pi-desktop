import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { openDesktopView } from '../src/main/desktop-views.ts';
import { threadSchema, uiSchema, uiThreadSchema, type UiState, type UiThread } from '../src/shared/contracts.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pi-harness-view-'));
  t.after(async () => { await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 }); await assert.rejects(access(root), { code: 'ENOENT' }); });
  const project = join(root, 'project'), extra = join(root, 'extra');
  await mkdir(project); await mkdir(extra);
  await writeFile(join(project, 'entry.ts'), 'first\nsecond\nthird\n');
  await writeFile(join(extra, 'entry.ts'), 'extra directory\n');
  const thread = threadSchema.parse({ id: 't', projectId: 'p', cwd: project, title: 'Task', createdAt: 1, updatedAt: 1, modelId: 'local', thinking: 'off', policy: 'deny' });
  const ui = uiSchema.parse({ activeThreadId: 't', view: 'thread', reviewOpen: true, summaryOpen: false, threads: { t: {
    selectedPath: 'README.md', openFiles: ['README.md'], draft: { text: 'DRAFT', attachments: ['picked.png'] },
    scroll: { itemId: 'older-message', offset: 35, follow: false }, panelTabs: [{ id: 'custom-changes', kind: 'changes' }],
    directoryViews: { extra: { selectedPath: 'extra.md', openFiles: ['extra.md'] } },
  } } });
  let windowId = 1, visible = true, reads = 0, publishes = 0, directoryReads = 0;
  const hooks = { read: () => {}, directory: () => {} };
  const runtime = {
    context: () => { reads++; hooks.read(); return visible ? { windowId, thread, ui } : undefined; },
    directory: (id = 'p') => { directoryReads++; hooks.directory(); if (!['p', 'extra'].includes(id)) throw new Error('Foreign directory'); return { id, path: id === 'p' ? thread.cwd : extra }; },
    subtask: (id: string) => id === '00000000-0000-4000-8000-000000000001',
    sidechat: (id?: string) => id === undefined || id === 'sidechat-1' ? 'sidechat-1' : undefined,
    publish: (owner: number, patch: Partial<UiThread>, frame: Partial<UiState>) => {
      assert.equal(owner, windowId); publishes++; ui.threads.t = uiThreadSchema.parse({ ...ui.threads.t, ...patch }); Object.assign(ui, frame);
    },
  };
  return { root, project, extra, thread, ui, runtime, hooks, get reads() { return reads; }, get publishes() { return publishes; }, get directoryReads() { return directoryReads; },
    hide() { visible = false; }, transfer() { windowId++; } };
}
const signal = () => new AbortController().signal;

test('opening files preserves drafts, other file tabs, reading position and independent summary', async t => {
  const f = await fixture(t), before = structuredClone(f.ui.threads.t);
  assert.equal((await openDesktopView(f.runtime, { kind: 'file', path: join(f.project, 'entry.ts'), line: 2, column: 3 }, signal())).status, 'opened');
  assert.equal(f.ui.threads.t.selectedPath, 'entry.ts'); assert.equal(f.ui.threads.t.fileLocation?.line, 2);
  assert.deepEqual(f.ui.threads.t.openFiles, ['README.md', 'entry.ts']);
  assert.deepEqual(f.ui.threads.t.draft, before.draft); assert.deepEqual(f.ui.threads.t.scroll, before.scroll);
  await openDesktopView(f.runtime, { kind: 'file', path: 'entry.ts' }, signal());
  assert.equal(f.ui.threads.t.panelTabs?.filter(tab => tab.kind === 'files').length, 1);
  assert.equal(f.ui.threads.t.openFiles?.length, 2); assert.equal(f.ui.threads.t.fileLocation, undefined);
  await openDesktopView(f.runtime, { kind: 'summary' }, signal());
  assert.equal(f.ui.summaryOpen, true); assert.equal(f.ui.reviewOpen, true); assert.equal(f.ui.threads.t.reviewTab, 'files');
  await openDesktopView(f.runtime, { kind: 'changes' }, signal());
  assert.equal(f.ui.threads.t.activePanelTab, 'custom-changes');
});

test('opening terminal and an existing browser tab only changes the owning panel view', async t => {
  const f = await fixture(t);
  f.ui.threads.t.browserTabs = [{ id: 'browser-1', url: 'https://example.com', title: 'Example' }];
  f.ui.threads.t.activeBrowserTab = 'browser-1';
  const terminal = await openDesktopView(f.runtime, { kind: 'terminal' }, signal());
  assert.deepEqual(terminal, { status: 'opened', kind: 'terminal' });
  assert.equal(f.ui.reviewOpen, true); assert.equal(f.ui.threads.t.reviewTab, 'terminal'); assert.equal(f.ui.threads.t.terminalOpen, true);
  const browser = await openDesktopView(f.runtime, { kind: 'browser' }, signal());
  assert.deepEqual(browser, { status: 'opened', kind: 'browser' });
  assert.equal(f.ui.threads.t.reviewTab, 'browser'); assert.equal(f.ui.threads.t.activeBrowserTab, 'browser-1');
  assert.deepEqual(await openDesktopView(f.runtime, { kind: 'browser', tabId: 'missing' }, signal()), { status: 'not_opened', reason: 'browser_tab_missing' });
});

test('opening an owned child session selects its read-only panel tab', async t => {
  const f = await fixture(t);
  const childId = '00000000-0000-4000-8000-000000000001';
  const result = await openDesktopView(f.runtime, { kind: 'subtask', subtaskId: childId }, signal());
  assert.deepEqual(result, { status: 'opened', kind: 'subtask' });
  assert.equal(f.ui.reviewOpen, true); assert.equal(f.ui.threads.t.reviewTab, 'subtask'); assert.equal(f.ui.threads.t.activePanelTab, 'subtask:' + childId);
  assert.deepEqual(await openDesktopView(f.runtime, { kind: 'subtask', subtaskId: '00000000-0000-4000-8000-000000000002' }, signal()), { status: 'not_opened', reason: 'subtask_missing' });
});

test('opening an existing sidechat selects its panel and preserves the selected sidechat', async t => {
  const f = await fixture(t);
  const result = await openDesktopView(f.runtime, { kind: 'sidechat' }, signal());
  assert.deepEqual(result, { status: 'opened', kind: 'sidechat', sidechatId: 'sidechat-1' });
  assert.equal(f.ui.reviewOpen, true); assert.equal(f.ui.threads.t.reviewTab, 'sidechat');
  assert.equal(f.ui.threads.t.activePanelTab, 'tool:sidechat'); assert.equal(f.ui.threads.t.sidechatId, 'sidechat-1');
  assert.deepEqual(await openDesktopView(f.runtime, { kind: 'sidechat', sidechatId: 'missing' }, signal()), { status: 'not_opened', reason: 'sidechat_missing' });
});

test('opening the files explorer selects the requested project directory without opening a file', async t => {
  const f = await fixture(t);
  const result = await openDesktopView(f.runtime, { kind: 'files', directoryId: 'extra' }, signal());
  assert.deepEqual(result, { status: 'opened', kind: 'files', directoryId: 'extra' });
  assert.equal(f.ui.reviewOpen, true); assert.equal(f.ui.threads.t.reviewTab, 'files'); assert.equal(f.ui.threads.t.directoryId, 'extra');
  assert.equal(f.ui.threads.t.selectedPath, 'README.md');
});

test('an additional directory keeps same-name file views separate', async t => {
  const f = await fixture(t);
  await openDesktopView(f.runtime, { kind: 'file', directoryId: 'extra', path: 'entry.ts', line: 1 }, signal());
  assert.equal(f.ui.threads.t.selectedPath, 'README.md'); assert.equal(f.ui.threads.t.directoryId, 'extra');
  assert.equal(f.ui.threads.t.directoryViews?.extra.selectedPath, 'entry.ts');
  assert.deepEqual(f.ui.threads.t.directoryViews?.extra.openFiles, ['extra.md', 'entry.ts']);
  await assert.rejects(openDesktopView(f.runtime, { kind: 'file', directoryId: 'foreign', path: 'entry.ts' }, signal()), /Foreign/);
});

test('file names with leading spaces keep their exact identity', async t => {
  const f = await fixture(t);
  await writeFile(join(f.project, ' entry.ts'), 'different file\n');
  const result = await openDesktopView(f.runtime, { kind: 'file', path: ' entry.ts' }, signal());
  assert.deepEqual(result, { status: 'opened', kind: 'file', directoryId: 'p', path: ' entry.ts' });
  assert.equal(f.ui.threads.t.selectedPath, ' entry.ts');
});

test('invalid, outside and linked paths cannot mutate UI or open external apps', async t => {
  const f = await fixture(t), before = structuredClone(f.ui);
  await symlink(f.extra, join(f.project, 'linked'), 'junction');
  await writeFile(join(f.project, 'binary.dat'), Buffer.from([0, 1, 2]));
  for (const path of ['../extra/entry.ts', join(f.extra, 'entry.ts'), 'linked/entry.ts', 'missing.ts', '.'])
    await assert.rejects(openDesktopView(f.runtime, { kind: 'file', path }, signal()));
  await assert.rejects(openDesktopView(f.runtime, { kind: 'file', path: 'binary.dat', line: 1 }, signal()), /行定位/);
  assert.equal(f.publishes, 0); assert.deepEqual(f.ui, before);
});

test('late file validation never takes over a newer navigation or another window', async t => {
  const f = await fixture(t);
  f.hooks.read = () => { if (f.reads === 2) f.ui.threads.t.selectedPath = 'USER_NAVIGATED.ts'; };
  assert.deepEqual(await openDesktopView(f.runtime, { kind: 'file', path: 'entry.ts' }, signal()), { status: 'not_opened', reason: 'navigation_changed' });
  assert.equal(f.publishes, 0); assert.equal(f.ui.threads.t.selectedPath, 'USER_NAVIGATED.ts');
  const previousReads = f.reads;
  f.hooks.read = () => { if (f.reads === previousReads + 2) f.transfer(); };
  assert.equal((await openDesktopView(f.runtime, { kind: 'file', path: 'entry.ts' }, signal())).status, 'not_opened');
  assert.equal(f.publishes, 0);
});

test('draft edits during validation are preserved while directory changes are rejected', async t => {
  const f = await fixture(t);
  f.hooks.read = () => { f.ui.threads.t.draft!.text = 'NEWER_DRAFT'; };
  await openDesktopView(f.runtime, { kind: 'file', path: 'entry.ts' }, signal());
  assert.equal(f.ui.threads.t.draft?.text, 'NEWER_DRAFT');
  const before = structuredClone(f.ui), previous = f.directoryReads;
  f.hooks.directory = () => { if (f.directoryReads === previous + 2) f.thread.cwd = f.extra; };
  await assert.rejects(openDesktopView(f.runtime, { kind: 'file', path: 'entry.ts' }, signal()), /工作目录已变化/);
  assert.deepEqual(f.ui, before);
});

test('inactive views, child sessions and cancellation cannot navigate', async t => {
  const f = await fixture(t);
  f.ui.view = 'settings';
  assert.equal((await openDesktopView(f.runtime, { kind: 'summary' }, signal())).status, 'not_opened');
  f.ui.view = 'thread'; f.thread.subtaskId = crypto.randomUUID();
  await assert.rejects(openDesktopView(f.runtime, { kind: 'summary' }, signal()), /不能打开/);
  f.thread.subtaskId = undefined; const controller = new AbortController(); controller.abort();
  await assert.rejects(openDesktopView(f.runtime, { kind: 'summary' }, controller.signal), /abort/i);
  f.hide(); assert.equal((await openDesktopView(f.runtime, { kind: 'summary' }, signal())).status, 'not_opened');
  assert.equal(f.publishes, 0);
});
