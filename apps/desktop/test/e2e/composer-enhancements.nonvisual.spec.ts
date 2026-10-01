import { access, mkdir, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';
import { contextDetailSchema, draftSnapshotSchema, sendReceiptSchema } from '../../src/shared/composer.ts';
import { z } from 'zod';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]); } });
const input = () => fixture.page.locator('.composer-input');
async function addMenu(label: string) { await fixture.page.getByRole('button', { name: '添加上下文与操作', exact: true }).click(); await fixture.page.getByRole('menuitem', { name: label, exact: true }).click(); }
async function idle() { await expect.poll(async () => (await fixture.snapshot()).data.threads.find(item => item.id === 't')?.status).toBe('idle'); }

test('composer enhancement: expanded editor, complete draft history, templates and commands', async () => {
  const text = '# Large draft' + String.fromCharCode(10, 10) + '中文正文 with context. '.repeat(80); await input().fill(text);
  await input().evaluate(element => { (element as HTMLTextAreaElement).setSelectionRange(4, 15); });
  await fixture.page.getByRole('button', { name: '展开编辑', exact: true }).click(); await expect(fixture.page.locator('.composer-expanded')).toBeVisible();
  expect(await input().evaluate(element => [(element as HTMLTextAreaElement).selectionStart, (element as HTMLTextAreaElement).selectionEnd])).toEqual([4, 15]);
  await fixture.page.getByRole('button', { name: '预览草稿' }).click(); await expect(fixture.page.locator('.composer-draft-preview h1')).toHaveText('Large draft');
  await fixture.page.getByRole('button', { name: '编辑草稿' }).click(); await fixture.page.getByRole('button', { name: '收起编辑' }).click(); await expect(input()).toHaveValue(text);
  const attachment = await fixture.invoke({ op: 'attachment.add', threadId: 't', files: [{ name: 'history.txt', base64: Buffer.from('saved attachment').toString('base64') }] }) as string[];
  const reference = contextDetailSchema.parse(await fixture.invoke({ op: 'composer.contextDetail', threadId: 't', reference: { kind: 'file', id: 'README.md', directoryId: 'p', label: 'README.md' } })).reference;
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text, attachments: attachment }, contextReferences: [reference] } });
  const history = z.array(draftSnapshotSchema).parse(await fixture.invoke({ op: 'composer.history', threadId: 't', action: 'save' }));
  await input().fill('replacement'); await addMenu('草稿历史'); await fixture.page.getByRole('dialog').getByRole('button', { name: '恢复此版本' }).first().click();
  await expect(input()).toHaveValue(text); await expect(fixture.page.locator('.composer-attachment')).toHaveCount(1); await expect(fixture.page.locator('.composer-reference-open')).toHaveCount(1);
  expect(history[0].attachments).toEqual(attachment);
  await addMenu('提示词模板'); await fixture.page.getByLabel('模板名称').fill('我的检查'); await fixture.page.getByLabel('模板内容').fill('Run local checks'); await fixture.page.getByRole('button', { name: '保存模板' }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.settings.promptTemplates.length).toBe(1); await fixture.page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await input().fill('/我的'); await fixture.page.getByRole('option', { name: /我的检查/ }).click(); await expect(input()).toHaveValue('Run local checks');
  await input().fill('/help'); await fixture.page.getByRole('option', { name: /输入帮助/ }).click(); await expect(fixture.page.getByRole('dialog')).toContainText('输入 /'); await fixture.page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await input().fill('/goal'); await fixture.page.getByRole('option', { name: /持续目标/ }).click(); await expect(fixture.page.getByRole('dialog').getByLabel('目标说明')).toBeVisible(); await fixture.page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await input().fill('/review'); await fixture.page.getByRole('option', { name: /建议审查改动/ }).click(); expect(fixture.calls).toHaveLength(0);
  await fixture.restart(); expect((await fixture.snapshot()).data.settings.promptTemplates[0].text).toBe('Run local checks'); expect((await fixture.snapshot()).data.threads[0].draftHistory!.some(item => item.id === history[0].id)).toBe(true);
});

test('composer enhancement: quote selection, bilingual compact layouts and failed send recovery', async () => {
  await fixture.invoke({ op: 'thread.send', id: 't', text: 'first source', attachments: [] }); await idle();
  const message = fixture.page.locator('.message.assistant').last(); await message.scrollIntoViewIfNeeded();
  await expect(message.getByRole('button', { name: '引用消息' })).toHaveCount(0);
  const point = await message.locator('[data-quote-start]').first().evaluate(element => { const range = document.createRange(); range.setStart(element.firstChild!, 0); range.setEnd(element.firstChild!, 4); const box = range.getBoundingClientRect(); return { x: box.left, y: box.top + box.height / 2, width: box.width }; });
  await fixture.page.mouse.move(point.x + 1, point.y); await fixture.page.mouse.down(); await fixture.page.mouse.move(point.x + point.width + 1, point.y, { steps: 4 }); await fixture.page.mouse.up();
  expect(await fixture.page.evaluate(() => window.getSelection()?.toString())).toBe('验收流式');
  await fixture.page.getByRole('button', { name: '引用所选文本' }).click();
  await fixture.page.getByRole('menuitem', { name: '追加到主任务草稿' }).click(); await expect(fixture.page.locator('.composer-reference-open')).toContainText('引用消息');
  expect((await fixture.snapshot()).data.ui.threads.t.contextReferences![0].quote).toEqual({ start: 0, end: 4, text: '验收流式' });
  await input().fill('explain quote'); await fixture.page.getByRole('button', { name: '发送消息', exact: true }).click(); await expect.poll(() => fixture.calls.length).toBe(2); await idle();
  expect(JSON.stringify(fixture.calls.at(-1)!.messages)).toContain('characters 0-4');
  const missing = join(fixture.storage, 'attachments', 't', 'missing.txt');
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'keep failed draft', attachments: [missing] } } });
  await expect(input()).toHaveValue('keep failed draft'); await fixture.page.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(fixture.page.locator('.composer-delivery')).toContainText('发送失败'); await expect(input()).toHaveValue('keep failed draft');
  await fixture.page.getByRole('button', { name: '移除附件 missing.txt', exact: true }).click();
  await expect(fixture.page.locator('.composer-delivery')).toHaveCount(0);
  const evidence = resolve('../../.artifacts/composer-enhancements'); await mkdir(evidence, { recursive: true });
  for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark'] as const) for (const [width, height] of [[1440, 940], [1000, 700], [1280, 800]]) {
    await fixture.page.setViewportSize({ width, height }); const ui = (await fixture.snapshot()).data.ui; await fixture.invoke({ op: 'ui.update', ui: { ...ui, locale } }); await fixture.invoke({ op: 'settings.patch', patch: { theme } });
    await expect(fixture.page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(input()).toHaveAttribute('aria-label', locale === 'zh-CN' ? '向 Pi 发送消息' : 'Message Pi');
    await expect(fixture.page.locator('.composer-actions > .menu')).toHaveCount(3);
    expect(await fixture.page.locator('.composer').evaluate(element => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight; })).toBe(true);
    if (process.env.PI_DESKTOP_CAPTURE === '1' && (locale === 'zh-CN' && theme === 'light' && width === 1440 || locale === 'en-US' && theme === 'dark' && width === 1000)) await fixture.page.screenshot({ path: join(evidence, locale + '-' + theme + '.png') });
  }
});

test('selection quote sidechat keeps selected context and both drafts without sending', async () => {
  await fixture.invoke({ op: 'thread.send', id: 't', text: 'source for sidechat', attachments: [] }); await idle();
  await input().fill('保留主对话草稿');
  const source = fixture.page.locator('.message.assistant [data-quote-start]').last(); await source.scrollIntoViewIfNeeded();
  const selected = await source.evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return selection.toString();
  });
  await fixture.page.getByRole('button', { name: '引用所选文本', exact: true }).click();
  await fixture.page.getByRole('menuitem', { name: '从此处侧聊', exact: true }).click();
  const quoted = selected.split('\n').map(line => '> ' + line).join('\n') + '\n\n';
  await expect(fixture.page.getByLabel('侧聊消息', { exact: true })).toHaveValue(quoted);
  await expect(input()).toHaveValue('保留主对话草稿'); expect(fixture.calls).toHaveLength(1);
  const state = (await fixture.snapshot()).data, chat = state.threads.find(thread => thread.sidechat)!;
  expect(chat.sidechat!.context).toContain(selected); expect(chat.policy).toBe('deny');
  expect(chat.sidechat!.anchorItemId).toBe(state.threads.find(thread => thread.id === 't')!.items.filter(item => item.role === 'assistant').at(-1)!.id);
  await fixture.page.getByRole('button', { name: '关闭侧聊', exact: true }).click();
  await fixture.page.getByRole('button', { name: '辅助栏', exact: true }).click();
  await expect(fixture.page.getByLabel('侧聊消息', { exact: true })).toHaveValue(quoted); expect(fixture.calls).toHaveLength(1);
});

test('composer enhancement: image-only preview, idempotent resend and restart receipts', async () => {
  await fixture.page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32; const context = canvas.getContext('2d')!; context.fillStyle = '#6699cc'; context.fillRect(0, 0, 32, 32);
    const bytes = Uint8Array.from(atob(canvas.toDataURL().split(',')[1]), char => char.charCodeAt(0));
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    document.querySelector('.composer-area')!.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  });
  await expect(fixture.page.locator('.composer-attachment img')).toBeVisible();
  const paths = (await fixture.snapshot()).data.ui.threads.t.draft!.attachments;
  await fixture.page.getByRole('button', { name: '附件预览 image.png' }).click(); await expect(fixture.page.locator('.composer-full-image')).toBeVisible(); await fixture.page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await expect(input()).toHaveValue(''); await fixture.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => fixture.calls.length).toBe(1); await idle(); await expect(input()).toHaveValue('');
  expect(JSON.stringify(fixture.calls[0].messages)).toContain('image_url');
  const receipt = (await fixture.snapshot()).data.threads[0].sendReceipts![0]; expect(receipt.status).toBe('accepted');
  const request = { op: 'thread.send' as const, id: 't', requestId: receipt.id, text: '', attachments: paths, context: [] };
  expect(sendReceiptSchema.parse(await fixture.invoke(request)).status).toBe('accepted'); expect(fixture.calls).toHaveLength(1);
  await fixture.restart(); expect(sendReceiptSchema.parse(await fixture.invoke(request)).status).toBe('accepted'); expect(fixture.calls).toHaveLength(1);
  await expect(fixture.invoke({ ...request, text: 'different' })).rejects.toThrow(/发送内容已变化/);
});

test('composer enhancement: lost acknowledgement and concurrent retries never duplicate execution', async () => {
  const context = [contextDetailSchema.parse(await fixture.invoke({ op: 'composer.contextDetail', threadId: 't', reference: { kind: 'file', id: 'README.md', label: 'README.md', directoryId: 'p' } })).reference];
  const payload = { text: 'single delivery', attachments: [] as string[], context };
  const requestId = crypto.randomUUID();
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: payload.text, attachments: [] }, contextReferences: context } });
  await fixture.page.evaluate(({ requestId, payload }) => localStorage.setItem('pi-composer-send:t', JSON.stringify({ requestId, payload: JSON.stringify(payload) })), { requestId, payload });
  const request = { op: 'thread.send' as const, id: 't', requestId, ...payload };
  const receipts = await Promise.all([fixture.invoke(request), fixture.invoke(request)]);
  expect(receipts.map(item => sendReceiptSchema.parse(item).status)).toEqual(['accepted', 'accepted']); await idle(); expect(fixture.calls).toHaveLength(1);
  await writeFile(join(fixture.project, 'README.md'), 'source changed after acceptance');
  await fixture.restart(); await expect(input()).toHaveValue(payload.text);
  await fixture.page.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(input()).toHaveValue(''); expect(fixture.calls).toHaveLength(1);
  await expect(fixture.invoke({ op: 'thread.send', id: 't', text: '', attachments: [] })).rejects.toThrow(/请输入消息/);
});

test('composer enhancement: attachment retry, template edits and draft isolation survive restart', async () => {
  const attachment = await fixture.invoke({ op: 'attachment.add', threadId: 't', files: [{ name: 'retry.txt', base64: Buffer.from('original').toString('base64') }] }) as string[];
  await unlink(attachment[0]); await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'saved draft', attachments: attachment } } });
  await fixture.page.getByRole('button', { name: '附件预览 retry.txt' }).click(); await expect(fixture.page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await writeFile(attachment[0], 'recovered attachment'); await fixture.page.getByRole('dialog').getByRole('button', { name: '重试', exact: true }).click(); await expect(fixture.page.getByRole('dialog').locator('pre')).toHaveText('recovered attachment');
  await fixture.page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  const history = z.array(draftSnapshotSchema).parse(await fixture.invoke({ op: 'composer.history', threadId: 't', action: 'save' }));
  const another = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }) as { id: string };
  await expect(fixture.invoke({ op: 'composer.history', threadId: another.id, action: 'restore', snapshotId: history[0].id })).rejects.toThrow(/草稿版本已不存在/);
  const ui = (await fixture.snapshot()).data.ui; await fixture.invoke({ op: 'ui.update', ui: { ...ui, activeThreadId: 't' } });
  await addMenu('提示词模板'); await fixture.page.getByLabel('模板名称').fill('Editable'); await fixture.page.getByLabel('模板内容').fill('before'); await fixture.page.getByRole('button', { name: '保存模板' }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.settings.promptTemplates[0]?.text).toBe('before');
  await fixture.page.getByLabel('模板内容').fill('after'); await fixture.page.getByRole('button', { name: '保存模板' }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.settings.promptTemplates[0]?.text).toBe('after'); await fixture.restart();
  expect((await fixture.snapshot()).data.settings.promptTemplates[0].text).toBe('after'); await addMenu('提示词模板'); await fixture.page.getByRole('dialog').getByRole('button', { name: 'Editable', exact: true }).click();
  await fixture.page.getByRole('button', { name: '删除模板' }).click(); await expect.poll(async () => (await fixture.snapshot()).data.settings.promptTemplates.length).toBe(0);
  await fixture.page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click(); await addMenu('草稿历史'); await fixture.page.getByRole('button', { name: '清空历史' }).click(); await expect(fixture.page.locator('.composer-history-row')).toHaveCount(0);
});

test('composer enhancement: fuzzy search, exact lines, stale preflight and source navigation', async () => {
  const folder = join(fixture.project, 'src', 'nested'); await mkdir(folder, { recursive: true }); await writeFile(join(folder, 'component.tsx'), ['line one', 'selected line two', 'line three'].join(String.fromCharCode(10)));
  await input().fill('@cmptx'); await fixture.page.getByRole('option', { name: /component.tsx/ }).click();
  await expect(fixture.page.locator('.composer-reference-open')).toContainText('component.tsx');
  await fixture.page.locator('.composer-reference-open').click(); const dialog = fixture.page.getByRole('dialog');
  await expect(dialog.locator('.composer-context-preview')).toContainText('line three');
  await dialog.getByLabel('起始行').fill('2'); await dialog.getByLabel('结束行').fill('2'); await dialog.getByRole('button', { name: '应用行范围' }).click();
  await expect(dialog.locator('.composer-context-preview')).toContainText('lines 2-2'); await expect(dialog.locator('.composer-context-preview')).not.toContainText('line one');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await writeFile(join(folder, 'component.tsx'), ['line one', 'changed line two', 'line three'].join(String.fromCharCode(10)));
  await input().fill('check selected lines'); await fixture.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(fixture.page.locator('.composer-delivery')).toContainText('引用版本已变化'); expect(fixture.calls).toHaveLength(0); await expect(input()).toHaveValue('check selected lines');
  await fixture.page.locator('.composer-reference-open').click(); await fixture.page.getByRole('dialog').getByRole('button', { name: '刷新引用' }).click();
  await expect(fixture.page.getByRole('dialog').locator('.composer-context-preview')).toContainText('changed line two'); await fixture.page.getByRole('dialog').getByRole('button', { name: '打开来源' }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.fileLocation?.line).toBe(2);
  await fixture.page.getByRole('button', { name: '发送消息', exact: true }).click(); await expect.poll(() => fixture.calls.length).toBe(1); await idle();
  expect(JSON.stringify(fixture.calls[0].messages)).toContain('changed line two'); expect(JSON.stringify(fixture.calls[0].messages)).not.toContain('line three');
});

test('composer enhancement: individually edit, reorder and delete real queued messages', async () => {
  fixture.setMode('hold'); await fixture.invoke({ op: 'thread.send', id: 't', text: 'active', attachments: [] }); await expect.poll(() => fixture.calls.length).toBe(1);
  for (const text of ['first pending', 'second pending', 'remove pending']) { await input().fill(text); await fixture.page.getByRole('button', { name: '排队发送', exact: true }).click(); await expect(input()).toHaveValue(''); }
  await expect(fixture.page.locator('.composer-queue-row')).toHaveCount(3);
  const row = fixture.page.locator('.composer-queue-row').filter({ hasText: 'first pending' }); await row.getByRole('button', { name: '编辑排队消息' }).click();
  await fixture.page.getByRole('dialog').getByLabel('编辑排队消息').fill('edited first'); await fixture.page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await fixture.page.locator('.composer-queue-row').filter({ hasText: 'second pending' }).getByRole('button', { name: '上移消息' }).click();
  await expect(fixture.page.locator('.composer-queue-row').first()).toContainText('second pending');
  await fixture.page.locator('.composer-queue-row').filter({ hasText: 'remove pending' }).getByRole('button', { name: '删除排队消息' }).click(); await expect(fixture.page.locator('.composer-queue-row')).toHaveCount(2);
  const old = (await fixture.snapshot()).data.threads[0].queue![0]; fixture.release(); await idle();
  const contents = fixture.calls.at(-1)!.messages.filter(item => item.role === 'user').map(item => JSON.stringify(item.content)).join('|');
  expect(contents).toContain('edited first'); expect(contents).toContain('second pending'); expect(contents).not.toContain('remove pending'); expect(contents.indexOf('second pending')).toBeLessThan(contents.indexOf('edited first'));
  await expect(fixture.invoke({ op: 'thread.queueChange', threadId: 't', change: { id: old.id!, revision: old.revision ?? 0, action: 'remove' } })).rejects.toThrow(/已开始处理|队列已变化/);
});

test('composer enhancement: identical queued text retains identity and edited content recovers after restart', async () => {
  fixture.setMode('hold'); await fixture.invoke({ op: 'thread.send', id: 't', text: 'active', attachments: [] }); await expect.poll(() => fixture.calls.length).toBe(1);
  for (let index = 0; index < 2; index++) await fixture.invoke({ op: 'thread.send', id: 't', text: 'duplicate', attachments: [], queue: 'followUp' });
  const pending = (await fixture.snapshot()).data.threads[0].queue!;
  await fixture.invoke({ op: 'thread.queueChange', threadId: 't', change: { id: pending[0].id!, revision: 0, action: 'remove' } });
  expect((await fixture.snapshot()).data.threads[0].queue!.map(item => item.id)).toEqual([pending[1].id]);
  await fixture.invoke({ op: 'thread.send', id: 't', text: 'duplicate', attachments: [], queue: 'followUp' });
  const last = (await fixture.snapshot()).data.threads[0].queue![1];
  await fixture.invoke({ op: 'thread.queueChange', threadId: 't', change: { id: last.id!, revision: 0, action: 'up' } });
  expect((await fixture.snapshot()).data.threads[0].queue!.map(item => item.id)).toEqual([last.id, pending[1].id]);
  await fixture.invoke({ op: 'thread.queueChange', threadId: 't', change: { id: last.id!, revision: 0, action: 'edit', text: 'edited recovery' } });
  await expect(fixture.invoke({ op: 'thread.queueChange', threadId: 't', change: { id: last.id!, revision: 0, action: 'remove' } })).rejects.toThrow(/队列已变化/);
  await fixture.restart(); await expect(input()).toHaveValue(/edited recovery.*duplicate/s);
  expect((await fixture.snapshot()).data.threads[0].queue ?? []).toHaveLength(0); expect(fixture.calls).toHaveLength(1);
});

test('composer enhancement: failed imports retry independently and preserve successfully imported files', async () => {
  await fixture.page.evaluate(() => {
    const original = File.prototype.arrayBuffer; let failed = false;
    File.prototype.arrayBuffer = async function () { if (this.name === 'unstable.txt' && !failed) { failed = true; throw new Error('SIMULATED_READ_FAILURE'); } return original.call(this); };
    const transfer = new DataTransfer(); transfer.items.add(new File(['retry content'], 'unstable.txt', { type: 'text/plain' })); transfer.items.add(new File(['good content'], 'good.txt', { type: 'text/plain' }));
    document.querySelector('.composer-area')!.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  });
  await expect(fixture.page.locator('.composer-import-error')).toContainText('unstable.txt'); await expect(fixture.page.locator('.composer-attachment')).toHaveCount(1);
  await fixture.page.locator('.composer-import-error').getByRole('button', { name: '重试', exact: true }).click(); await expect(fixture.page.locator('.composer-import-error')).toHaveCount(0); await expect(fixture.page.locator('.composer-attachment')).toHaveCount(2);
  await fixture.page.getByRole('button', { name: '移除附件 unstable.txt', exact: true }).click(); await expect(fixture.page.locator('.composer-attachment')).toHaveCount(1); await expect(fixture.page.locator('.attachment-name')).toHaveText('good.txt');
});

test('composer enhancement: same-name references navigate to the correct project directory', async () => {
  const other = join(fixture.storage, 'other'); await mkdir(other); await writeFile(join(other, 'README.md'), 'other root content');
  await fixture.app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, other);
  const directory = await fixture.invoke({ op: 'project.directoryAdd', projectId: 'p' }) as { id: string };
  await input().fill('@README'); await expect(fixture.page.getByRole('option').filter({ hasText: 'README.md' })).toHaveCount(2);
  await fixture.page.getByRole('option').filter({ hasText: 'other/README.md' }).click(); await expect(fixture.page.locator('.composer-reference-open')).toHaveText('other/README.md');
  await fixture.page.locator('.composer-reference-open').click(); await expect(fixture.page.getByRole('dialog').locator('pre')).toContainText('other root content');
  await fixture.page.getByRole('dialog').getByRole('button', { name: '打开来源' }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.directoryId).toBe(directory.id);
  await expect(fixture.page.locator('.file-editor')).toHaveValue('other root content');
});
