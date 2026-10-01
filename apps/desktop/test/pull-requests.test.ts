import assert from 'node:assert/strict';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mkdtemp } from './fixtures/node-temp.ts';
import { PullRequests } from '../src/main/pull-requests.ts';
import { gitRun } from '../src/main/git.ts';

const fake = String.raw`import { appendFile, readFile } from 'node:fs/promises';
const args = process.argv.slice(2);
const state = JSON.parse(await readFile('control.json','utf8'));
const bodyFile = args.includes('--body-file') ? args[args.indexOf('--body-file') + 1] : undefined;
await appendFile('calls.jsonl', JSON.stringify({args, body: bodyFile ? await readFile(bodyFile,'utf8') : undefined, prompt: process.env.GH_PROMPT_DISABLED}) + '\n');
if (args[0] === '--version') console.log('gh version test');
else if (args[0] === 'auth') { if (state.auth === false) { console.error('invalid login'); process.exitCode = 1; } }
else if (state.hold) await new Promise(resolve => setTimeout(resolve, 120000));
else if (state.fail) { console.error('error ghp_MUST_NOT_LEAK https://user:password@example.invalid/'); process.exitCode = 1; }
else if (args[1] === 'create') console.log('https://github.com/test/project/pull/7');
else console.log(JSON.stringify({number:7,title:'标题',body:'原始说明',url:'https://github.com/test/project/pull/7',state:'OPEN',isDraft:true,baseRefName:'main',headRefName:'feature',comments:[{body:'原始评论',createdAt:'2026-09-27',author:{login:'reviewer'}}],reviews:[]}));
`;

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-pr-')); const storage = join(cwd, 'storage'); await mkdir(storage);
  const cli = join(cwd, 'fake-gh.mjs'); await writeFile(cli, fake); await writeFile(join(cwd, 'control.json'), '{}');
  await gitRun(cwd, ['init', '-b', 'feature']);
  return { cwd, storage, service: new PullRequests(storage, { command: process.execPath, args: [cli] }),
    control: (value: object) => writeFile(join(cwd, 'control.json'), JSON.stringify(value)),
    calls: async () => (await readFile(join(cwd, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { args: string[]; body?: string; prompt: string }),
  };
}
test('gh adapter runs the real child process protocol, uses explicit head/body file, and never commits or pushes', async () => {
  const { cwd, storage, service, calls } = await fixture();
  assert.equal((await service.status(cwd)).authenticated, true);
  const body = '中文\n\nLiteral \u00060code\u00060 and $(do-not-run)';
  for (const draft of [true, false]) assert.equal((await service.create(cwd, { title: '标题', body, base: 'main', draft }, new AbortController().signal, () => {})).url, 'https://github.com/test/project/pull/7');
  const requests = (await calls()).filter(call => call.args[1] === 'create');
  assert.deepEqual(requests.map(call => call.args.includes('--draft')), [true, false]);
  for (const call of requests) {
    assert.equal(call.args[call.args.indexOf('--head') + 1], 'feature'); assert.equal(call.body, body); assert.equal(call.prompt, '1');
    assert.equal(call.args.includes('--web'), false); assert.equal(call.args.includes('push'), false);
    await assert.rejects(access(call.args[call.args.indexOf('--body-file') + 1]), { code: 'ENOENT' });
  }
  assert.deepEqual(await readdir(join(storage, 'operations', 'pr')), []);
  const result = await service.view(cwd, '7'); assert.equal(result.comments[0].body, '原始评论'); assert.equal(result.isDraft, true);
  await assert.rejects(service.view(cwd, '--web'), /有效/);
  await assert.rejects(gitRun(cwd, ['rev-parse', '--verify', 'HEAD']));
});
test('missing CLI, expired login, external errors and cancellation have recovery paths and clean body files', async () => {
  const { cwd, storage, service, control, calls } = await fixture();
  assert.equal((await new PullRequests(storage, { command: join(cwd, 'missing.exe'), args: [] }).status(cwd)).available, false);
  await control({ auth: false }); assert.equal((await service.status(cwd)).authenticated, false);
  await assert.rejects(service.create(cwd, { title: 'x', body: '', base: 'main', draft: true }, new AbortController().signal, () => {}), /gh auth login/);
  await control({ fail: true });
  await assert.rejects(service.create(cwd, { title: 'x', body: '', base: 'main', draft: true }, new AbortController().signal, () => {}), error => { assert.doesNotMatch(String(error), /MUST_NOT_LEAK|password/); return true; });
  assert.deepEqual(await readdir(join(storage, 'operations', 'pr')), []);
  await control({ hold: true }); const controller = new AbortController();
  const pending = service.create(cwd, { title: 'cancel', body: '', base: 'main', draft: true }, controller.signal, () => { setTimeout(() => controller.abort(), 100); });
  await assert.rejects(pending, /取消/); assert.deepEqual(await readdir(join(storage, 'operations', 'pr')), []);
  assert.ok((await calls()).length > 3);
});
