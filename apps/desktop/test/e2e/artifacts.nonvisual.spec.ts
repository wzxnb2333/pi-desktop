import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ArtifactAnnotation, ArtifactAnnotationView, ArtifactCapture, ArtifactDocument } from '../../src/shared/artifacts.ts';
import type { Thread } from '../../src/shared/contracts.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>, fixture: Awaited<ReturnType<typeof acceptanceApp>>;
let server: Server, origin = '', requests = 0;
test.beforeAll(async () => {
  development = await startDevelopmentSource();
  server = createServer((_request, response) => { requests++; response.setHeader('Access-Control-Allow-Origin', '*'); response.end('network allowed'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No server'); origin = 'http://127.0.0.1:' + address.port;
});
test.afterAll(async () => { server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); await development?.server.close(); });
test.beforeEach(async () => { requests = 0; fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]); } });
async function open(path: string) { const snapshot = await fixture.snapshot(); await fixture.invoke({ op: 'ui.update', ui: { ...snapshot.data.ui, reviewOpen: true } }); await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { reviewTab: 'files', selectedPath: path, openFiles: [path] } }); await expect(fixture.page.getByRole('region', { name: '产物预览', exact: true })).toBeVisible(); }
async function inspect(code: string) { return fixture.app.evaluate(({ webContents }, source) => webContents.getAllWebContents().find(item => item.getURL().startsWith('pi-artifact:'))?.executeJavaScript(source), code); }
async function pdfFile() {
  const encoded = await fixture.app.evaluate(async ({ BrowserWindow }) => {
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try { await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<style>@page{size:A4}section{break-after:page;font:24px sans-serif}</style><section><h1>Alpha 中文文档</h1><p>First page text</p></section><section><h1>Needle Beta 第二页</h1><p>Searchable offline content</p></section>')); return (await window.webContents.printToPDF({ preferCSSPageSize: true })).toString('base64'); } finally { window.destroy(); }
  });
  await writeFile(join(fixture.project, 'document.pdf'), Buffer.from(encoded, 'base64'));
}

test('HTML renders local assets with isolated permissions, explicit network grants, source drafts and versioned annotations', async () => {
  await writeFile(join(fixture.project, 'style.css'), 'h1{color:rgb(12,34,56)}');
  const html = '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="style.css"><h1>隔离产物</h1><script>window.safety=[typeof require,typeof process,typeof window.desktop];fetch("' + origin + '/asset").then(r=>r.text()).then(t=>document.body.dataset.network=t).catch(()=>{});</script>';
  await writeFile(join(fixture.project, 'preview.html'), html); await open('preview.html');
  await expect.poll(() => inspect('document.querySelector("h1")?.textContent')).toBe('隔离产物');
  expect(await inspect('window.safety')).toEqual(['undefined', 'undefined', 'undefined']); expect(await inspect('getComputedStyle(document.querySelector("h1")).color')).toBe('rgb(12, 34, 56)');
  await expect(fixture.page.locator('.artifact-network summary')).toContainText('1'); expect(requests).toBe(0);
  await fixture.page.locator('.artifact-network summary').click();
  await fixture.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
  await fixture.page.getByRole('button', { name: '允许此来源', exact: true }).click(); expect(requests).toBe(0);
  await fixture.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  await fixture.page.getByRole('button', { name: '允许此来源', exact: true }).click(); await expect.poll(() => inspect('document.body.dataset.network')).toBe('network allowed'); expect(requests).toBeGreaterThan(0);
  await fixture.page.getByRole('button', { name: '撤销授权', exact: true }).click(); await expect.poll(() => inspect('document.body.dataset.network')).toBeUndefined();
  await fixture.page.getByRole('button', { name: 'HTML 源码', exact: true }).click(); const editor = fixture.page.getByLabel('文件内容 preview.html'); await editor.fill(html + '\n<!-- unsaved -->');
  await fixture.page.getByRole('button', { name: '渲染预览', exact: true }).click(); await expect(fixture.page.getByText('预览使用磁盘版本；未保存的源码保留在编辑器中。')).toBeVisible();
  await expect.poll(() => inspect('document.querySelector("h1")?.textContent')).toBe('隔离产物');
  await fixture.page.getByRole('button', { name: '标注预览区域', exact: true }).click(); const panel = fixture.page.getByRole('dialog', { name: '产物标注', exact: true });
  await expect(panel.getByAltText('产物标注截图')).toBeVisible(); await panel.getByLabel('标注说明').fill('改进标题布局'); await panel.getByRole('button', { name: '保存标注', exact: true }).click();
  await expect(panel.getByText('标注与当前文件版本一致')).toBeVisible();
  await panel.getByRole('button', { name: '加入输入草稿', exact: true }).click(); await expect(panel.getByText('已加入输入草稿')).toBeVisible();
  const saved = (await fixture.snapshot()).data.threads[0].artifactAnnotations![0]; expect(saved.kind).toBe('html'); expect(Object.keys(saved.resources)).toContain('style.css');
  await writeFile(join(fixture.project, 'style.css'), 'h1{font-size:50px}'); await panel.getByRole('button', { name: '重新检查标注', exact: true }).click(); await expect(panel.getByText('文件或依赖资源已变化，此标注已过期；保留原始截图，不定位到新版本。')).toBeVisible();
  await panel.getByRole('button', { name: '关闭', exact: true }).click(); await fixture.page.getByRole('button', { name: 'HTML 源码', exact: true }).click(); await expect(editor).toHaveValue(html + '\n<!-- unsaved -->');
  await editor.fill(html); await fixture.restart(); expect((await fixture.snapshot()).data.threads[0].artifactAnnotations![0]).toEqual(saved);
  expect((await fixture.invoke({ op: 'artifact.annotation', threadId: 't', annotationId: saved.id, action: 'read' }) as ArtifactAnnotationView).stale).toBe(true);
});

test('real local PDF supports paging, zoom, offline text search, page annotations and bilingual layouts', async () => {
  await pdfFile(); await open('document.pdf');
  await expect(fixture.page.getByLabel('PDF 页码')).toHaveValue('1'); await expect(fixture.page.getByRole('button', { name: '标注此页', exact: true })).toBeEnabled();
  const canvas = fixture.page.getByLabel('PDF 当前页面'); expect(await canvas.evaluate((node: HTMLCanvasElement) => node.width)).toBeGreaterThan(100);
  expect(await canvas.evaluate((node: HTMLCanvasElement) => { const bytes = node.getContext('2d')!.getImageData(0, 0, node.width, node.height).data; let dark = 0; for (let i = 0; i < bytes.length; i += 4) if (bytes[i] < 150 && bytes[i + 3] > 0) dark++; return dark; })).toBeGreaterThan(100);
  await fixture.page.getByLabel('搜索 PDF').fill('Needle Beta'); await fixture.page.locator('.pdf-preview').getByRole('button', { name: '搜索', exact: true }).click();
  await fixture.page.getByRole('button', { name: /第 2 页 · Needle Beta/ }).click(); await expect(fixture.page.getByLabel('PDF 页码')).toHaveValue('2');
  await fixture.page.getByLabel('PDF 缩放').selectOption('0.5'); await expect(fixture.page.getByRole('button', { name: '标注此页', exact: true })).toBeEnabled();
  await fixture.page.getByRole('button', { name: '标注此页', exact: true }).click(); const panel = fixture.page.getByRole('dialog', { name: '产物标注', exact: true });
  await panel.getByLabel('标注说明').fill('第二页需要修改'); await panel.getByRole('button', { name: '保存标注', exact: true }).click(); await expect(panel.getByText('标注与当前文件版本一致')).toBeVisible();
  const saved = (await fixture.snapshot()).data.threads[0].artifactAnnotations![0]; expect(saved.page).toBe(2); expect(saved.kind).toBe('pdf');
  for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['dark', 'light'] as const) for (const [width, height] of [[1440, 940], [1000, 700], [1280, 800]]) {
    const snapshot = await fixture.snapshot(); await fixture.invoke({ op: 'ui.update', ui: { ...snapshot.data.ui, locale } }); await fixture.invoke({ op: 'settings.patch', patch: { theme } }); await fixture.app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height]);
    await expect.poll(() => fixture.page.locator('.dialog:has(.artifact-annotations)').evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.getBoundingClientRect().right <= innerWidth + 1)).toBe(true);
  }
  await fixture.page.getByRole('dialog', { name: 'Artifact annotations', exact: true }).getByRole('button', { name: 'Close', exact: true }).click(); await expect(fixture.page.getByLabel('PDF page number')).toHaveValue('2'); await expect(fixture.page.getByLabel('PDF zoom')).toHaveValue('0.5');
  await fixture.restart(); expect((await fixture.snapshot()).data.threads[0].artifactAnnotations![0]).toEqual(saved);
});

test('artifact cancellation, path isolation, annotation save retry, corruption and attachment retention', async () => {
  await writeFile(join(fixture.project, 'preview.html'), '<h1>Isolation test</h1>');
  await expect(fixture.invoke({ op: 'artifact.open', threadId: 't', directoryId: 'p', path: '../desktop.json', requestId: crypto.randomUUID() })).rejects.toThrow();
  await writeFile(join(fixture.project, 'bad.pdf'), 'not a pdf'); await expect(fixture.invoke({ op: 'artifact.open', threadId: 't', directoryId: 'p', path: 'bad.pdf', requestId: crypto.randomUUID() })).rejects.toThrow('有效的 PDF');
  const document = await fixture.invoke({ op: 'artifact.open', threadId: 't', directoryId: 'p', path: 'preview.html', requestId: crypto.randomUUID() }) as ArtifactDocument;
  await expect.poll(async () => (await fixture.invoke({ op: 'artifact.status', threadId: 't', previewId: document.id }) as { loading: boolean }).loading).toBe(false);
  const capture = await fixture.invoke({ op: 'artifact.capture', threadId: 't', previewId: document.id }) as ArtifactCapture;
  const other = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }) as Thread;
  const rect = { x: 1, y: 1, width: 40, height: 20 };
  await expect(fixture.invoke({ op: 'artifact.annotationSave', threadId: other.id, captureId: capture.id, rect, comment: 'wrong' })).rejects.toThrow('已失效');
  const target = join(fixture.storage, 'attachments', 't', 'artifact-annotations', capture.id + '.png'); await mkdir(target, { recursive: true });
  await expect(fixture.invoke({ op: 'artifact.annotationSave', threadId: 't', captureId: capture.id, rect, comment: 'retry' })).rejects.toThrow(); await rm(target, { recursive: true });
  const saved = await fixture.invoke({ op: 'artifact.annotationSave', threadId: 't', captureId: capture.id, rect, comment: 'retry' }) as ArtifactAnnotation;
  const copy = await fixture.invoke({ op: 'artifact.annotation', threadId: 't', annotationId: saved.id, action: 'attach' }) as { path: string }; const bytes = await readFile(copy.path);
  await writeFile(target, 'damaged'); await expect(fixture.invoke({ op: 'artifact.annotation', threadId: 't', annotationId: saved.id, action: 'read' })).rejects.toThrow('损坏'); expect((await fixture.snapshot()).data.threads.find(item => item.id === 't')!.artifactAnnotations).toHaveLength(1);
  await fixture.invoke({ op: 'artifact.annotation', threadId: 't', annotationId: saved.id, action: 'remove' }); expect(await readFile(copy.path)).toEqual(bytes); await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' });
  await fixture.invoke({ op: 'artifact.close', threadId: 't', previewId: document.id }); await expect(fixture.invoke({ op: 'artifact.capture', threadId: 't', previewId: document.id })).rejects.toThrow('关闭');
});

test('artifact metadata and screenshot failures keep retryable state across real IPC and restart', async () => {
  await writeFile(join(fixture.project, 'recovery.html'), '<h1>Recovery</h1>'); await open('recovery.html');
  await expect(fixture.page.getByRole('button', { name: '标注预览区域', exact: true })).toBeEnabled(); await fixture.page.getByRole('button', { name: '标注预览区域', exact: true }).click();
  let panel = fixture.page.getByRole('dialog', { name: '产物标注', exact: true }); await panel.getByLabel('标注说明', { exact: true }).fill('Retry artifact');
  const blocked = join(fixture.storage, 'desktop.json.tmp'); await mkdir(blocked); await panel.getByRole('button', { name: '保存标注', exact: true }).click(); await expect(panel.getByRole('alert')).toBeVisible();
  await expect(panel.getByLabel('标注说明', { exact: true })).toHaveValue('Retry artifact'); expect((await fixture.snapshot()).data.threads[0].artifactAnnotations ?? []).toEqual([]);
  await rm(blocked, { recursive: true }); await fixture.invoke({ op: 'settings.patch', patch: { theme: 'dark' } }); expect(JSON.parse(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')).threads[0].artifactAnnotations ?? []).toEqual([]);
  await panel.getByRole('button', { name: '保存标注', exact: true }).click(); await expect(panel.getByText('标注与当前文件版本一致', { exact: true })).toBeVisible();
  const saved = (await fixture.snapshot()).data.threads[0].artifactAnnotations![0];
  expect(await fixture.invoke({ op: 'artifact.annotationSave', threadId: 't', captureId: saved.id, rect: saved.rect, comment: saved.comment })).toEqual(saved);
  expect((await fixture.snapshot()).data.threads[0].artifactAnnotations).toHaveLength(1);
  await panel.getByRole('button', { name: '加入输入草稿', exact: true }).click(); await expect(panel.getByText('已加入输入草稿', { exact: true })).toBeVisible(); const draft = (await fixture.snapshot()).data.ui.threads.t.draft!;
  const image = join(fixture.storage, 'attachments', 't', 'artifact-annotations', saved.id + '.png'), bytes = await readFile(image); await rename(image, image + '.held'); await mkdir(image);
  await panel.getByRole('button', { name: '删除标注 Retry artifact', exact: true }).click(); let confirm = fixture.page.getByRole('dialog', { name: '删除此产物标注？', exact: true }); await confirm.getByRole('button', { name: '删除', exact: true }).click(); await expect(confirm.getByRole('alert')).toBeVisible();
  expect((await fixture.snapshot()).data.threads[0].artifactAnnotations![0].deleting).toBe(true); await fixture.restart(); expect((await fixture.snapshot()).data.threads[0].artifactAnnotations![0].deleting).toBe(true);
  await fixture.page.getByRole('button', { name: '产物标注', exact: true }).click(); panel = fixture.page.getByRole('dialog', { name: '产物标注', exact: true }); await expect(panel.getByText('删除尚未完成，可重试。', { exact: true })).toBeVisible();
  await expect(fixture.invoke({ op: 'artifact.annotation', threadId: 't', annotationId: saved.id, action: 'attach' })).rejects.toThrow('正在删除');
  await rm(image, { recursive: true }); await rename(image + '.held', image); await panel.getByRole('button', { name: '重试删除标注 Retry artifact', exact: true }).click(); confirm = fixture.page.getByRole('dialog', { name: '删除此产物标注？', exact: true }); await confirm.getByRole('button', { name: '删除', exact: true }).click();
  await expect(panel.getByText('暂无产物标注', { exact: true })).toBeVisible(); await expect(access(image)).rejects.toMatchObject({ code: 'ENOENT' }); expect(await readFile(draft.attachments[0])).toEqual(bytes);
  await fixture.invoke({ op: 'artifact.annotation', threadId: 't', annotationId: saved.id, action: 'remove' }); await fixture.restart(); expect((await fixture.snapshot()).data.threads[0].artifactAnnotations).toEqual([]);
});

test('real PDF search clears obsolete matches and malformed files recover after reload with bilingual feedback', async () => {
  await pdfFile(); await open('document.pdf'); await expect(fixture.page.getByRole('button', { name: '标注此页', exact: true })).toBeEnabled();
  await fixture.page.getByLabel('搜索 PDF', { exact: true }).fill('Needle Beta'); await fixture.page.locator('.pdf-preview').getByRole('button', { name: '搜索', exact: true }).click(); await expect(fixture.page.getByRole('button', { name: /第 2 页 · Needle Beta/ })).toBeVisible();
  await fixture.page.getByLabel('搜索 PDF', { exact: true }).fill('Alpha'); await expect(fixture.page.getByRole('list', { name: 'PDF 搜索结果' })).toHaveCount(0); await fixture.page.locator('.pdf-preview').getByRole('button', { name: '搜索', exact: true }).click(); await expect(fixture.page.getByRole('button', { name: /第 1 页 · Alpha/ })).toBeVisible();
  await fixture.page.getByLabel('搜索 PDF', { exact: true }).fill(''); await expect(fixture.page.getByRole('list', { name: 'PDF 搜索结果' })).toHaveCount(0);
  await writeFile(join(fixture.project, 'broken.pdf'), '%PDF-1.7\ninvalid document'); await open('broken.pdf'); await expect(fixture.page.locator('.pdf-preview').getByRole('alert')).toContainText('无法解析 PDF：');
  const snapshot = await fixture.snapshot(); await fixture.invoke({ op: 'ui.update', ui: { ...snapshot.data.ui, locale: 'en-US' } }); await expect(fixture.page.locator('.pdf-preview').getByRole('alert')).toContainText('Unable to parse PDF:');
  await writeFile(join(fixture.project, 'broken.pdf'), await readFile(join(fixture.project, 'document.pdf'))); await fixture.page.getByRole('button', { name: 'Reload preview', exact: true }).click(); await expect(fixture.page.getByRole('button', { name: 'Annotate page', exact: true })).toBeEnabled(); await expect(fixture.page.locator('.pdf-preview').getByRole('alert')).toHaveCount(0);
});

test('HTML capture timeout releases the operation and preserves a newer request to show the preview', async () => {
  await writeFile(join(fixture.project, 'timeout.html'), '<h1>Capture timeout recovery</h1>');
  const document = await fixture.invoke({ op: 'artifact.open', threadId: 't', directoryId: 'p', path: 'timeout.html', requestId: crypto.randomUUID() }) as ArtifactDocument;
  await expect.poll(async () => (await fixture.invoke({ op: 'artifact.status', threadId: 't', previewId: document.id }) as { loading: boolean }).loading).toBe(false);
  await fixture.app.evaluate(({ webContents }) => {
    const contents = webContents.getAllWebContents().find(item => item.getURL().startsWith('pi-artifact:'))!;
    const original = contents.capturePage.bind(contents);
    const scope = globalThis as typeof globalThis & { artifactWait?: { requested: boolean; release(): void } };
    scope.artifactWait = { requested: false, release() {} };
    contents.capturePage = options => new Promise((resolve, reject) => {
      scope.artifactWait!.requested = true;
      scope.artifactWait!.release = () => { contents.capturePage = original; void original(options).then(resolve, reject); delete scope.artifactWait; };
    });
  });
  const pending = fixture.invoke({ op: 'artifact.capture', threadId: 't', previewId: document.id });
  const expired = expect(pending).rejects.toThrow('产物截图超时');
  try {
    await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { artifactWait?: { requested: boolean } }).artifactWait?.requested)).toBe(true);
    await expect(fixture.invoke({ op: 'artifact.capture', threadId: 't', previewId: document.id })).rejects.toThrow('正在截取产物');
    await fixture.invoke({ op: 'artifact.bounds', threadId: 't', previewId: document.id, bounds: { x: 30, y: 100, width: 500, height: 300 } });
    await expired;
    expect(await fixture.app.evaluate(({ BrowserWindow, WebContentsView }) => BrowserWindow.getAllWindows().some(window => window.contentView.children.some(view => view instanceof WebContentsView && view.webContents.getURL().startsWith('pi-artifact:') && view.getVisible())))).toBe(true);
    expect((await fixture.snapshot()).data.threads[0].artifactAnnotations ?? []).toEqual([]);
  } finally { await fixture.app.evaluate(() => (globalThis as typeof globalThis & { artifactWait?: { release(): void } }).artifactWait?.release()); }
  const retry = await fixture.invoke({ op: 'artifact.capture', threadId: 't', previewId: document.id }) as ArtifactCapture;
  expect(retry.width).toBeGreaterThan(100); expect(retry.height).toBeGreaterThan(100);
  await fixture.invoke({ op: 'artifact.annotationSave', threadId: 't', captureId: retry.id, rect: { x: 1, y: 1, width: 40, height: 30 }, comment: 'Captured after timeout' });
  expect((await fixture.snapshot()).data.threads[0].artifactAnnotations).toHaveLength(1);
});
