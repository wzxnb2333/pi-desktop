import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type TimelineItem, timelineSchema } from '../src/shared/contracts.ts';
import { groupTurns, turnBlocks, turnFiles } from '../src/renderer/src/lib/timeline-groups.ts';

function item(overrides: Partial<TimelineItem> & { role: TimelineItem['role'] }): TimelineItem {
  return timelineSchema.parse({
    id: `id-${overrides.role}-${overrides.timestamp ?? 0}`,
    text: '',
    ...overrides,
  });
}

const user = (timestamp: number, text = `问题 ${timestamp}`) => item({ role: 'user', timestamp, text });
const say = (timestamp: number, text: string, state: TimelineItem['state'] = 'done', thinking = '') =>
  item({ role: 'assistant', timestamp, text, thinking, state });
const tool = (
  id: string,
  timestamp: number,
  toolName: string,
  state: TimelineItem['state'] = 'done',
  args?: string,
) => item({ role: 'tool', id, timestamp, toolName, state, args });
const notice = (id: string, timestamp: number, text: string) => item({ role: 'notice', id, timestamp, text });

test('no items means no turns', () => {
  assert.deepEqual(groupTurns([], true), []);
  assert.deepEqual(groupTurns([], false), []);
});

test('items ahead of the first user message form the prologue turn', () => {
  const first = say(100, '会话恢复的说明');
  const second = notice('n1', 150, 'MCP 连接失败');
  const ask = user(200);
  const turns = groupTurns([first, second, ask], false);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].key, 'prologue');
  assert.equal(turns[0].user, undefined);
  assert.equal(turns[0].startedAt, 100);
  assert.deepEqual(
    turns[0].entries.map((entry) => entry.kind),
    ['prose', 'notice'],
  );
  assert.equal(turns[0].result, first);
  assert.equal(turns[1].key, ask.id);
  assert.equal(turns[1].user, ask);
  assert.deepEqual(turns[1].entries, []);
});

test('a user request with one answer is one turn whose result is that answer', () => {
  const ask = user(1000);
  const answer = say(1002, '这是回答');
  const turns = groupTurns([ask, answer], false);
  assert.equal(turns.length, 1);
  const turn = turns[0];
  assert.equal(turn.key, ask.id);
  assert.equal(turn.startedAt, 1000);
  assert.equal(turn.state, 'done');
  assert.equal(turn.result, answer);
  assert.equal(turnBlocks(turn)[0].kind, 'answer');
  assert.equal(turnBlocks(turn)[0].key, answer.id + ':0');
});

test('contiguous tool items collapse into one tools entry with a count and distinct names', () => {
  const ask = user(100);
  const read = tool('c1', 110, 'read');
  const grep = tool('c2', 115, 'grep');
  const readAgain = tool('c3', 120, 'read');
  const answer = say(130, '读完了');
  const [turn] = groupTurns([ask, read, grep, readAgain, answer], false);
  assert.deepEqual(
    turn.entries.map((entry) => entry.kind),
    ['tools', 'prose'],
  );
  const tools = turn.entries[0];
  assert.equal(tools?.kind, 'tools');
  if (tools?.kind !== 'tools') return;
  assert.equal(tools.items.length, 3);
  assert.deepEqual(tools.toolNames, ['read', 'grep']);
  const blocks = turnBlocks(turn);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], {
    kind: 'activity',
    key: 'c1',
    preamble: [],
    tools: [read, grep, readAgain],
    toolNames: ['read', 'grep'],
  });
  assert.equal(blocks[1]?.kind, 'answer');
});

test('process prose remains independent and separates consecutive activity groups', () => {
  const first = say(110, '我先看两个文件');
  const answer = say(150, '已经改好了');
  const [turn] = groupTurns([user(100), first, tool('c1', 111, 'read'), tool('c2', 112, 'grep'), say(120, '现在编辑'), tool('c3', 130, 'edit'), answer], false);
  assert.equal(turn.result, answer);
  assert.deepEqual(turnBlocks(turn).map(block => block.kind), ['prose', 'activity', 'prose', 'activity', 'answer']);
});

test('streamed text stays provisional even when stopReason will be stop later', () => {
  const draft = { ...say(120, '看完了', 'running'), stopReason: 'stop' as const };
  const [turn] = groupTurns([user(100), tool('c1', 111, 'read'), draft], true);
  assert.equal(turn.result, undefined);
  assert.equal(turnBlocks(turn).at(-1)?.kind, 'prose');
  const completed = { ...draft, state: 'done' as const };
  assert.equal(groupTurns([user(100), completed], true)[0].result, completed);
  const withCall = { ...completed, blocks: [{ type: 'text' as const, text: '看完了' }, { type: 'toolCall' as const, id: 'c2', name: 'read', args: '{}' }] };
  assert.equal(groupTurns([user(100), withCall], true)[0].result, undefined);
});

test('ordered mixed content, cancellation and errors never fabricate final replies', () => {
  const mixed = { ...say(110, '说明\n结果'), blocks: [{ type: 'text' as const, text: '说明' }, { type: 'thinking' as const, text: '供应商思考' }, { type: 'text' as const, text: '结果' }], stopReason: 'stop' as const };
  const blocks = turnBlocks(groupTurns([user(100), mixed], false)[0]);
  assert.deepEqual(blocks.map(block => [block.kind, block.key]), [['prose', mixed.id + ':0'], ['thinking', mixed.id + ':1'], ['answer', mixed.id + ':2']]);
  for (const stopReason of ['aborted', 'error', 'toolUse', 'pending'] as const) assert.equal(groupTurns([user(100), { ...mixed, stopReason }], false)[0].result, undefined);
  const parallel = [tool('p1', 10, 'read', 'running'), tool('p2', 11, 'grep', 'running')];
  assert.equal(turnBlocks(groupTurns(parallel, true)[0])[0].key, 'p1');
  assert.equal(turnBlocks(groupTurns(parallel.map(entry => ({ ...entry, state: 'done' as const })), false)[0])[0].key, 'p1');
});

test('thinking stays attached to its own item inside a prose entry', () => {
  const ask = user(100);
  const first = say(110, 'A', 'done', '思考 A');
  const second = say(120, 'B', 'done', '思考 B');
  const [turn] = groupTurns([ask, first, second], false);
  assert.equal(turn.entries.length, 1);
  assert.deepEqual(turn.entries[0]?.items, [first, second]);
  assert.deepEqual(
    turn.entries[0]?.items.map((entry) => entry.thinking),
    ['思考 A', '思考 B'],
  );
});

test('each user item opens a new turn', () => {
  const first = user(100, '第一个问题');
  const answer = say(110, '第一个回答');
  const second = user(200, '第二个问题');
  const later = say(210, '第二个回答');
  const turns = groupTurns([first, answer, second, later], false);
  assert.deepEqual(
    turns.map((turn) => [turn.key, turn.user?.text, turn.result?.text]),
    [
      [first.id, '第一个问题', '第一个回答'],
      [second.id, '第二个问题', '第二个回答'],
    ],
  );
  assert.deepEqual(turns.map((turn) => turn.state), ['done', 'done']);
});

test('only the last turn follows the running flag', () => {
  const first = user(100);
  const answer = say(110, '好了');
  const second = user(200);
  const running = say(210, '正在写', 'running');
  const turns = groupTurns([first, answer, second, running], false);
  assert.deepEqual(turns.map((turn) => turn.state), ['done', 'running']);
  const idle = groupTurns([first, answer, second], true);
  assert.deepEqual(idle.map((turn) => turn.state), ['done', 'running']);
  const settled = groupTurns([first, answer, second], false);
  assert.deepEqual(settled.map((turn) => turn.state), ['done', 'done']);
});

test('turn state reports an errored answer but a recovered tool failure stays done', () => {
  const ask = user(100);
  const failed = tool('c1', 110, 'write', 'error');
  const recovered = say(120, '换了个写法');
  const [ok] = groupTurns([ask, failed, recovered], false);
  assert.equal(ok.state, 'done');
  const broken = say(120, '请求失败', 'error');
  const [errored] = groupTurns([ask, broken], false);
  assert.equal(errored.state, 'error');
  const [noAnswer] = groupTurns([ask, tool('c9', 110, 'write', 'error')], false);
  assert.equal(noAnswer.state, 'error');
});

test('unique turn keys survive duplicated user ids', () => {
  const first = item({ role: 'user', id: 'user-100', timestamp: 100 });
  const second = item({ role: 'user', id: 'user-100', timestamp: 100 });
  assert.deepEqual(groupTurns([first, second], false).map((turn) => turn.key), ['user-100', 'user-100#2']);
});

test('a notice interleaved by timestamp stays inside its own turn', () => {
  // This is the order the main process restores after a result event: notices keep their emission
  // slot rather than moving to the end of the thread.
  const ask = user(100);
  const prelude = tool('c1', 110, 'read');
  const retry = notice('n1', 120, '供应商请求失败，Pi 正在重试…');
  const answer = say(130, '重试后完成');
  const oldAsk = user(10);
  const [, turn] = groupTurns([oldAsk, say(20, '上一轮'), ask, prelude, retry, answer], false);
  assert.equal(turn.key, ask.id);
  assert.deepEqual(
    turn.entries.map((entry) => entry.kind),
    ['tools', 'notice', 'prose'],
  );
  assert.equal(turn.result, answer);
  const blocks = turnBlocks(turn);
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ['activity', 'notice', 'answer'],
  );
});

test('an appended notice drifts onto the last turn, which the merge order fixes', () => {
  const first = user(100);
  const firstAnswer = say(110, '第一轮');
  const second = user(200);
  const secondAnswer = say(210, '第二轮');
  const midTurn = notice('n1', 150, '正在压缩上下文…');
  const appended = groupTurns([first, firstAnswer, second, secondAnswer, midTurn], false);
  assert.equal(appended.length, 2, 'the notice cannot open a turn of its own');
  assert.deepEqual(
    appended[1]?.entries.map((entry) => entry.kind),
    ['prose', 'notice'],
    'pushed to the end of the array means shown on the newest turn',
  );
  const interleaved = groupTurns([first, firstAnswer, midTurn, second, secondAnswer], false);
  assert.deepEqual(
    interleaved[0]?.entries.map((entry) => entry.kind),
    ['prose', 'notice'],
  );
  assert.deepEqual(
    interleaved[1]?.entries.map((entry) => entry.kind),
    ['prose'],
  );
});

test('turnFiles only sees tool items whose arguments survived', () => {
  const ask = user(100);
  const withArgs = tool('c1', 110, 'write', 'done', JSON.stringify({ path: 'src/a.ts' }));
  const restored = tool('c2', 115, 'edit');
  const other = tool('c3', 118, 'powershell', 'done', JSON.stringify({ command: 'Get-ChildItem' }));
  const broken = tool('c4', 119, 'read', 'done', '{ truncated');
  const again = tool('c5', 120, 'write', 'done', JSON.stringify({ path: 'src/a.ts' }));
  const [turn] = groupTurns([ask, withArgs, restored, other, broken, again], false);
  assert.deepEqual(turnFiles(turn), ['src/a.ts']);
});
