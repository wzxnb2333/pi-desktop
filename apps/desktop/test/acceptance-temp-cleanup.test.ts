import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';

test('acceptance cache cleanup previews by default and rejects foreign data and junctions', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-cleanup-test-'));
  const external = await mkdtemp(join(tmpdir(), 'pi-cleanup-external-'));
  try {
    await writeFile(join(external, 'keep.txt'), 'USER DATA');
    const owned = join(root, 'pi-acceptance-Own001');
    const foreign = join(root, 'pi-acceptance-Other1');
    const linked = join(root, 'pi-acceptance-Links1');
    const empty = join(root, 'pi-acceptance-Empty1');
    const remnant = join(root, 'pi-acceptance-Old001');
    const foreignRemnant = join(root, 'pi-acceptance-Other2');
    for (const directory of [remnant, foreignRemnant]) {
      const blob = Buffer.from('blob 13\0# Acceptance\n');
      const blobHash = createHash('sha1').update(blob).digest();
      const treeBody = Buffer.concat([Buffer.from('100644 README.md\0'), blobHash]);
      const tree = Buffer.concat([Buffer.from('tree ' + treeBody.length + '\0'), treeBody]);
      const treeHash = createHash('sha1').update(tree).digest('hex');
      const author = directory === remnant ? 'Acceptance Test <test@example.invalid>' : 'Actual User <user@example.invalid>';
      const commitBody = Buffer.from('tree ' + treeHash + '\nauthor ' + author + ' 1790375670 +0800\ncommitter ' + author + ' 1790375670 +0800\n\ninitial\n');
      const commit = Buffer.concat([Buffer.from('commit ' + commitBody.length + '\0'), commitBody]);
      for (const object of [blob, tree, commit]) {
        const hash = createHash('sha1').update(object).digest('hex');
        const prefix = join(directory, 'project/.git/objects', hash.slice(0, 2));
        await mkdir(prefix, { recursive: true });
        await writeFile(join(prefix, hash.slice(2)), deflateSync(object));
      }
    }
    await mkdir(join(empty, 'Cache', 'empty'), { recursive: true });
    for (const directory of [owned, foreign, linked]) {
      const project = join(directory, 'project');
      await mkdir(join(project, '.git'), { recursive: true });
      await mkdir(join(directory, 'home'));
      await writeFile(join(project, '.git/config'), '[user]\n name = Acceptance Test\n email = test@example.invalid\n');
      await writeFile(join(directory, 'desktop.json'), JSON.stringify({ projects: [{ path: directory === foreign ? external : project }] }));
      await writeFile(join(directory, 'cache.bin'), Buffer.alloc(1024));
    }
    await symlink(external, join(linked, 'external'), 'junction');
    const script = fileURLToPath(new URL('../scripts/cleanup-acceptance-temp.ps1', import.meta.url));
    const args = ['-NoProfile', '-File', script, '-TempRoot', root, '-MinimumAgeMinutes', '0'];
    const preview = JSON.parse(execFileSync('pwsh', args, { encoding: 'utf8' }));
    assert.equal(preview.applied, false);
    assert.equal(preview.eligible, 3);
    assert.equal(preview.skipped, 3);
    await access(owned);
    const result = JSON.parse(execFileSync('pwsh', [...args, '-Apply'], { encoding: 'utf8' }));
    assert.equal(result.removed, 3);
    assert.equal(result.skipped, 3);
    await assert.rejects(access(owned), { code: 'ENOENT' });
    await assert.rejects(access(empty), { code: 'ENOENT' });
    await assert.rejects(access(remnant), { code: 'ENOENT' });
    await access(foreignRemnant);
    await access(foreign);
    await access(linked);
    assert.equal(await readFile(join(external, 'keep.txt'), 'utf8'), 'USER DATA');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});
