import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ManagedWorktree } from '../../src/shared/worktrees.ts';
import { GitService, gitRun } from '../../src/main/git.ts';
import { RoundSnapshots } from '../../src/main/round-snapshots.ts';
import { WorktreeArchives } from '../../src/main/worktree-archives.ts';
import { mkdtemp } from './node-temp.ts';

export async function archiveFixture() {
  const root = await mkdtemp(join(tmpdir(), 'pi-archive-')); const repository = join(root, 'repository'); const storage = join(root, 'storage');
  await mkdir(repository); await mkdir(storage); await mkdir(join(repository, 'nested'));
  await gitRun(repository, ['init', '-b', 'main']); await gitRun(repository, ['config', 'core.autocrlf', 'false']);
  await gitRun(repository, ['config', 'user.name', 'Test']); await gitRun(repository, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(repository, '.gitignore'), 'ignored/\n'); await writeFile(join(repository, 'nested/a.txt'), 'base\r\n');
  await writeFile(join(repository, 'outside.txt'), 'outside');
  await gitRun(repository, ['add', '--', '.']); await gitRun(repository, ['commit', '-m', 'base']);
  const snapshots = new RoundSnapshots(storage); const git = new GitService(storage);
  const worktree = await git.createWorktree(join(repository, 'nested'), crypto.randomUUID());
  const baseline = await snapshots.captureTree('owner', worktree.path);
  const record: ManagedWorktree = { id: crypto.randomUUID(), threadId: 'owner', projectId: 'project', directoryId: 'dir', ...worktree,
    localPath: join(repository, 'nested'), localBaseline: baseline, worktreeBaseline: baseline, createdAt: Date.now(), lastUsedAt: Date.now(), status: 'ready' };
  let persisted = structuredClone(record); let saves = 0;
  const save = async () => { saves++; persisted = structuredClone(record); };
  const archives = new WorktreeArchives(storage, snapshots, save);
  return { record, storage, repository, snapshots, archives, saved: () => persisted, saves: () => saves };
}
