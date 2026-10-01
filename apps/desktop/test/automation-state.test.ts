import assert from 'node:assert/strict';
import { test } from 'node:test';
import { saveAutomationConfiguration } from '../src/main/automation-state.ts';
import { automationSchema } from '../src/shared/contracts.ts';

const job = () => automationSchema.parse({ id: 'a', name: '计划', projectId: 'p', prompt: '检查项目',
  intervalMinutes: 60, enabled: true, nextRunAt: 1000, lastRunAt: 100, lastThreadId: 'latest' });

test('new automation ignores renderer-supplied run history and due time', () => {
  const created = saveAutomationConfiguration(undefined, job(), 2000);
  assert.equal(created.nextRunAt, 2000 + 60 * 60_000);
  assert.equal(created.lastRunAt, undefined);
  assert.equal(created.lastThreadId, undefined);
});

test('editing configuration retains authoritative runtime fields and in-flight object identity', () => {
  const current = job();
  const stale = { ...current, name: ' 新名称 ', prompt: '新描述', nextRunAt: 0, lastThreadId: 'stale', lastRunAt: 0 };
  current.nextRunAt = 9000;
  current.lastRunAt = 3000;
  const saved = saveAutomationConfiguration(current, stale, 4000);
  assert.equal(saved, current);
  assert.equal(saved.name, '新名称');
  assert.equal(saved.prompt, '新描述');
  assert.equal(saved.nextRunAt, 9000);
  assert.equal(saved.lastRunAt, 3000);
  assert.equal(saved.lastThreadId, 'latest');
  current.lastThreadId = 'started-during-save';
  assert.equal(saved.lastThreadId, 'started-during-save');
});

test('pausing and resuming retain a missed run while a new schedule recalculates it', () => {
  const current = job();
  saveAutomationConfiguration(current, { ...current, enabled: false }, 5000);
  assert.equal(current.nextRunAt, 1000);
  saveAutomationConfiguration(current, { ...current, enabled: true }, 6000);
  assert.equal(current.nextRunAt, 1000);
  saveAutomationConfiguration(current, { ...current, intervalMinutes: 5 }, 7000);
  assert.equal(current.nextRunAt, 307000);
  const now = Date.parse('2026-09-26T00:00:00Z');
  saveAutomationConfiguration(current, { ...current, schedule: { kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai', weekday: 1, monthday: 1 } }, now);
  assert.equal(current.nextRunAt, Date.parse('2026-09-26T01:00:00Z'));
  saveAutomationConfiguration(current, { ...current, schedule: undefined }, now);
  assert.equal(current.nextRunAt, now + 5 * 60_000);
});

// Durable scheduler races, pause/removal and restart behavior are in scheduler.test.ts.
