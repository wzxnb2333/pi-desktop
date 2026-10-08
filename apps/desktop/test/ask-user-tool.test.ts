import assert from 'node:assert/strict';
import test from 'node:test';
import { askUserTool } from '../src/worker/ask-user-tool.ts';
import { askUserToolSchema, questionKind, questionResultText } from '../src/shared/user-question.ts';

type Call = { kind: 'select' | 'input'; description: string; options?: string[] };
const invoked: Call[] = [];
/** The tool's execute signature expects the harness context; the test only needs id, args and the answer. */
const run = async (answer: { approved: boolean; value?: string }, args: unknown): Promise<string> => {
  const tool = askUserTool(async question => { invoked.push(question); return answer; });
  const execute = tool.execute as unknown as (id: string, args: unknown, signal?: AbortSignal) => Promise<{ content: { type: string; text: string }[] }>;
  const result = await execute('call', args);
  return result.content.map(block => block.text).join('\n');
};

test('the question schema keeps the options list clickable', () => {
  assert.equal(askUserToolSchema.safeParse({ question: 'Which one?' }).success, true);
  assert.equal(askUserToolSchema.safeParse({ question: 'Which one?', options: ['a', 'b', 'c'] }).success, true);
  assert.equal(askUserToolSchema.safeParse({ question: 'Which one?', options: ['only'] }).success, false, 'one option is not a choice');
  assert.equal(askUserToolSchema.safeParse({ question: 'Which one?', options: Array.from({ length: 9 }, (_, index) => 'option ' + index) }).success, false);
  assert.equal(askUserToolSchema.safeParse({ question: '' }).success, false);
  assert.equal(askUserToolSchema.safeParse({ question: 'Which one?', injected: true }).success, false);
});

test('options ask for a pick, free text and empty options ask for a typed answer', () => {
  assert.equal(questionKind({ question: 'q', options: ['a', 'b'] }), 'select');
  assert.equal(questionKind({ question: 'q', options: ['a', 'b'], freeText: true }), 'input');
  assert.equal(questionKind({ question: 'q' }), 'input');
});

test('a chosen option comes back with its label, and cancelling never invents an answer', async () => {
  invoked.length = 0;
  const chosen = await run({ approved: true, value: '第二个方案' }, { question: '用哪个方案？', options: ['第一个方案', '第二个方案'] });
  assert.deepEqual(invoked[0], { kind: 'select', description: '用哪个方案？', options: ['第一个方案', '第二个方案'] });
  assert.match(chosen, /第二个方案/);

  const typed = await run({ approved: true, value: '用 YAML 配置' }, { question: '配置格式？', freeText: true });
  assert.equal(invoked[1].kind, 'input'); assert.equal(invoked[1].options, undefined);
  assert.match(typed, /用 YAML 配置/);

  const cancelled = await run({ approved: false }, { question: '用哪个方案？', options: ['第一个方案', '第二个方案'] });
  assert.match(cancelled, /did not answer/);
  assert.match(cancelled, /Do not invent/);

  const empty = await run({ approved: true, value: '' }, { question: '用哪个方案？', options: ['第一个方案', '第二个方案'] });
  assert.match(empty, /did not answer/);
});

test('the result text distinguishes a pick from a typed reply', () => {
  assert.match(questionResultText({ question: 'q', options: ['a', 'b'] }, { approved: true, value: 'b' }), /selected: b/);
  assert.match(questionResultText({ question: 'q' }, { approved: true, value: 'anything' }), /replied: anything/);
});
