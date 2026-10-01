import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextAutomationRun } from '../src/shared/schedule.ts';
import { automationSchema } from '../src/shared/contracts.ts';

function next(timezone: string, time: string, after: string, extra = {}) {
  const job = automationSchema.parse({ id: 'a', projectId: 'p', name: 'daily', prompt: 'check', intervalMinutes: 60, enabled: true, nextRunAt: 0,
    schedule: { kind: 'daily', timezone, time, ...extra } });
  return new Date(nextAutomationRun(job, Date.parse(after))).toISOString();
}
test('calendar uses explicit timezone and coalesces missed runs', () => {
  assert.equal(next('Asia/Shanghai', '09:00', '2026-09-26T00:00:00Z'), '2026-09-26T01:00:00.000Z');
  assert.equal(next('Asia/Shanghai', '09:00', '2026-09-26T02:00:00Z'), '2026-09-27T01:00:00.000Z');
});
test('spring gap advances to the next valid local minute', () => {
  assert.equal(next('America/New_York', '02:30', '2026-03-08T00:00:00Z'), '2026-03-08T07:00:00.000Z');
});
test('fall-back repeated time runs only once', () => {
  assert.equal(next('America/New_York', '01:30', '2026-11-01T00:00:00Z'), '2026-11-01T05:30:00.000Z');
  assert.equal(next('America/New_York', '01:30', '2026-11-01T05:31:00Z'), '2026-11-02T06:30:00.000Z');
});
test('weekly and monthly missing dates are deterministic', () => {
  assert.equal(next('UTC', '10:00', '2026-09-26T00:00:00Z', { kind: 'weekly', weekday: 1 }), '2026-09-28T10:00:00.000Z');
  assert.equal(next('UTC', '10:00', '2026-02-01T00:00:00Z', { kind: 'monthly', monthday: 31 }), '2026-02-28T10:00:00.000Z');
});
