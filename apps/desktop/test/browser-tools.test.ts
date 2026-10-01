import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserToolSchema, browserSitePoliciesSchema } from '../src/shared/browser-tools.ts';
import { defaultData, requestSchema } from '../src/shared/contracts.ts';
import { Operations } from '../src/main/operations.ts';
import type { OperationRecord } from '../src/shared/operations.ts';

test('browser requests reject arbitrary code, unsafe URLs and unbounded waits', () => {
  for (const url of ['', 'not a URL', 'javascript:alert(1)', 'file:///C:/secret.txt', 'data:text/html,test', 'https://user:secret@example.com'])
    assert.equal(browserToolSchema.safeParse({ action: 'navigate', url }).success, false);
  for (const request of [{ action: 'evaluate', code: 'alert(1)' }, { action: 'inspect' }, { action: 'click', tabId: 't' }, { action: 'type', tabId: 't', ref: 'r' }, { action: 'wait', tabId: 't', milliseconds: 10001 }])
    assert.equal(browserToolSchema.safeParse(request).success, false);
  assert.equal(browserToolSchema.safeParse({ action: 'type', tabId: 't', ref: 'r', text: "\"');window.evil=true;//" }).success, true);
  assert.deepEqual(defaultData().settings.browserSitePolicies, {});
  assert.equal(browserSitePoliciesSchema.safeParse({ 'https://example.com/path': 'allow' }).success, false);
  assert.equal(requestSchema.safeParse({ op: 'browser.site', origin: 'https://example.com', policy: 'allow' }).success, true);
});

test('main-process operation wait returns completed results and cancellation without restarting work', async () => {
  const records: OperationRecord[] = []; const operations = new Operations(() => records, async () => {}, () => {});
  const id = crypto.randomUUID();
  await operations.start({ id, threadId: 't', directoryId: '', kind: 'browser.wait' }, async signal => {
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); signal.throwIfAborted(); return null;
  });
  operations.cancel('t', id); assert.equal((await operations.wait('t', id)).status, 'cancelled');
  await assert.rejects(operations.wait('another', id), /不属于/);
  const success = crypto.randomUUID();
  await operations.start({ id: success, threadId: 't', directoryId: '', kind: 'browser.inspect' }, async () => ({ ok: true }));
  assert.deepEqual((await operations.wait('t', success)).result, { ok: true }); await operations.dispose();
});
