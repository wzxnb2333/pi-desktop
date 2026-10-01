import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestSchema, settingsSchema } from '../src/shared/contracts.ts';
import { applySettingsPatch, settingsChanges } from '../src/shared/settings-updates.ts';

test('empty patches have no schema defaults and only edited fields are sent', () => {
  const saved = settingsSchema.parse({ theme: 'dark', fontSize: 18 });
  const request = requestSchema.parse({ op: 'settings.patch', patch: {} });
  assert.deepEqual(request, { op: 'settings.patch', patch: {} });
  assert.deepEqual(applySettingsPatch(saved, {}), saved);
  assert.deepEqual(settingsChanges(saved, { ...saved, followUpMode: 'steer' }), { followUpMode: 'steer' });
  assert.throws(() => requestSchema.parse({ op: 'settings.patch', patch: { secrets: 'forbidden' } }));
  assert.throws(() => applySettingsPatch(saved, { fontSize: 999 }));
});

test('partial saves preserve unrelated updates and reject conflicting changes without mutating data', () => {
  const original = settingsSchema.parse({ theme: 'light' });
  const current = { ...original, fontSize: 16 };
  assert.deepEqual(applySettingsPatch(current, { theme: 'dark' }, { theme: 'light' }), { ...current, theme: 'dark' });
  assert.throws(() => applySettingsPatch(current, { fontSize: 17 }, { fontSize: 14 }), /设置已在其他位置修改/);
  assert.throws(() => applySettingsPatch(current, { fontSize: 17 }, {}), /设置已在其他位置修改/);
  assert.equal(current.fontSize, 16);
  assert.deepEqual(applySettingsPatch(current, { fontSize: 16 }, { fontSize: 14 }), current);
});

test('optional settings can acquire their first value without erasing other preferences', () => {
  const saved = settingsSchema.parse({});
  const parsed = requestSchema.parse({ op: 'settings.patch', patch: { notifications: false }, base: { notifications: undefined } });
  assert.equal(parsed.op, 'settings.patch');
  if (parsed.op !== 'settings.patch') throw new Error('Wrong request');
  assert.equal(applySettingsPatch(saved, parsed.patch, parsed.base).notifications, false);
  assert.equal(saved.notifications, undefined);
});
