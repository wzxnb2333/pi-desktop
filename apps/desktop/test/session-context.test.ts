import assert from 'node:assert/strict';
import test from 'node:test';
import { projectSchema, threadSchema, type DesktopData } from '../src/shared/contracts.ts';
import { listSessions, searchSessions, sessionMessages, visibleSessions } from '../src/main/desktop-session-tools.ts';

const projects = [
  projectSchema.parse({ id: 'alpha', name: '示例项目', path: 'C:/work/alpha', trusted: true, createdAt: 1 }),
  projectSchema.parse({ id: 'beta', name: '另一个项目', path: 'C:/work/beta', trusted: false, createdAt: 2 }),
];

const thread = (id: string, projectId: string | undefined, title: string, updatedAt: number, extra: Record<string, unknown> = {}) =>
  threadSchema.parse({
    id, projectId, title, cwd: 'C:/work/' + (projectId ?? 'x'), createdAt: 1, updatedAt,
    modelId: 'fake', thinking: 'off', policy: 'ask', items: [], ...extra,
  });

/** `review` and `sidechat` carry nested shapes this test does not exercise, so flags are layered on a parsed thread. */
const withFlag = (base: object, extra: Record<string, unknown>) => Object.assign(structuredClone(base), extra) as never;

const data = {
  projects,
  threads: [
    thread('a1', 'alpha', '第一条任务', 300, { pinned: true, items: [
      { id: 'm1', role: 'user', text: '请找出 hide_tool_calls 标志位', timestamp: 1 },
      { id: 'm2', role: 'assistant', text: '它在 render 里被读取', timestamp: 2 },
      { id: 'm3', role: 'tool', toolName: 'read', text: 'hide_tool_calls', timestamp: 3 },
    ] }),
    thread('a2', 'alpha', '第二条任务', 200, { archived: true, items: [{ id: 'n1', role: 'assistant', text: '归档里的细节', timestamp: 4 }] }),
    thread('b1', 'beta', '另一个项目里的任务', 400, { items: [{ id: 'o1', role: 'assistant', text: '另一个项目的结论', timestamp: 5 }] }),
    withFlag(thread('a3', 'alpha', '审查子会话', 500, { items: [{ id: 'p1', role: 'assistant', text: '审查里的细节', timestamp: 6 }] }),
      { review: { parentThreadId: 'a1', scope: 'uncommitted', commit: '', form: '{}' } }),
    withFlag(thread('a4', 'alpha', '临时侧聊', 600, { items: [{ id: 'q1', role: 'assistant', text: '侧聊里的细节', timestamp: 7 }] }),
      { sidechat: { parentThreadId: 'a1', temporary: true, context: '[]' } }),
    withFlag(thread('a5', 'alpha', '已删除任务', 700, { items: [{ id: 'r1', role: 'assistant', text: '删除里的细节', timestamp: 8 }] }), { deletedAt: 1 }),
  ],
  ui: { view: 'thread', activeThreadId: 'a1', sidebarOpen: true, reviewOpen: false, threads: {} },
} as unknown as DesktopData;

test('cross-session listing keeps the sidebar visibility rule and every filter bounded', () => {
  assert.deepEqual(visibleSessions(data).map(item => item.id).sort(), ['a1', 'a2', 'b1']);
  // Review children, temporary sidechats and deleted sessions stay out of the model surface too.
  const all = listSessions(data, {});
  assert.deepEqual(all.sessions.map(item => item.id), ['b1', 'a1', 'a2']);
  assert.equal(all.total, 3);
  assert.equal(all.sessions[0].projectName, '另一个项目');
  assert.equal(all.sessions.find(item => item.id === 'a1')?.pinned, true);
  assert.deepEqual(listSessions(data, { projectId: 'alpha' }).sessions.map(item => item.id), ['a1', 'a2']);
  assert.deepEqual(listSessions(data, { archived: false, projectId: 'alpha' }).sessions.map(item => item.id), ['a1']);
  assert.deepEqual(listSessions(data, { query: '另一' }).sessions.map(item => item.id), ['b1']);
  assert.equal(listSessions(data, { limit: 1 }).sessions.length, 1);
  assert.equal(listSessions(data, { since: 350 }).sessions.length, 1);
});

test('reading another session returns text only, with roles, paging and a character cap', () => {
  const found = data.threads.find(item => item.id === 'a1')!;
  const page = sessionMessages(found, { limit: 1, offset: 1 });
  assert.equal(page.total, 2, 'tool items are not part of the conversation surface');
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].role, 'assistant');
  assert.equal(page.messages[0].text, '它在 render 里被读取');
  assert.equal(page.title, '第一条任务');
  const users = sessionMessages(found, { roles: ['user'] });
  assert.deepEqual(users.messages.map(item => item.id), ['m1']);
  const capped = sessionMessages(found, { maxChars: 4 });
  assert.equal(capped.messages[0].text, '请找出 ');
  assert.equal(capped.messages[0].truncated, true);
});

test('session search spans projects, reports where a hit came from and stays capped', () => {
  const found = searchSessions(data, { query: 'hide_tool_calls' });
  assert.equal(found.truncated, false);
  assert.equal(found.hits.length, 1);
  assert.deepEqual({ threadId: found.hits[0].threadId, field: found.hits[0].field, projectName: found.hits[0].projectName },
    { threadId: 'a1', field: 'text', projectName: '示例项目' });
  assert.match(found.hits[0].excerpt, /hide_tool_calls/);
  // Review children and deleted sessions are not searchable either.
  assert.equal(searchSessions(data, { query: '审查里的细节' }).hits.length, 0);
  assert.equal(searchSessions(data, { query: '删除里的细节' }).hits.length, 0);
  // Only the visible archived session carries that phrase; review/sidechat/deleted sessions are out.
  assert.equal(searchSessions(data, { query: '细节' }).sessions, 1);
  assert.deepEqual(searchSessions(data, { query: '细节' }).hits.map(hit => hit.threadId), ['a2']);
  assert.deepEqual(searchSessions(data, { query: '另一个项目的结论', projectId: 'alpha' }).hits, []);
  const capped = searchSessions(data, { query: '的', limit: 1 });
  assert.equal(capped.hits.length, 1);
  assert.equal(capped.truncated, true);
  assert.deepEqual(searchSessions(data, { query: '   ' }).hits, []);
});
