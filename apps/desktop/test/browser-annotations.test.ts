import assert from 'node:assert/strict';
import { test } from 'node:test';
import { annotationPageSchema, annotationSelection } from '../src/shared/browser-annotations.ts';
import { requestSchema, threadSchema } from '../src/shared/contracts.ts';

test('annotation selections use captured geometry and reject missing, overflowing or forged elements', () => {
  const page = annotationPageSchema.parse({ url: 'https://example.com', title: 'Page', width: 800, height: 600, scrollX: 0, scrollY: 150, fingerprint: 'a'.repeat(64), elements: [{ id: 0, tag: 'button', label: 'Save', selector: 'button:nth-of-type(1)', rect: { x: 40, y: 80, width: 120, height: 40 } }] });
  const element = annotationSelection(page, { mode: 'element', elementId: 0, comment: '  调整按钮  ', rect: { x: 0, y: 0, width: 1, height: 1 } });
  assert.deepEqual(element.rect, page.elements[0].rect); assert.equal(element.comment, '调整按钮');
  assert.throws(() => annotationSelection(page, { mode: 'element', elementId: 50, comment: 'missing' }), /请选择/);
  assert.throws(() => annotationSelection(page, { mode: 'region', comment: 'overflow', rect: { x: 750, y: 0, width: 100, height: 100 } }), /请选择/);
  assert.equal(annotationSelection(page, { mode: 'region', comment: '注释', rect: { x: 0, y: 0, width: 800, height: 600 } }).mode, 'region');
  assert.equal(requestSchema.safeParse({ op: 'browser.annotationSave', threadId: 't', captureId: crypto.randomUUID(), selection: { mode: 'region', comment: 'test', path: 'C:/secret', rect: { x: 1, y: 1, width: 20, height: 20 } } }).success, false);
  assert.equal(threadSchema.safeParse({ id: 't', projectId: '', cwd: '.', title: 't', createdAt: 0, updatedAt: 0, modelId: '', thinking: 'off', policy: 'deny', browserAnnotations: [] }).success, true);
});
