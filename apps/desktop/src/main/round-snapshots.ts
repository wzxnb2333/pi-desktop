import { lstat, mkdir, readlink, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { GitRange, RoundSnapshot } from '../shared/git-ranges.ts';
import { gitRun } from './git.ts';
import { gitProcess } from './git-process.ts';
import { safeProjectPath } from './policy.ts';

/** Dedicated index AND object database. Never stage, commit, filter or attribute other programs' edits to Pi. */
export class RoundSnapshots {
  private readonly preparations = new Map<string, { ino: bigint; dev: bigint }>();
  constructor(private readonly storage: string) {}
  private directory(threadId: string): string {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(threadId)) throw new Error('任务存储标识无效');
    return join(this.storage, 'round-snapshots', threadId);
  }
  private async environment(threadId: string, cwd: string, signal?: AbortSignal): Promise<NodeJS.ProcessEnv> {
    signal?.throwIfAborted();
    const directory = this.directory(threadId);
    await mkdir(join(directory, 'objects'), { recursive: true });
    const common = resolve(cwd, (await gitRun(cwd, ['rev-parse', '--git-common-dir'], signal)).trim());
    return { ...process.env, GIT_INDEX_FILE: join(directory, 'index-' + crypto.randomUUID()), GIT_OBJECT_DIRECTORY: join(directory, 'objects'), GIT_ALTERNATE_OBJECT_DIRECTORIES: join(common, 'objects'), GIT_OPTIONAL_LOCKS: '0' };
  }
  private async input(cwd: string, env: NodeJS.ProcessEnv, args: string[], input: Buffer | string, signal?: AbortSignal): Promise<string> {
    return gitProcess(cwd, ['-c', 'core.fsmonitor=false', ...args], { env, input, signal });
  }
  private async capture(threadId: string, cwd: string, signal?: AbortSignal, trackingIndex?: string): Promise<string> {
    const env = await this.environment(threadId, cwd, signal);
    const trackingEnv = trackingIndex ? { ...process.env, GIT_INDEX_FILE: trackingIndex, GIT_OPTIONAL_LOCKS: '0' } : undefined;
    const run = (args: string[]) => gitRun(cwd, ['-c', 'core.fsmonitor=false', ...args], signal, env);
    try {
      const tracked = (await gitRun(cwd, ['-c', 'core.fsmonitor=false', 'ls-files', '--stage', '-z', '--', '.'], signal, trackingEnv)).split('\0').filter(Boolean);
      const entries = new Map<string, string>();
      for (const record of tracked) {
        const match = /^(\d+) [0-9a-f]+ (\d)\t([\s\S]+)$/.exec(record);
        if (!match || match[2] !== '0') throw new Error('存在未解决冲突，无法捕获轮次快照');
        entries.set(match[3], match[1]);
      }
      for (const path of (await gitRun(cwd, ['-c', 'core.fsmonitor=false', 'ls-files', '--others', '--exclude-standard', '-z', '--', '.'], signal, trackingEnv)).split('\0').filter(Boolean)) entries.set(path, '100644');
      if (entries.size > 20000) throw new Error('轮次快照超过 20000 个文件，请调整项目忽略规则');
      await run(['read-tree', '--empty']);
      const prefix = (await run(['rev-parse', '--show-prefix'])).replace(/\r?\n$/, '');
      const index: string[] = []; let bytes = 0;
      const files: Array<{ absolute: string; path: string; mode: string; mtimeMs: number; size: number }> = [];
      for (const [path, mode] of entries) {
        signal?.throwIfAborted();
        const absolute = await safeProjectPath(cwd, path);
        const metadata = await lstat(absolute).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
        if (!metadata) continue;
        if (mode === '160000') {
          const commit = (await gitRun(absolute, ['rev-parse', '--verify', 'HEAD'], signal)).trim();
          index.push('160000 ' + commit + '\t' + prefix + path + '\0'); continue;
        }
        if (!metadata.isFile() && !metadata.isSymbolicLink()) throw new Error('轮次快照遇到不支持的文件类型');
        bytes += metadata.size;
        if (metadata.size > 50 * 1024 * 1024 || bytes > 200 * 1024 * 1024) throw new Error('轮次快照超过容量限制，请调整项目忽略规则');
        if (metadata.isSymbolicLink()) {
          const hash = (await this.input(cwd, env, ['hash-object', '-w', '--no-filters', '--stdin'], Buffer.from(await readlink(absolute)), signal)).trim();
          index.push('120000 ' + hash + '\t' + prefix + path + '\0');
        } else files.push({ absolute, path, mode, mtimeMs: metadata.mtimeMs, size: metadata.size });
      }
      if (files.length) {
        // Paths are Git's quoted stdin protocol, not a shell command. One process hashes the batch.
        const hashes = (await this.input(cwd, env, ['hash-object', '-w', '--no-filters', '--stdin-paths'], files.map(file => JSON.stringify(file.absolute)).join('\n') + '\n', signal)).trim().split(/\r?\n/);
        if (hashes.length !== files.length) throw new Error('轮次快照返回了不完整的文件清单');
        for (let indexOfFile = 0; indexOfFile < files.length; indexOfFile++) {
          const file = files[indexOfFile]; const after = await lstat(file.absolute);
          if (after.mtimeMs !== file.mtimeMs || after.size !== file.size) throw new Error('捕获轮次快照时文件发生变化，请重试');
          index.push(file.mode + ' ' + hashes[indexOfFile] + '\t' + prefix + file.path + '\0');
        }
      }
      await this.input(cwd, env, ['update-index', '-z', '--index-info'], index.join(''), signal);
      return (await run(['write-tree'])).trim();
    } finally {
      // Exact, generated application-owned paths only; failures surface to the snapshot record.
      await rm(env.GIT_INDEX_FILE!, { force: true }); await rm(env.GIT_INDEX_FILE! + '.lock', { force: true });
    }
  }
  async begin(threadId: string, cwd: string): Promise<RoundSnapshot> {
    const startedAt = Date.now(); const path = await realpath(cwd);
    return { id: crypto.randomUUID(), threadId, cwd: path, startedAt, before: await this.capture(threadId, path), state: 'running' };
  }
  async captureTree(threadId: string, cwd: string, signal?: AbortSignal, trackingIndex?: string): Promise<string> { return this.capture(threadId, cwd, signal, trackingIndex); }
  async prepareUncommitted(threadId: string): Promise<void> {
    this.preparations.delete(threadId);
    await mkdir(join(this.storage, 'round-snapshots'), { recursive: true });
    const path = await safeProjectPath(this.storage, this.directory(threadId));
    try { await mkdir(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return; throw error; }
    const identity = await lstat(path, { bigint: true });
    this.preparations.set(threadId, { ino: identity.ino, dev: identity.dev });
  }
  releasePreparation(threadId: string): void { this.preparations.delete(threadId); }
  /** Only a directory created by this never-published attempt can be reclaimed. */
  async discardUncommitted(threadId: string): Promise<void> {
    const owned = this.preparations.get(threadId); if (!owned) return;
    const path = await safeProjectPath(this.storage, this.directory(threadId));
    const identity = await lstat(path, { bigint: true }).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; });
    if (!identity) { this.preparations.delete(threadId); return; }
    if (!identity.isDirectory() || identity.isSymbolicLink() || identity.ino !== owned.ino || identity.dev !== owned.dev) throw new Error('快照准备目录已变化，原数据已保留。');
    await rm(path, { recursive: true, force: true });
    this.preparations.delete(threadId);
  }
  async manifest(threadId: string, cwd: string, tree: string, signal?: AbortSignal): Promise<Map<string, { hash: string; mode: string }>> {
    if (!/^[0-9a-f]{40,64}$/.test(tree)) throw new Error('工作区快照引用无效');
    const env = await this.environment(threadId, cwd, signal);
    const prefix = (await gitRun(cwd, ['rev-parse', '--show-prefix'], signal)).replace(/\r?\n$/, '');
    const raw = await gitRun(cwd, ['ls-tree', '--full-tree', '-r', '-z', tree, '--', prefix || '.'], signal, env);
    const files = new Map<string, { hash: string; mode: string }>();
    for (const entry of raw.split('\0').filter(Boolean)) {
      const match = /^(\d+) (blob|commit) ([0-9a-f]+)\t([\s\S]+)$/.exec(entry);
      if (!match || !['100644', '100755'].includes(match[1]) || !match[4].startsWith(prefix)) throw new Error('此工作区包含无法安全迁移的链接或子模块');
      files.set(match[4].slice(prefix.length), { hash: match[3], mode: match[1] });
    }
    return files;
  }
  async blob(threadId: string, cwd: string, hash: string, signal?: AbortSignal): Promise<Buffer> {
    if (!/^[0-9a-f]{40,64}$/.test(hash)) throw new Error('工作区快照引用无效');
    const env = await this.environment(threadId, cwd, signal);
    return gitProcess(cwd, ['cat-file', 'blob', hash], { env, signal, encoding: 'buffer', maxBuffer: 51 * 1024 * 1024 });
  }
  async end(snapshot: RoundSnapshot): Promise<void> {
    try { snapshot.after = await this.capture(snapshot.threadId, snapshot.cwd); snapshot.state = 'complete'; }
    catch (error) { snapshot.state = 'error'; snapshot.error = error instanceof Error ? error.message : String(error); }
    snapshot.completedAt = Date.now();
  }
  async diff(snapshot: RoundSnapshot, path = ''): Promise<GitRange> {
    if (snapshot.state !== 'complete' || !snapshot.after) throw new Error(snapshot.error || '轮次尚未结束，快照暂不可用');
    const env = await this.environment(snapshot.threadId, snapshot.cwd);
    return this.compare(snapshot.cwd, snapshot.before, snapshot.after, path, env).then(result => ({ ...result, attribution: 'workspace', startedAt: snapshot.startedAt, completedAt: snapshot.completedAt }));
  }
  async branch(cwd: string, reference: string, path = ''): Promise<GitRange> {
    if (!reference || reference.startsWith('-') || /[\r\n\0]/.test(reference)) throw new Error('请选择有效的分支或提交');
    const referenceId = (await gitRun(cwd, ['rev-parse', '--verify', '--end-of-options', reference + '^{commit}'])).trim();
    const head = (await gitRun(cwd, ['rev-parse', '--verify', 'HEAD'])).trim();
    const base = (await gitRun(cwd, ['merge-base', referenceId, head])).trim();
    return this.compare(cwd, base, head, path);
  }
  private async compare(cwd: string, base: string, target: string, path: string, env?: NodeJS.ProcessEnv): Promise<GitRange> {
    if (path) await safeProjectPath(cwd, path);
    const args = ['diff', '--relative', '--no-ext-diff', '--no-textconv', '--no-renames', base, target];
    const names = (await gitRun(cwd, [...args, '--name-status', '-z', '--', '.'], undefined, env)).split('\0').filter(Boolean);
    const files: GitRange['files'] = [];
    for (let index = 0; index + 1 < names.length; index += 2) files.push({ status: names[index], path: names[index + 1], staged: false });
    const diff = await gitRun(cwd, [...args, '--', path || '.'], undefined, env);
    return { files, diff, base, target, attribution: 'branch' };
  }
}
