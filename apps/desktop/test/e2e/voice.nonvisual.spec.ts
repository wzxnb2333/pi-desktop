import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import sherpa from 'sherpa-onnx-node';
import { encodePcm } from '../../src/voice/engine.ts';
import { voiceModel } from '../../src/shared/voice-models.ts';
import type { VoiceStatus } from '../../src/shared/voice.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

const directory = process.env.PI_DESKTOP_VOICE_MODELS || resolve('../../.artifacts/voice-models');
const wav = join(directory, voiceModel('sensevoice').folder, 'test_wavs', 'zh.wav');
let development: Awaited<ReturnType<typeof startDevelopmentSource>>, fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { await access(wav); development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url, { args: ['--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + wav + '%noloop'] }); await fixture.invoke({ op: 'settings.patch', patch: { voice: { modelDirectory: directory, deviceId: '', language: 'zh', speaker: 48, speed: 1 } } }); });
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]); } });
const status = async () => await fixture.invoke({ op: 'voice.status' }) as VoiceStatus;
const control = () => fixture.page.locator('.voice-controls');

test('temporarily hidden voice controls never start capture; drafts, attachments and retained model preferences survive restart', async () => {
  const input = fixture.page.getByRole('textbox', { name: '向 Pi 发送消息', exact: true }); await input.fill('保留原始草稿');
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: '保留原始草稿', attachments: [join(fixture.project, 'README.md')] } } });
  await expect(control()).toHaveCount(0);
  await expect(fixture.page.getByRole('button', { name: /本地听写|语音对话|朗读最近回答/ })).toHaveCount(0);
  expect((await status()).job).toBeUndefined();
  await expect(input).toHaveValue('保留原始草稿');
  expect(fixture.calls).toHaveLength(0); expect((await fixture.snapshot()).data.ui.threads.t.draft?.attachments).toEqual([join(fixture.project, 'README.md')]);
  await fixture.restart(); expect((await fixture.snapshot()).data.settings.voice.modelDirectory).toBe(directory); expect((await status()).models.every(item => item.status === 'installed')).toBe(true);
  expect((await status()).job).toBeUndefined(); await expect(fixture.page.getByRole('textbox', { name: '向 Pi 发送消息', exact: true })).toHaveValue('保留原始草稿');
  expect(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')).not.toContain('UklGR');
});

test('retained offline voice adapter recognizes real audio without sending; cancellation does not stop the task', async () => {
  const id = crypto.randomUUID(), audio = sherpa.readWave(wav);
  await fixture.invoke({ op: 'voice.capture.begin', threadId: 't', id, language: 'zh' });
  for (let offset = 0; offset < audio.samples.length; offset += 8000)
    await fixture.invoke({ op: 'voice.capture.push', threadId: 't', id, pcm: encodePcm(audio.samples.subarray(offset, offset + 8000)) });
  expect(await fixture.invoke({ op: 'voice.capture.finish', threadId: 't', id })).toMatch(/早上9点.*下午5点/);
  expect(fixture.calls).toHaveLength(0);
  const speech = await fixture.invoke({ op: 'voice.speak', threadId: 't', id: crypto.randomUUID(), text: '你好。', speaker: 48, speed: 1 });
  expect(Buffer.from(String(speech), 'base64').subarray(0, 4).toString()).toBe('RIFF');
  fixture.setMode('hold'); await fixture.invoke({ op: 'thread.send', id: 't', text: 'HOLD_TASK_DURING_LOCAL_AUDIO', attachments: [] });
  const cancelled = crypto.randomUUID(); await fixture.invoke({ op: 'voice.capture.begin', threadId: 't', id: cancelled, language: 'zh' });
  await fixture.invoke({ op: 'voice.cancel', id: cancelled });
  expect((await status()).job?.status).toBe('cancelled'); expect((await fixture.snapshot()).data.threads[0].status).toBe('running'); fixture.release();
});

test('voice jobs enforce window ownership, cancellation, camera denial and missing model recovery', async () => {
  expect(await fixture.page.evaluate(async () => { try { await navigator.mediaDevices.getUserMedia({ audio: true }); return 'allowed'; } catch { return 'denied'; } })).toBe('denied');
  const id = crypto.randomUUID(); await fixture.invoke({ op: 'voice.capture.begin', threadId: 't', id, language: 'auto' });
  expect(await fixture.page.evaluate(async () => { try { await navigator.mediaDevices.getUserMedia({ video: true }); return 'allowed'; } catch { return 'denied'; } })).toBe('denied');
  await fixture.invoke({ op: 'window.open', kind: 'quick' }); await expect.poll(() => fixture.app.windows().length).toBe(2);
  const other = fixture.app.windows().find(page => page !== fixture.page)!; await other.locator('.desktop').waitFor();
  await expect(other.evaluate(id => window.desktop.invoke({ op: 'voice.cancel', id }), id)).rejects.toThrow(/不属于/);
  await fixture.invoke({ op: 'voice.cancel', id }); expect((await status()).job?.status).toBe('cancelled');
  await expect(fixture.invoke({ op: 'voice.capture.finish', threadId: 't', id })).rejects.toThrow(/已结束/);
  const oldStorage = fixture.storage; expect(fixture.errors).toEqual([]); await fixture.close(); await expect(access(oldStorage)).rejects.toMatchObject({ code: 'ENOENT' });
  fixture = await acceptanceApp(development.url);
  await expect(fixture.invoke({ op: 'voice.capture.begin', threadId: 't', id: crypto.randomUUID(), language: 'auto' })).rejects.toThrow(/请先下载或导入/);
  await fixture.invoke({ op: 'settings.patch', patch: { voice: { modelDirectory: directory, deviceId: '', language: 'auto', speaker: 48, speed: 1 } } });
  const recovered = crypto.randomUUID(); await fixture.invoke({ op: 'voice.capture.begin', threadId: 't', id: recovered, language: 'auto' });
  await fixture.invoke({ op: 'voice.capture.push', threadId: 't', id: recovered, pcm: Buffer.alloc(32000).toString('base64') });
  await expect(fixture.invoke({ op: 'voice.capture.finish', threadId: 't', id: recovered })).rejects.toThrow(/未检测到语音/);
  expect((await status()).job?.status).toBe('failed');
});

test('voice settings preserve pending preferences in both locales, themes and three window sizes during a running task', async () => {
  fixture.setMode('hold'); await fixture.invoke({ op: 'thread.send', id: 't', text: 'SETTINGS_MUST_NOT_STOP_TASK', attachments: [] });
  const initial = (await fixture.snapshot()).data.ui; await fixture.invoke({ op: 'ui.update', ui: { ...initial, view: 'settings' } });
  await fixture.page.locator('.settings-sidebar [data-category=voice]').click();
  await fixture.page.locator('#voice-speed').fill('1.2'); await fixture.page.locator('#voice-speaker').selectOption('58');
  for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark'] as const) for (const dimensions of [[1440, 940], [1000, 700], [1280, 800]]) {
    const snapshot = await fixture.snapshot(); await fixture.invoke({ op: 'ui.update', ui: { ...snapshot.data.ui, locale } }); await fixture.invoke({ op: 'settings.patch', patch: { theme } });
    await fixture.app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), dimensions);
    await expect.poll(() => fixture.page.locator('.voice-settings').evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.getBoundingClientRect().right <= innerWidth)).toBe(true);
    await expect(fixture.page.locator('#voice-speed')).toHaveValue('1.2');
  }
  await fixture.page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.settings.voice.speed).toBe(1.2);
  expect((await fixture.snapshot()).data.threads[0].status).toBe('running'); fixture.release();
  await fixture.restart(); expect((await fixture.snapshot()).data.settings.voice).toMatchObject({ speaker: 58, speed: 1.2 });
});

test('native model import, verify, removal, picker cancellation and recording cancellation leave no temporary data', async () => {
  const prior = fixture.storage; expect(fixture.errors).toEqual([]); await fixture.close(); await expect(access(prior)).rejects.toThrow(); fixture = await acceptanceApp(development.url);
  const ui = (await fixture.snapshot()).data.ui; await fixture.invoke({ op: 'ui.update', ui: { ...ui, view: 'settings' } }); await fixture.page.locator('.settings-sidebar [data-category=voice]').click();
  await fixture.app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
  expect(await fixture.invoke({ op: 'voice.model', action: 'import', id: crypto.randomUUID(), model: 'silero' })).toBeNull();
  const source = join(directory, 'silero-vad', 'silero_vad.onnx');
  await fixture.app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, source);
  const card = fixture.page.locator('.voice-model-list article').filter({ hasText: 'Silero' }); await card.getByRole('button', { name: '导入模型', exact: true }).click();
  await expect(card.getByText('模型已安装', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: '校验模型', exact: true }).click(); await expect.poll(async () => (await status()).job?.status).toBe('succeeded');
  await card.getByRole('button', { name: '卸载模型', exact: true }).click(); await fixture.page.getByRole('dialog').getByRole('button', { name: '卸载模型', exact: true }).click();
  await expect(card.getByText('模型未安装', { exact: true })).toBeVisible();
  await fixture.invoke({ op: 'settings.patch', patch: { voice: { modelDirectory: directory, deviceId: '', language: 'zh', speaker: 48, speed: 1 } } });
  const next = (await fixture.snapshot()).data.ui; await fixture.invoke({ op: 'ui.update', ui: { ...next, view: 'thread' } });
  const id = crypto.randomUUID(); await fixture.invoke({ op: 'voice.capture.begin', threadId: 't', id, language: 'zh' });
  await fixture.invoke({ op: 'voice.cancel', id });
  await expect(control()).toHaveCount(0); await expect.poll(async () => (await status()).job?.status).toBe('cancelled');
  expect(fixture.calls).toHaveLength(0);
});
