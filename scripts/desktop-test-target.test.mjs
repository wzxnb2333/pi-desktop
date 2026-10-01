import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import test from 'node:test';
import { buildPlan, desktop, parseArguments, repository, runCommand, runPlan } from './desktop-test-target.mjs';
import { targets } from './desktop-test-targets.mjs';

const plan = (...args) => buildPlan(parseArguments(args));

test('no selection, unknown targets and ambiguous flags never fall back to full suites', () => {
  for (const args of [[], ['typo'], ['all'], ['toolbar', '--file', 'test/layout.test.ts'], ['toolbar', '--level', 'unknown'],
    ['--file'], ['toolbar', '--grep', 'foo'], ['--file', 'test/layout.test.ts', '--grep', '['],
    ['--file', 'test/layout.test.ts', '--level', 'unit'], ['toolbar', '--unexpected']])
    assert.throws(() => parseArguments(args));
});

test('toolbar default runs one unit file and only its two interface cases', () => {
  const selection = plan('toolbar');
  assert.equal(selection.level, 'quick');
  assert.deepEqual(selection.commands.map(command => command.kind), ['unit', 'ui']);
  assert.deepEqual(selection.commands[0].files.map(file => basename(file)), ['layout.test.ts']);
  assert.equal(selection.commands[1].args[selection.commands[1].args.indexOf('--grep') + 1], 'compact toolbar|summary and tool pane');
  assert.ok(selection.commands[0].args.includes('tsx'));
});

test('native, unit and ui are exclusive, while all includes only the selected module', () => {
  for (const level of ['unit', 'ui', 'native']) assert.deepEqual(plan('toolbar', '--level', level).commands.map(command => command.kind), [level]);
  assert.deepEqual(plan('toolbar', '--level', 'all').commands.map(command => command.kind), ['unit', 'ui', 'native']);
  assert.throws(() => plan('sidebar', '--level', 'native'), /没有该层级/);
});

test('multiple targets deduplicate files and combine filters only inside their own suite', () => {
  const selection = plan('toolbar', 'summary', 'toolbar');
  assert.equal(selection.commands.length, 2);
  assert.deepEqual(selection.commands[0].files.map(file => basename(file)), ['layout.test.ts', 'turn-plans.test.ts']);
  const ui = selection.commands[1];
  assert.match(ui.args[ui.args.indexOf('--grep') + 1], /compact toolbar/);
  assert.match(ui.args[ui.args.indexOf('--grep') + 1], /summary Git/);
  assert.equal(plan('toolbar', 'sidebar').commands[0].files.filter(file => basename(file) === 'layout.test.ts').length, 1);
});

test('every registry entry names an existing test and quick selections do not launch Electron', () => {
  const config = readFileSync(join(desktop, 'playwright.nonvisual.config.ts'), 'utf8');
  for (const name of Object.keys(targets)) {
    const selected = plan(name, '--level', 'all');
    for (const command of selected.commands) for (const file of command.files) {
      if (command.kind !== 'unit') assert.ok(config.includes("'" + basename(file) + "'"), name + ': suite absent from config');
      if (command.kind === 'ui') assert.doesNotMatch(readFileSync(file, 'utf8'), /startDevelopmentSource|acceptanceApp|electron\.launch/, name + ': native suite in quick layer');
    }
    assert.ok(plan(name).commands.every(command => command.kind !== 'native'));
  }
});

test('file selectors escape regex metacharacters and cannot include similarly named neighbours', () => {
  const command = plan('toolbar', '--level', 'ui').commands[0];
  const pattern = new RegExp(command.args[4]);
  assert.ok(pattern.test(join(desktop, 'test', 'e2e', 'summary.spec.ts')));
  assert.ok(pattern.test('test/e2e/summary.spec.ts'));
  for (const file of ['summaryXspecXts', 'prefix-summary.spec.ts', 'summary.spec.ts.old']) assert.equal(pattern.test(file), false);
  assert.ok(command.args.includes('--max-failures=1'));
  assert.ok(command.args.includes('--reporter=list'));
  assert.ok(command.args.some(arg => arg.startsWith('--output=') && arg.includes('desktop-targeted')));
});

test('each named case filter still occurs in its selected test source', () => {
  for (const [name, target] of Object.entries(targets)) for (const kind of ['ui', 'native']) for (const suite of target[kind] ?? []) {
    const source = readFileSync(join(desktop, 'test/e2e', suite.file), 'utf8');
    for (const filter of suite.grep?.split('|') ?? []) assert.match(source, new RegExp(filter), name + ': stale case filter ' + filter);
  }
});

test('explicit files work from root, desktop or absolute paths and carry the exact case filter', () => {
  const path = join(desktop, 'test', 'layout.test.ts');
  for (const file of ['test/layout.test.ts', 'apps/desktop/test/layout.test.ts', path]) {
    const command = plan('--file', file, '--grep', 'summary and tools').commands[0];
    assert.deepEqual(command.files, [path]);
    assert.equal(command.args[command.args.indexOf('--test-name-pattern') + 1], 'summary and tools');
  }
  const command = plan('--file', 'test/e2e/browser.nonvisual.spec.ts', '--grep', 'browser overflow').commands[0];
  assert.equal(command.args[command.args.indexOf('--grep') + 1], 'browser overflow');
});

test('missing files, folders, wildcards and paths outside desktop tests are rejected before running', () => {
  for (const file of ['test/no-such-file.test.ts', 'test', 'test/*.test.ts', '../../scripts/desktop-test-target.test.mjs', 'src/main/store.ts'])
    assert.throws(() => plan('--file', file));
});

test('a failed command stops later stages and preserves the original exit code', async () => {
  const calls = [];
  const result = await runPlan(plan('toolbar'), async command => { calls.push(command); return { exitCode: 7 }; });
  assert.equal(calls.length, 1);
  assert.equal(result.exitCode, 7);
  assert.equal(result.planned, 2);
  assert.equal(result.steps.length, 1);
});

test('startup errors are recorded instead of allowing a later stage to look successful', async () => {
  const result = await runPlan(plan('toolbar'), async () => { throw new Error('fixture spawn failure'); });
  assert.equal(result.exitCode, 1);
  assert.equal(result.steps.length, 1);
  assert.match(result.steps[0].error, /fixture spawn failure/);
});

test('unit case filters actually execute one case and report its pass count', async () => {
  const command = plan('--file', 'test/layout.test.ts', '--grep', '^summary and tools').commands[0];
  const result = await runCommand(command);
  assert.equal(result.exitCode, 0);
  assert.equal(result.passed, 1);
});

test('an unmatched unit case cannot return a successful result', async () => {
  const command = plan('--file', 'test/layout.test.ts', '--grep', '^NO_SUCH_TARGETED_CASE$').commands[0];
  const result = await runCommand(command);
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.passed, 0);
});

test('child process failures propagate without shell interpretation', async () => {
  const result = await runCommand({ kind: 'ui', executable: process.execPath, args: ['-e', 'process.exit(9)'], cwd: desktop });
  assert.equal(result.exitCode, 9);
});

test('CLI dry-run is cwd-independent and does not start a test runner', () => {
  const result = spawnSync(process.execPath, [join(repository, 'scripts/desktop-test-target.mjs'), 'toolbar', '--dry-run'], { cwd: desktop, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const selection = JSON.parse(result.stdout);
  assert.equal(selection.commands.length, 2);
  assert.equal(selection.commands[0].cwd, desktop);
  assert.doesNotMatch(result.stdout, /Running [0-9]+ tests|TAP version/);
});

test('CLI without arguments exits with guidance instead of starting every suite', () => {
  const result = spawnSync(process.execPath, [join(repository, 'scripts/desktop-test-target.mjs')], { cwd: repository, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /不会默认运行全套测试/);
  assert.equal(result.stdout, '');
});
