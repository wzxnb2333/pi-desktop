import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Thread, timelineSchema } from '../src/shared/contracts.ts';
import { groupTurns } from '../src/renderer/src/lib/timeline-groups.ts';
import { turnPlans } from '../src/renderer/src/lib/turn-plans.ts';

const plan = (text: string): Thread['plan'] => [{ text, status: 'pending' }];
const items = ['first', 'second', 'third'].map((id, timestamp) => timelineSchema.parse({ id, role: 'user', text: id, timestamp }));

test('summary and conversation plan ownership follow message order, not dictionary insertion order', () => {
  const first = plan('旧计划');
  const second = plan('当前计划');
  const owned = { second, first, removed: plan('不在当前会话的计划') };
  const result = turnPlans({ plan: plan('过期摘要'), plans: owned }, groupTurns(items, true));
  assert.deepEqual([...result], [['first', first], ['second', second]]);
  assert.equal(result.get('second'), second);
  assert.deepEqual(Object.keys(owned), ['second', 'first', 'removed']);
});

test('legacy plans appear only in the latest actual turn, including restored prologue', () => {
  const steps = plan('旧记录');
  assert.deepEqual([...turnPlans({ plan: steps }, groupTurns(items, false))], [['third', steps]]);
  const prologue = timelineSchema.parse({ id: 'a', role: 'assistant', text: '恢复内容', timestamp: 1 });
  assert.deepEqual([...turnPlans({ plan: steps }, groupTurns([prologue], false))], [['prologue', steps]]);
  assert.deepEqual([...turnPlans({ plan: steps }, [])], []);
});

test('an explicit cleared plan suppresses stale summary without copying another round into it', () => {
  const result = turnPlans({ plan: plan('过期摘要'), plans: { first: plan('前一轮'), second: [] } }, groupTurns(items, false));
  assert.deepEqual([...result].at(-1), ['second', []]);
  assert.equal(result.has('third'), false);
  assert.deepEqual([...turnPlans({ plan: plan('不能推断归属'), plans: {} }, groupTurns(items, false))], []);
  assert.deepEqual([...turnPlans(undefined, groupTurns(items, false))], []);
});

test('plan keys match the rendered stable turn keys after duplicate message identifiers', () => {
  const turns = groupTurns([items[0], { ...items[0], timestamp: 9 }], false);
  assert.deepEqual([...turnPlans({ plan: [], plans: { first: plan('已记录') } }, turns).keys()], ['first', 'first#2']);
});
