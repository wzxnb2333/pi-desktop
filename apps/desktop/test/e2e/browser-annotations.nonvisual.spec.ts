import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';
import type { AnnotationCapture, BrowserAnnotation } from '../../src/shared/browser-annotations.ts';
import type { Thread } from '../../src/shared/contracts.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
let server: Server; let site = ''; let project = '';
test.beforeAll(async () => {
  development = await startDevelopmentSource();
  server = createServer(async (_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(await readFile(join(project, 'annotation.html'), 'utf8')); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test address'); site = 'http://127.0.0.1:' + address.port;
});
test.afterAll(async () => { server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); await development?.server.close(); });
test.beforeEach(async () => {
  fixture = await acceptanceApp(development.url); project = fixture.project;
  await writeFile(join(project, 'annotation.html'), '<!doctype html><title>Annotation fixture</title><style>body{font:20px sans-serif;background:#fafafa}button{margin:30px;padding:20px}</style><h1>原始页面</h1><button>保存</button><p>内容区域</p>');
  await fixture.page.getByLabel('视图菜单').click(); await fixture.page.getByRole('menuitem', { name: '切换浏览器预览', exact: true }).click();
  await fixture.invoke({ op: 'browser.open', threadId: 't', tabId: 'page', url: site });
  await expect(fixture.page.getByLabel('预览地址')).toHaveValue(site + '/');
});
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]); } });
async function menu(name: string) { await fixture.page.getByLabel('浏览器操作', { exact: true }).click(); await fixture.page.getByRole('menuitem', { name, exact: true }).click(); }

test('page annotations preserve real screenshots, add context to the draft and detect an agent edit', async () => {
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: '保留现有草稿', attachments: [] } } });
  await menu('标注当前网页'); let panel = fixture.page.getByRole('dialog', { name: '网页标注', exact: true });
  await expect(panel.getByAltText('网页标注截图')).toBeVisible();
  expect(await panel.getByAltText('网页标注截图').evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(100);
  const buttonOption = await panel.getByLabel('页面元素').locator('option').evaluateAll(nodes => nodes.find(node => node.textContent === 'button · 保存')?.getAttribute('value'));
  expect(buttonOption).toBeTruthy(); await panel.getByLabel('页面元素').selectOption(buttonOption!);
  await panel.getByLabel('标注说明').fill('请修改此按钮 <script>window.UNSAFE=true</script>'); await panel.getByRole('button', { name: '保存标注', exact: true }).click();
  await expect(panel.getByText('标注与当前页面一致', { exact: true })).toBeVisible();
  const saved = (await fixture.snapshot()).data.threads[0].browserAnnotations![0];
  expect(saved.element?.tag).toBe('button'); expect(saved.comment).toContain('<script>');
  const original = await readFile(join(fixture.storage, 'attachments', 't', 'annotations', saved.id + '.png'));
  await panel.getByRole('button', { name: '加入输入草稿', exact: true }).click(); await expect(panel.getByText('已加入输入草稿', { exact: true })).toBeVisible();
  const draft = (await fixture.snapshot()).data.ui.threads.t.draft!;
  expect(draft.text).toContain('保留现有草稿'); expect(draft.text).toContain(site); expect(draft.attachments).toHaveLength(1);
  expect(await readFile(draft.attachments[0])).toEqual(original);
  expect(await fixture.page.evaluate(() => 'UNSAFE' in window)).toBe(false);
  await panel.getByRole('button', { name: '关闭', exact: true }).click();
  fixture.requestTool('write', { path: 'annotation.html', content: '<!doctype html><title>Updated fixture</title><h1>智能体实际修改</h1><button>新的按钮</button>' });
  await fixture.invoke({ op: 'thread.send', id: 't', text: draft.text, attachments: draft.attachments });
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  expect(await readFile(join(project, 'annotation.html'), 'utf8')).toContain('智能体实际修改');
  await fixture.invoke({ op: 'browser.action', threadId: 't', tabId: 'page', action: 'reload' });
  await expect.poll(async () => fixture.app.evaluate(async ({ webContents }, origin) => webContents.getAllWebContents().find(item => item.getURL().startsWith(origin))?.executeJavaScript('document.title'), site)).toBe('Updated fixture');
  await menu('已保存的标注'); await fixture.page.getByRole('button', { name: /^请修改此按钮 <script>/ }).click();
  await expect(panel.getByText('页面已变化或未打开，此标注可能过期；截图仍为保存时的版本。', { exact: true })).toBeVisible();
  expect(await readFile(join(fixture.storage, 'attachments', 't', 'annotations', saved.id + '.png'))).toEqual(original);
  await panel.getByRole('button', { name: '关闭', exact: true }).click(); await fixture.restart();
  expect((await fixture.snapshot()).data.threads[0].browserAnnotations?.[0]).toEqual(saved);
  await menu('已保存的标注'); panel = fixture.page.getByRole('dialog', { name: '网页标注', exact: true }); await fixture.page.getByRole('button', { name: /^请修改此按钮 <script>/ }).click();
  for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark'] as const) for (const [width, height] of [[1440, 940], [1000, 700], [1280, 800]]) {
    const snapshot = await fixture.snapshot(); await fixture.invoke({ op: 'ui.update', ui: { ...snapshot.data.ui, locale } }); await fixture.invoke({ op: 'settings.patch', patch: { theme } });
    await fixture.app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height]);
    await expect.poll(() => fixture.page.locator('.dialog:has(.browser-annotations)').evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.getBoundingClientRect().right <= innerWidth + 1)).toBe(true);
  }
  const snapshot = await fixture.snapshot(); await fixture.invoke({ op: 'ui.update', ui: { ...snapshot.data.ui, locale: 'zh-CN' } });
  await panel.getByRole('button', { name: '删除标注 ' + saved.comment, exact: true }).click();
  await fixture.page.getByRole('dialog', { name: '删除此网页标注？' }).getByRole('button', { name: '删除', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].browserAnnotations?.length).toBe(0);
  await expect(access(join(fixture.storage, 'attachments', 't', 'annotations', saved.id + '.png'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(draft.attachments[0])).toEqual(original);
});

test('regions, capture ownership, storage failure retry and cancellation keep annotation state consistent', async () => {
  const capture = await fixture.invoke({ op: 'browser.annotationCapture', threadId: 't', tabId: 'page' }) as AnnotationCapture;
  const selection = { mode: 'region' as const, rect: { x: 20, y: 30, width: 120, height: 70 }, comment: '区域注释' };
  const other = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }) as Thread;
  await expect(fixture.invoke({ op: 'browser.annotationSave', threadId: other.id, captureId: capture.id, selection })).rejects.toThrow('已失效');
  const target = join(fixture.storage, 'attachments', 't', 'annotations', capture.id + '.png'); await mkdir(target, { recursive: true });
  await expect(fixture.invoke({ op: 'browser.annotationSave', threadId: 't', captureId: capture.id, selection })).rejects.toThrow();
  expect((await fixture.snapshot()).data.threads.find(item => item.id === 't')?.browserAnnotations).toBeUndefined();
  await rm(target, { recursive: true });
  const saved = await fixture.invoke({ op: 'browser.annotationSave', threadId: 't', captureId: capture.id, selection }) as BrowserAnnotation;
  expect(saved.rect).toEqual(selection.rect); expect(saved.mode).toBe('region');
  await expect(fixture.invoke({ op: 'browser.annotation', threadId: other.id, annotationId: saved.id, action: 'read' })).rejects.toThrow('不存在');
  const discarded = await fixture.invoke({ op: 'browser.annotationCapture', threadId: 't', tabId: 'page' }) as AnnotationCapture;
  await fixture.invoke({ op: 'browser.annotationDiscard', threadId: 't', captureId: discarded.id });
  await expect(fixture.invoke({ op: 'browser.annotationSave', threadId: 't', captureId: discarded.id, selection })).rejects.toThrow('已失效');
  const snapshot = await fixture.snapshot(); await fixture.invoke({ op: 'ui.update', ui: { ...snapshot.data.ui, activeThreadId: 't' } });
  await menu('标注当前网页'); const panel = fixture.page.getByRole('dialog', { name: '网页标注', exact: true });
  await expect(panel.getByAltText('网页标注截图')).toBeVisible(); await panel.getByRole('button', { name: '选择区域', exact: true }).click();
  await panel.getByLabel('水平位置').fill('10'); await panel.getByLabel('垂直位置').fill('10'); await panel.getByLabel('区域宽度').fill('160'); await panel.getByLabel('区域高度').fill('60');
  await panel.getByLabel('标注说明').fill('暂不放弃'); await panel.getByRole('button', { name: '关闭', exact: true }).click();
  await fixture.page.getByRole('dialog', { name: '放弃未保存的标注？' }).getByRole('button', { name: '取消', exact: true }).click();
  await expect(panel.getByLabel('标注说明')).toHaveValue('暂不放弃');
  await panel.getByRole('button', { name: '保存标注', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(item => item.id === 't')?.browserAnnotations?.length).toBe(2);
  await fixture.restart(); expect((await fixture.snapshot()).data.threads.find(item => item.id === 't')?.browserAnnotations).toHaveLength(2);
});

test('annotation persistence failures retain selection, retry once and survive unrelated saves and restart', async () => {
  await menu('标注当前网页'); const panel = fixture.page.getByRole('dialog', { name: '网页标注', exact: true });
  await expect(panel.getByAltText('网页标注截图')).toBeVisible(); await panel.getByRole('button', { name: '选择区域', exact: true }).click();
  await panel.getByLabel('标注说明', { exact: true }).fill('Retry the original annotation');
  const blocked = join(fixture.storage, 'desktop.json.tmp'); await mkdir(blocked);
  await panel.getByRole('button', { name: '保存标注', exact: true }).click(); await expect(panel.getByRole('alert')).toBeVisible();
  await expect(panel.getByLabel('标注说明', { exact: true })).toHaveValue('Retry the original annotation');
  expect((await fixture.snapshot()).data.threads[0].browserAnnotations ?? []).toEqual([]);
  await rm(blocked, { recursive: true }); await fixture.invoke({ op: 'settings.patch', patch: { theme: 'dark' } });
  expect(JSON.parse(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')).threads[0].browserAnnotations ?? []).toEqual([]);
  await panel.getByRole('button', { name: '保存标注', exact: true }).click(); await expect(panel.getByText('标注已保存', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '关闭', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: '加入输入草稿', exact: true }).click(); await expect(panel.getByText('已加入输入草稿', { exact: true })).toBeVisible();
  const firstDraft = (await fixture.snapshot()).data.ui.threads.t.draft;
  await panel.getByRole('button', { name: '加入输入草稿', exact: true }).click(); await expect(panel.getByText('已加入输入草稿', { exact: true })).toBeVisible();
  expect((await fixture.snapshot()).data.ui.threads.t.draft).toEqual(firstDraft);
  const saved = (await fixture.snapshot()).data.threads[0].browserAnnotations!;
  expect(saved).toHaveLength(1); await fixture.restart(); expect((await fixture.snapshot()).data.threads[0].browserAnnotations).toEqual(saved);
});

test('annotation screenshot deletion failures expose a durable retry and preserve already attached context', async () => {
  const capture = await fixture.invoke({ op: 'browser.annotationCapture', threadId: 't', tabId: 'page' }) as AnnotationCapture;
  const saved = await fixture.invoke({ op: 'browser.annotationSave', threadId: 't', captureId: capture.id, selection: { mode: 'region', rect: { x: 10, y: 10, width: 60, height: 30 }, comment: 'Delete after recovery' } }) as BrowserAnnotation;
  const attachment = await fixture.invoke({ op: 'browser.annotation', threadId: 't', annotationId: saved.id, action: 'attach' }) as { path: string };
  const screenshot = join(fixture.storage, 'attachments', 't', 'annotations', saved.id + '.png');
  const bytes = await readFile(screenshot); await rename(screenshot, screenshot + '.held'); await mkdir(screenshot);
  await menu('已保存的标注'); let panel = fixture.page.getByRole('dialog', { name: '网页标注', exact: true });
  await panel.getByRole('button', { name: '删除标注 Delete after recovery', exact: true }).click();
  let confirm = fixture.page.getByRole('dialog', { name: '删除此网页标注？', exact: true }); await confirm.getByRole('button', { name: '删除', exact: true }).click();
  await expect(confirm.getByRole('alert')).toBeVisible(); expect((await fixture.snapshot()).data.threads[0].browserAnnotations![0].deleting).toBe(true);
  await confirm.getByRole('button', { name: '取消', exact: true }).click(); await expect(panel.getByText('删除尚未完成，可重试。', { exact: true })).toBeVisible();
  await fixture.restart(); expect((await fixture.snapshot()).data.threads[0].browserAnnotations![0].deleting).toBe(true);
  await menu('已保存的标注'); panel = fixture.page.getByRole('dialog', { name: '网页标注', exact: true }); await expect(panel.getByRole('button', { name: '重试删除标注 Delete after recovery', exact: true })).toBeEnabled();
  await expect(fixture.invoke({ op: 'browser.annotation', threadId: 't', annotationId: saved.id, action: 'attach' })).rejects.toThrow('正在删除');
  await rm(screenshot, { recursive: true }); await rename(screenshot + '.held', screenshot);
  await panel.getByRole('button', { name: '重试删除标注 Delete after recovery', exact: true }).click(); confirm = fixture.page.getByRole('dialog', { name: '删除此网页标注？', exact: true }); await confirm.getByRole('button', { name: '删除', exact: true }).click();
  await expect(panel.getByText('暂无网页标注', { exact: true })).toBeVisible(); await expect(confirm).toHaveCount(0);
  await expect(access(screenshot)).rejects.toMatchObject({ code: 'ENOENT' }); expect(await readFile(attachment.path)).toEqual(bytes);
  await fixture.invoke({ op: 'browser.annotation', threadId: 't', annotationId: saved.id, action: 'remove' });
  await fixture.restart(); expect((await fixture.snapshot()).data.threads[0].browserAnnotations).toEqual([]);
});
