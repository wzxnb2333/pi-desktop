import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Subtasks } from '../src/main/subtasks.ts';
import { publishSubtasks } from '../src/main/subtask-state.ts';
import { defaultData, threadSchema } from '../src/shared/contracts.ts';
import { subtaskSchema, type Subtask } from '../src/shared/subtasks.ts';

async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) { if (check()) return; await delay(5); }
  assert.fail('Communication did not settle');
}
function fixture() {
  const state = defaultData(); state.settings.subtasksEnabled = true;
  const parent = threadSchema.parse({ id: 'parent', projectId: 'p', cwd: 'unused', title: 'Parent', createdAt: 1, updatedAt: 1, providerId: 'local', thinking: 'off', policy: 'deny' });
  const id = crypto.randomUUID();
  state.threads.push(parent, { ...parent, id: 'child', subtaskId: id }, { ...parent, id: 'stranger' });
  state.subtasks.push(subtaskSchema.parse({ id, parentThreadId: parent.id, childThreadId: 'child', definition: { title: 'Inspect', prompt: 'Read only', environment: 'local', policy: 'deny' }, context: '', status: 'running', stage: '子任务正在执行', createdAt: 1 }));
  let saving = async (_records: Subtask[]) => {};
  const notices: string[] = [];
  const service = new Subtasks({ records: () => state.subtasks, threads: () => state.threads, enabled: () => state.settings.subtasksEnabled,
    prepare: async () => state.threads[1], run: async () => 'Done',
    save: async records => { await saving(records); publishSubtasks(state.subtasks, records); }, deliver: async () => {},
    notifyParent: async (parentId, taskId, question) => { notices.push(JSON.stringify({ parentId, taskId, question })); },
    changed: () => {}, error: error => { throw error; } });
  return { state, service, id, notices, onSave(next: typeof saving) { saving = next; } };
}

test('a child waits for a durable parent answer without changing either permission', async () => {
  const f = fixture(), questionId = crypto.randomUUID();
  const waiting = f.service.ask('child', questionId, 'Which file should I inspect?', 1000, new AbortController().signal);
  await until(() => f.notices.length === 1);
  assert.equal(f.state.subtasks[0].questions?.[0].status, 'pending');
  assert.equal(f.state.subtasks[0].status, 'running');
  assert.equal(f.state.subtasks[0].stage, '等待主代理答复');
  await f.service.reply('parent', f.id, questionId, 'Inspect README.md', new AbortController().signal);
  const answer = await waiting;
  assert.equal(answer.status, 'answered'); assert.equal(answer.answer, 'Inspect README.md');
  assert.equal(f.state.subtasks[0].stage, '子任务正在执行');
  assert(f.state.threads.every(thread => thread.policy === 'deny'));
  assert.equal(f.state.threads[0].items.length, 0);
  await f.service.dispose();
});

test('question and reply identities are scoped to the actual parent and child', async () => {
  const f = fixture(), controller = new AbortController(), questionId = crypto.randomUUID();
  await assert.rejects(f.service.ask('parent', questionId, 'Invalid sender', 1000, controller.signal), /子智能体/);
  const waiting = f.service.ask('child', questionId, 'Question', 1000, controller.signal);
  await until(() => f.notices.length === 1);
  await assert.rejects(f.service.reply('stranger', f.id, questionId, 'Cross-thread answer', controller.signal), /不属于/);
  await assert.rejects(f.service.reply('child', f.id, questionId, 'Self answer', controller.signal), /不可用/);
  await assert.rejects(f.service.ask('child', crypto.randomUUID(), 'Another pending question', 1000, controller.signal), /等待/);
  await f.service.reply('parent', f.id, questionId, 'Answer', controller.signal); await waiting;
  await f.service.reply('parent', f.id, questionId, 'Answer', controller.signal);
  await assert.rejects(f.service.reply('parent', f.id, questionId, 'Changed answer', controller.signal), /答复/);
  await f.service.dispose();
});

test('failed question persistence publishes no question or notification; failed replies can retry', async () => {
  const f = fixture(), signal = new AbortController().signal;
  f.onSave(async () => { throw new Error('DISK_FAILED'); });
  await assert.rejects(f.service.ask('child', crypto.randomUUID(), 'Question', 1000, signal), /DISK_FAILED/);
  assert.equal(f.state.subtasks[0].questions?.length ?? 0, 0); assert.equal(f.notices.length, 0);
  f.onSave(async () => {}); const questionId = crypto.randomUUID();
  const waiting = f.service.ask('child', questionId, 'Retry', 1000, signal);
  await until(() => f.notices.length === 1);
  f.onSave(async () => { throw new Error('DISK_FAILED'); });
  await assert.rejects(f.service.reply('parent', f.id, questionId, 'Answer', signal), /DISK_FAILED/);
  assert.equal(f.state.subtasks[0].questions?.[0].status, 'pending');
  f.onSave(async () => {}); await f.service.reply('parent', f.id, questionId, 'Answer', signal);
  assert.equal((await waiting).answer, 'Answer'); await f.service.dispose();
});

test('question timeouts and cancellation settle durably and reject late answers', async () => {
  const f = fixture(), questionId = crypto.randomUUID(), signal = new AbortController().signal;
  assert.equal((await f.service.ask('child', questionId, 'No answer', 20, signal)).status, 'expired');
  await assert.rejects(f.service.reply('parent', f.id, questionId, 'Too late', signal), /等待/);
  const controller = new AbortController(), second = crypto.randomUUID();
  const waiting = f.service.ask('child', second, 'Cancelled question', 1000, controller.signal);
  const rejected = assert.rejects(waiting, /abort|取消/i);
  await until(() => f.state.subtasks[0].questions?.at(-1)?.status === 'pending');
  controller.abort(); await rejected;
  assert.equal(f.state.subtasks[0].questions?.at(-1)?.status, 'cancelled');
  await f.service.dispose();
});

test('cursor waits wake for questions and completion, time out, and isolate other parents', async () => {
  const f = fixture(), signal = new AbortController().signal;
  const initial = await f.service.wait('parent', undefined, 20, signal);
  const waiting = f.service.wait('parent', initial.cursor, 1000, signal);
  const questionId = crypto.randomUUID(), question = f.service.ask('child', questionId, 'Need direction', 1000, signal);
  const update = await waiting;
  assert.equal(update.changed, true); assert.equal(update.tasks[0].questions?.[0].id, questionId);
  assert.equal((await f.service.wait('stranger', undefined, 20, signal)).tasks.length, 0);
  await f.service.reply('parent', f.id, questionId, 'Continue', signal); await question;
  const current = await f.service.wait('parent', undefined, 20, signal);
  assert.equal((await f.service.wait('parent', current.cursor, 20, signal)).changed, false);
  const controller = new AbortController(), cancelled = f.service.wait('parent', current.cursor, 1000, controller.signal);
  const rejected = assert.rejects(cancelled, /abort|取消/i); controller.abort(); await rejected;
  await f.service.dispose();
});

test('restart interrupts unanswered questions without silently replaying them', async () => {
  const f = fixture();
  f.state.subtasks[0].questions = [{ id: crypto.randomUUID(), question: 'Pending before shutdown', status: 'pending', createdAt: 1 }];
  const parsed = subtaskSchema.parse(f.state.subtasks[0]); assert.equal(parsed.questions?.length, 1);
  f.service.recover();
  assert.equal(f.state.subtasks[0].status, 'interrupted');
  assert.equal(f.state.subtasks[0].questions?.[0].status, 'interrupted'); assert.equal(f.notices.length, 0);
  await f.service.dispose();
});
