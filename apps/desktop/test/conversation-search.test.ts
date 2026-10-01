import assert from 'node:assert/strict';
import { test } from 'node:test';
import { timelineSchema, threadSchema } from '../src/shared/contracts.ts';
import { conversationSources, conversationTarget, findConversation } from '../src/renderer/src/lib/conversation-search.ts';
import { matchesSearch } from '../src/renderer/src/hooks/use-thread-list.ts';

const item = (id: string, value: Record<string, unknown>) => timelineSchema.parse({ id, timestamp: 1, ...value });
const user = item('user', { role: 'user', text: '问题' });
const result = item('answer', { role: 'assistant', text: '最终回答', stopReason: 'stop' });

test('ordered text and thinking blocks retain exact targets and only their required ancestors', () => {
  const assistant = item('mixed', { role: 'assistant', text: '重复汇总不应索引', thinking: '旧汇总不应索引', blocks: [
    { type: 'text', text: '第一段' }, { type: 'thinking', text: '供应商思考' },
    { type: 'text', text: '第二段' }, { type: 'toolCall', id: 'call', name: 'read', args: '{}' },
  ] });
  const sources = conversationSources([user, assistant, result], false);
  assert.deepEqual(sources.map(source => source.text), ['问题', '第一段', '供应商思考', '第二段', '最终回答']);
  assert.deepEqual(sources[0].folds, []);
  assert.deepEqual(sources[2].folds, ['process:user', 'thinking:mixed:1']);
  assert.equal(sources[3].target, conversationTarget('mixed:2', 'text:mixed'));
  assert.deepEqual(sources.at(-1)!.folds, []);
});

test('reading, commands, MCP and edit diff targets respect independent raw folds', () => {
  const tools = [
    item('read', { role: 'tool', toolName: 'read', args: '{"path":"src/a.ts"}', text: '读取输出' }),
    item('bash', { role: 'tool', toolName: 'bash', args: '{"command":"pwd"}', text: '命令输出' }),
    item('mcp', { role: 'tool', toolName: 'mcp_query', args: '{}', text: 'MCP 输出' }),
    item('edit', { role: 'tool', toolName: 'edit', args: '{}', text: '修改完成', details: { diff: '-before\n+after' } }),
  ];
  const sources = conversationSources([user, ...tools, result], false);
  assert.deepEqual(sources.find(source => source.text === '读取输出')!.folds, ['process:user', 'group:read', 'tool:read', 'raw:read']);
  assert.deepEqual(sources.find(source => source.text === '命令输出')!.folds, ['process:user', 'group:read', 'tool:bash']);
  assert.deepEqual(sources.find(source => source.text === 'MCP 输出')!.folds, ['process:user', 'group:read', 'tool:mcp']);
  assert.deepEqual(sources.find(source => source.text.startsWith('-before'))!.folds, ['process:user', 'group:read', 'tool:edit']);
  assert.equal(findConversation(sources, 'src/a.ts').total, 1);
});

test('notices and recovered errors remain searchable without conflating activity groups', () => {
  const sources = conversationSources([user, item('one', { role: 'tool', toolName: 'read', text: 'first' }),
    item('notice', { role: 'notice', text: '需要处理' }), item('two', { role: 'tool', toolName: 'read', text: 'second' }), result], false);
  assert.deepEqual(sources.find(source => source.text === '需要处理')!.folds, ['process:user']);
  assert.equal(sources.find(source => source.text === '需要处理')!.target, conversationTarget('notice', 'text:notice'));
  assert.deepEqual(sources.find(source => source.text === 'second')!.folds, ['process:user', 'group:two', 'tool:two', 'raw:two']);
});

test('streaming additions preserve earlier targets and repeated message ids stay scoped to turns', () => {
  const first = conversationSources([user, result], false);
  const next = conversationSources([user, result, user, { ...result, text: '新的最终回答' }], true);
  assert.deepEqual(next.slice(0, 2).map(source => source.key), first.map(source => source.key));
  assert.equal(new Set(next.map(source => source.key)).size, next.length);
  assert.equal(next[2].turnKey, 'user#2');
});

test('literal Unicode occurrences preserve offsets, count truncated results and reject blank queries', () => {
  const sources = conversationSources([item('unicode', { role: 'user', text: 'İ 汉字 [a+b].* Aaa [a+b].* 中文😀中文' })], false);
  const regex = findConversation(sources, '[a+b].*', 1);
  assert.equal(regex.total, 2);
  assert.equal(regex.matches.length, 1);
  assert.equal(findConversation(sources, '[a+b].*', 1, 1).matches[0].occurrence, 1);
  assert.equal(findConversation(sources, '[a+b].*', 1, 2).matches.length, 0);
  assert.equal(regex.matches[0].text.slice(regex.matches[0].start, regex.matches[0].end), '[a+b].*');
  assert.equal(findConversation(sources, 'aaa').matches[0].start, sources[0].text.indexOf('Aaa'));
  const chinese = findConversation(sources, ' 中文 ');
  assert.equal(chinese.total, 2);
  assert.deepEqual(chinese.matches.map(match => match.occurrence), [0, 1]);
  assert.equal(chinese.matches[1].text.slice(chinese.matches[1].start, chinese.matches[1].end), '中文');
  assert.equal(findConversation(sources, '   ').total, 0);
});

test('sidebar matches stored thinking, arguments, ordered text and edit details', () => {
  const thread = threadSchema.parse({ id: 't', projectId: 'p', title: '任务', cwd: '.', createdAt: 1, updatedAt: 1, modelId: 'fake', thinking: 'off', policy: 'ask', items: [
    item('mixed', { role: 'assistant', text: '', thinking: '真实思考', blocks: [{ type: 'text', text: '有序文本' }] }),
    item('edit', { role: 'tool', text: '完成', args: '{"path":"Config.ts"}', details: { diff: '+新增配置' } }),
  ] });
  for (const query of ['真实思考', '有序文本', 'config.ts', '新增配置']) assert.equal(matchesSearch(thread, query), true);
  assert.equal(matchesSearch(thread, '不存在'), false);
});
