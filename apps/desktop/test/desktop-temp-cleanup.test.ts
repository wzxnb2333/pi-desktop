import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

test('desktop sweep removes verified fixtures and preserves live owners, foreign data and link targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-sweep-test-'));
  const external = await mkdtemp(join(tmpdir(), 'pi-sweep-external-'));
  try {
    await writeFile(join(external, 'keep.txt'), 'USER DATA');
    const owned = join(root, 'pi-desktop-e2e-Own001');
    const foreign = join(root, 'pi-desktop-e2e-Foreig');
    for (const path of [owned, foreign]) {
      await mkdir(join(path, 'demo-project'), { recursive: true });
      const project = path === owned ? join(path, 'demo-project') : external;
      await writeFile(join(path, 'desktop.json'), JSON.stringify({ version: path === owned ? 2 : 1, projects: [{ path: project }], threads: [{ cwd: project }] }));
      await mkdir(join(path, 'Cache'));
      await writeFile(join(path, 'Cache/data_0'), 'cache');
    }
    await symlink(external, join(owned, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
    const dead = join(root, 'pi-desktop-tests-Dead01');
    const live = join(root, 'pi-desktop-tests-Live01');
    for (const path of [dead, live]) {
      await mkdir(path);
      await writeFile(join(path, '.pi-test-owner.json'), JSON.stringify({ kind: 'pi-desktop-test', version: 1, root: path, pid: path === live ? process.pid : 2147483647 }));
      await writeFile(join(path, 'cache'), 'fixture');
    }
    const harness = join(root, 'pi-composer-Bundle');
    await mkdir(harness); await writeFile(join(harness, 'harness.js'), '// src/renderer/src/components/composer.tsx\n// react fixture');
    const privateData = join(root, 'pi-private-Keep01');
    await mkdir(privateData); await writeFile(join(privateData, 'keep.txt'), 'NOT A FIXTURE');
    const linkedRoot = join(root, 'pi-composer-Linked');
    await symlink(external, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    const empty = join(root, 'pi-panels-Empty1');
    await mkdir(join(empty, 'Cache'), { recursive: true });
    const oldProbe = join(root, 'pi-composer-probe');
    await mkdir(oldProbe);
    const corrupt = join(root, 'pi-acceptance-Corupt');
    await mkdir(join(corrupt, 'project/.git/objects/aa'), { recursive: true });
    await writeFile(join(corrupt, 'project/.git/objects/aa', 'a'.repeat(38)), 'not a git object');
    const firstRun = join(root, 'pi-desktop-first-New001');
    await mkdir(join(firstRun, '新项目'), { recursive: true });
    await writeFile(join(firstRun, 'desktop.json'), JSON.stringify({ version: 1, projects: [], threads: [], settings: { providers: [] } }));
    const git = join(root, 'pi-acceptance-Git001');
    const blob = Buffer.from('blob 5\0hello');
    const treeBody = Buffer.concat([Buffer.from('100644 README.md\0'), createHash('sha1').update(blob).digest()]);
    const tree = Buffer.concat([Buffer.from('tree ' + treeBody.length + '\0'), treeBody]);
    const body = Buffer.from('tree ' + createHash('sha1').update(tree).digest('hex') + '\nauthor Peer Test <peer@example.invalid> 1790375670 +0800\ncommitter Peer Test <peer@example.invalid> 1790375670 +0800\n\nfixture\n');
    const commit = Buffer.concat([Buffer.from('commit ' + body.length + '\0'), body]);
    for (const data of [blob, tree, commit]) {
      const hash = createHash('sha1').update(data).digest('hex');
      const prefix = join(git, 'peer/.git/objects', hash.slice(0, 2));
      await mkdir(prefix, { recursive: true });
      await writeFile(join(prefix, hash.slice(2)), deflateSync(data));
    }
    const script = fileURLToPath(new URL('../scripts/cleanup-desktop-temp.mjs', import.meta.url));
    const args = [script, '--root', root, '--minimum-age-minutes', '0'];
    const preview = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
    assert.equal(preview.applied, false);
    assert.equal(preview.eligible, 7);
    assert.equal(preview.skipped, 5);
    await access(owned);
    const unsafeReport = spawnSync(process.execPath, [...args, '--apply', '--report', join(owned, 'report.json')], { encoding: 'utf8' });
    assert.notEqual(unsafeReport.status, 0);
    await access(owned);
    const result = JSON.parse(execFileSync(process.execPath, [...args, '--apply'], { encoding: 'utf8' }));
    assert.equal(result.removed, 7);
    assert.equal(result.skipped, 5);
    for (const path of [owned, dead, harness, empty, firstRun, git, oldProbe]) await assert.rejects(access(path), { code: 'ENOENT' });
    for (const path of [foreign, live, privateData, linkedRoot, corrupt]) await access(path);
    assert.equal(await readFile(join(external, 'keep.txt'), 'utf8'), 'USER DATA');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});
