import { mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { GitCommitResult } from '../shared/git-results.ts';
import { gitRun } from './git.ts';

async function currentHead(cwd: string, signal?: AbortSignal): Promise<string> {
  return gitRun(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'], signal).then(value => value.trim(), error => {
    if (error.code === 1) return ''; throw error;
  });
}
async function currentReference(cwd: string, signal?: AbortSignal): Promise<string> {
  return gitRun(cwd, ['symbolic-ref', '-q', 'HEAD'], signal).then(value => value.trim(), error => {
    if (error.code === 1) return ''; throw error;
  });
}

/** Publish only our selected-index reconciliation, never overwrite concurrent staging. */
async function reconcileIndex(cwd: string, indexPath: string, baseline: Buffer, result: GitCommitResult, reference: string, paths: string[], directory: string): Promise<void> {
  const lock = indexPath + '.lock';
  let owned = false;
  try {
    const handle = await open(lock, 'wx'); owned = true;
    try {
      if (!(await readFile(indexPath)).equals(baseline)) { result.warnings.push({ code: 'index-changed' }); return; }
      if (await currentHead(cwd) !== result.id || await currentReference(cwd) !== reference) { result.warnings.push({ code: 'head-changed' }); return; }
      await handle.writeFile(baseline);
    } finally { await handle.close(); }
    // Finishing an already recorded commit is not cancelled by its old signal.
    // Reconciliation operates on a copy, without invoking user hooks a second time.
    await gitRun(cwd, ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=' + join(directory, 'no-hooks'), 'reset', '-q', result.id, '--', ...paths], undefined, { ...process.env, GIT_INDEX_FILE: lock });
    if (!(await readFile(indexPath)).equals(baseline)) { result.warnings.push({ code: 'index-changed' }); return; }
    if (await currentHead(cwd) !== result.id || await currentReference(cwd) !== reference) { result.warnings.push({ code: 'head-changed' }); return; }
    await rename(lock, indexPath); owned = false;
  } catch (error) {
    result.warnings.push({ code: 'index-failed', detail: error instanceof Error ? error.message : String(error) });
  } finally {
    if (owned) {
      try { await rm(lock, { force: true }); await rm(lock + '.lock', { force: true }); }
      catch (error) { result.warnings.push({ code: 'cleanup-failed', detail: error instanceof Error ? error.message : String(error) }); }
    }
  }
}

export async function commitSelected(cwd: string, paths: string[], message: string, signal: AbortSignal): Promise<GitCommitResult> {
  const run = (args: string[]) => gitRun(cwd, args, signal);
  const staged = (await run(['diff', '--cached', '--relative', '--name-only', '-z'])).split('\0').filter(Boolean);
  if (paths.some(path => !staged.includes(path.replace(/\\/g, '/')))) throw new Error('所选文件已不在暂存区，请刷新后重试');
  const directory = await mkdtemp(join(tmpdir(), 'pi-commit-'));
  let completed: GitCommitResult | undefined;
  try {
    const marker = 'pi-desktop-' + crypto.randomUUID();
    const env = { ...process.env, GIT_INDEX_FILE: join(directory, 'index'), GIT_REFLOG_ACTION: marker };
    const temporary = (args: string[]) => gitRun(cwd, args, signal, env);
    const before = await currentHead(cwd, signal), reference = await currentReference(cwd, signal);
    const indexPath = resolve(cwd, (await run(['rev-parse', '--git-path', 'index'])).trim());
    const baseline = await readFile(indexPath);
    await temporary(before ? ['read-tree', before] : ['read-tree', '--empty']);
    const patch = await run(['diff', '--cached', '--binary', '--no-ext-diff', '--', ...paths]);
    if (!patch.trim()) throw new Error('所选文件没有暂存改动');
    const patchFile = join(directory, 'selected.patch'); await writeFile(patchFile, patch);
    await temporary(['apply', '--cached', '--binary', '--', patchFile]);
    if (!(await readFile(indexPath)).equals(baseline) || await currentHead(cwd, signal) !== before || await currentReference(cwd, signal) !== reference) throw new Error('提交准备期间仓库发生变化，请刷新后重试');
    let output = '', failure: unknown;
    try { output = await temporary(['-c', 'core.logAllRefUpdates=always', 'commit', '-m', message]); }
    catch (error) { failure = error; }
    // A unique reflog marker distinguishes this invocation from outside commits.
    // Never infer success merely because HEAD moved while a hook was running.
    let id: string;
    try { id = (await gitRun(cwd, ['reflog', 'show', '-1', '--format=%H', '--fixed-strings', '--grep-reflog=' + marker, 'HEAD'])).trim(); }
    catch (error) {
      if (failure && await currentHead(cwd) === before) throw failure;
      throw new Error('提交结果暂时无法确认，请核对提交历史后再操作', { cause: error });
    }
    if (!/^[a-f0-9]{40,64}$/.test(id)) {
      if (failure && await currentHead(cwd) === before) throw failure;
      throw new Error('提交结果暂时无法确认，请核对提交历史后再操作', { cause: failure });
    }
    completed = { kind: 'git-commit', id, output, interrupted: !!failure, warnings: [] };
    await reconcileIndex(cwd, indexPath, baseline, completed, reference, paths, directory);
    return completed;
  } finally {
    try { await rm(directory, { recursive: true, force: true }); }
    catch (error) {
      if (!completed) throw error;
      completed.warnings.push({ code: 'cleanup-failed', detail: error instanceof Error ? error.message : String(error) });
    }
  }
}
