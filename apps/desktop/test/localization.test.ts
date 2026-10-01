import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { uiSchema } from '../src/shared/contracts.ts';
import { messages } from '../src/shared/messages.ts';
import { getLocale, localizeAppError, setLocale, subscribeLocale, translate } from '../src/shared/localization.ts';
import { applyUiPatch } from '../src/shared/ui-patches.ts';
import { JsonStore } from '../src/main/store.ts';

test('locale migrates old UI state and survives store reload without altering task drafts', async () => {
  assert.equal(uiSchema.parse({}).locale, 'zh-CN');
  assert.equal(uiSchema.safeParse({ locale: 'fr-FR' }).success, false);
  const directory = await mkdtemp(join(tmpdir(), 'pi-locale-'));
  try {
    const store = new JsonStore(directory);
    const before = uiSchema.parse({ threads: { task: { draft: { text: '中文 draft', attachments: ['D:/附件.png'] }, scroll: { follow: false, itemId: 'turn-1', offset: 23 } } } });
    store.data.ui = applyUiPatch(before, { frame: { locale: 'en-US' } });
    assert.deepEqual(store.data.ui.threads, before.threads);
    await store.save();
    const reopened = new JsonStore(directory);
    await reopened.load();
    assert.equal(reopened.data.ui.locale, 'en-US');
    assert.deepEqual(reopened.data.ui.threads, before.threads);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('every translation preserves exactly the same typed interpolation slots', () => {
  const slots = (value: string) => [...value.matchAll(/\{p\d+\}/g)].map(match => match[0]).sort();
  for (const [key, value] of Object.entries(messages)) {
    assert.ok(value.trim(), key);
    assert.deepEqual(slots(value), slots(key), key);
  }
  assert.equal(translate('en-US', '移除附件 {p0}', { p0: '截图.png' }), 'Remove attachment 截图.png');
  assert.equal(translate('zh-CN', '移除附件 {p0}', { p0: '截图.png' }), '移除附件 截图.png');
});

test('locale subscriptions notify once and application errors preserve inserted and raw content', () => {
  setLocale('zh-CN');
  let calls = 0;
  const unsubscribe = subscribeLocale(() => calls++);
  try {
    setLocale('en-US'); setLocale('en-US');
    assert.equal(getLocale(), 'en-US'); assert.equal(calls, 1);
    assert.equal(localizeAppError('任务不存在'), 'Task not found');
    assert.equal(localizeAppError('中文模型：请填写有效的 Base URL'), '中文模型: Enter a valid Base URL');
    assert.equal(localizeAppError('HTTP 403: 原始供应商错误'), 'HTTP 403: 原始供应商错误');
    assert.equal(localizeAppError('迁移恢复记录保存失败，原始快照已保留。\nrecord-id\nEIO: D:/中文路径'), 'The migration recovery record could not be saved. Original snapshots are preserved.\nrecord-id\nEIO: D:/中文路径');
    assert.equal(localizeAppError('未知工具错误\n任务不存在'), '未知工具错误\n任务不存在');
  } finally { unsubscribe(); setLocale('zh-CN'); }
});
