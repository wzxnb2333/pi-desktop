import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uiSchema } from '../src/shared/contracts.ts';
import { applyUiPatch } from '../src/shared/ui-patches.ts';
test('independent draft, fold, browser and frame updates retain other fields', () => {
  let ui = uiSchema.parse({});
  ui = applyUiPatch(ui, { threadId: 'a', thread: { draft: { text: '中文', attachments: ['a.txt'] }, folds: { turn: true } } });
  ui = applyUiPatch(ui, { threadId: 'a', thread: { folds: { plan: false }, browserTabs: [{ id: 'web', url: 'https://example.com', title: 'web' }] } });
  ui = applyUiPatch(ui, { frame: { reviewOpen: false, threads: {} } });
  assert.equal(ui.threads.a.draft?.text, '中文');
  assert.deepEqual(ui.threads.a.folds, { turn: true, plan: false });
  assert.equal(ui.threads.a.browserTabs?.length, 1);
});
