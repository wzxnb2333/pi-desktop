import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RuntimeSleepPreference, shouldNotifyCompletion } from '../src/main/runtime-preferences.ts';
import { settingsSchema } from '../src/shared/contracts.ts';

test('notifications honor focus, explicit conditions and the legacy off switch', () => {
  const settings = settingsSchema.parse({});
  assert.equal(shouldNotifyCompletion(settings, false), true);
  assert.equal(shouldNotifyCompletion(settings, true), false);
  assert.equal(shouldNotifyCompletion({ ...settings, notificationMode: 'always' }, true), true);
  assert.equal(shouldNotifyCompletion({ ...settings, notificationMode: 'never' }, false), false);
  assert.equal(shouldNotifyCompletion({ ...settings, notifications: false, notificationMode: 'always' }, false), false);
});
test('one system blocker covers all running tasks and releases during approval, disable and shutdown', () => {
  const calls: string[] = [];
  const service = new RuntimeSleepPreference({ start: type => { calls.push(type); return 7; }, stop: id => { calls.push('stop:' + id); return true; } }, error => { throw error; });
  service.update(false, [{ status: 'running' }]);
  service.update(true, [{ status: 'running' }, { status: 'running' }]);
  service.update(true, [{ status: 'idle' }, { status: 'running' }]);
  assert.deepEqual(calls, ['prevent-app-suspension']);
  service.update(true, [{ status: 'waiting' }]);
  assert.equal(calls.at(-1), 'stop:7');
  service.update(true, [{ status: 'running' }]);
  service.update(false, [{ status: 'running' }]);
  service.update(true, [{ status: 'running' }]);
  service.dispose();
  service.update(true, [{ status: 'running' }]);
  assert.equal(calls.filter(call => call === 'stop:7').length, 3);
  assert.equal(calls.length, 6);
});
test('blocker failures surface once and an explicit retry recovers', () => {
  let attempts = 0;
  const errors: Error[] = [];
  const service = new RuntimeSleepPreference({ start: () => { if (++attempts === 1) throw new Error('OS failure'); return 1; }, stop: () => true }, error => errors.push(error));
  service.update(true, [{ status: 'running' }]);
  service.update(true, [{ status: 'running' }]);
  assert.equal(errors.length, 1);
  service.update(false, []);
  service.update(true, [{ status: 'running' }]);
  assert.equal(attempts, 2);
  service.dispose();
});
