import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { diffHunks, reverseTextHunk } from '../shared/git-patches.ts';
import { GitService, gitRun } from './git.ts';
import { safeProjectPath } from './policy.ts';
import { hunkRecoverySchema as recoverySchema, type HunkRecoveryListing, type HunkRecoveryRecord, type HunkRecoveryView } from '../shared/git-ranges.ts';

export class HunkRecovery {
  constructor(private readonly git: GitService, private readonly storage: string) {}
  private location(id: string): string { return join(this.storage, 'recovery', 'hunks', z.uuid().parse(id)); }
  private version(bytes: Buffer | null): string { return bytes === null ? 'missing' : createHash('sha256').update(bytes).digest('hex'); }
  private async record(id: string): Promise<HunkRecoveryRecord> {
    const record = recoverySchema.parse(JSON.parse(await readFile(join(this.location(id), 'record.json'), 'utf8')));
    if (record.id !== id) throw new Error('恢复记录标识不匹配，未改动文件');
    return record;
  }
  private async save(record: HunkRecoveryRecord): Promise<void> {
    const target = join(this.location(record.id), 'record.json');
    // A failed write/rename leaves the last complete journal intact. The fixed
    // candidate is safely replaced on retry, including after application exit.
    await fs.writeFile(target + '.tmp', JSON.stringify(record), { mode: 0o600 });
    await fs.rename(target + '.tmp', target);
  }
  private async original(record: HunkRecoveryRecord): Promise<Buffer | null> {
    const bytes = record.originalVersion === 'missing' ? null : await readFile(join(this.location(record.id), 'original'));
    if (this.version(bytes) !== record.originalVersion) throw new Error('恢复副本校验失败，原文件未改动');
    return bytes;
  }
  private async read(cwd: string, path: string): Promise<Buffer | null> {
    const absolute = await safeProjectPath(cwd, path);
    if ((await stat(absolute).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }))?.size! > 10 * 1024 * 1024)
      throw new Error('文件超过 10 MB，请在外部编辑器中打开');
    return readFile(absolute).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
  }
  async currentVersion(cwd: string, path: string): Promise<string> { return this.version(await this.read(cwd, path)); }
  private async replace(cwd: string, path: string, bytes: Buffer | null, expected: string): Promise<void> {
    const absolute = await safeProjectPath(cwd, path);
    const current = await this.read(cwd, path);
    if (this.version(current) !== expected) throw new Error('文件已被其他程序修改，未覆盖当前版本');
    if (bytes === null) { await unlink(absolute); return; }
    const temporary = absolute + '.pi-restore-' + crypto.randomUUID();
    try {
      await mkdir(join(absolute, '..'), { recursive: true });
      await writeFile(temporary, bytes, { flag: 'wx', mode: current ? (await stat(absolute)).mode : undefined });
      if (await this.currentVersion(cwd, path) !== expected) throw new Error('保存期间文件发生变化，未覆盖原文件');
      await rename(temporary, absolute);
    } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
  }
  async revert(cwd: string, path: string, patch: string, version: string, mode: 'all' | 'unstaged'): Promise<HunkRecoveryRecord> {
    const bytes = await this.read(cwd, path);
    if (this.version(bytes) !== version) throw new Error('文件已变化，请刷新差异后重试');
    const content = bytes === null ? '' : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (bytes?.includes(0)) throw new Error('此差异块需要使用文件级恢复');
    const current = mode === 'all' ? await this.git.diff(cwd, path) : await gitRun(cwd, ['diff', '--relative', '--no-ext-diff', '--no-textconv', '--', path]);
    if (!diffHunks(current).includes(patch)) throw new Error('差异已变化，请刷新后重试');
    const text = reverseTextHunk(content, patch);
    const reverted = /^new file mode /m.test(patch) && text === '' ? null : Buffer.from(text);
    const record: HunkRecoveryRecord = { id: crypto.randomUUID(), cwd: resolve(cwd), path, originalVersion: version, revertedVersion: this.version(reverted), createdAt: Date.now(), state: 'prepared' };
    const directory = this.location(record.id);
    const preparing = join(this.storage, 'recovery', 'hunks', '.pending-' + record.id);
    await mkdir(join(this.storage, 'recovery', 'hunks'), { recursive: true });
    await mkdir(preparing);
    try {
      if (bytes !== null) await writeFile(join(preparing, 'original'), bytes, { flag: 'wx' });
      await writeFile(join(preparing, 'record.json'), JSON.stringify(record), { flag: 'wx' });
      await rename(preparing, directory);
    } finally { await rm(preparing, { recursive: true, force: true }); }
    await this.replace(cwd, path, reverted, version);
    record.state = 'applied';
    try { await this.save(record); }
    catch (cause) { throw new Error('差异块已撤销，但记录状态保存失败；请刷新恢复记录。', { cause }); }
    return record;
  }
  async restore(cwd: string, id: string): Promise<void> {
    const record = await this.record(id);
    if (resolve(cwd).toLocaleLowerCase() !== record.cwd.toLocaleLowerCase()) throw new Error('恢复记录不属于此目录');
    if (record.state === 'restored') throw new Error('此恢复记录已经应用');
    const original = await this.original(record);
    const current = await this.currentVersion(cwd, record.path);
    if (record.state === 'restoring' && current === record.originalVersion) {
      await this.save({ ...record, state: 'restored' });
      return;
    }
    if (record.state === 'prepared' && current === record.originalVersion) throw new Error('此撤销尚未执行，无需恢复');
    if (current !== record.revertedVersion) throw new Error('文件已被其他程序修改，未覆盖当前版本');
    // Persist intent before changing the file. After interruption, hashes can
    // distinguish an unfinished restore from one that only missed its receipt.
    await this.save({ ...record, state: 'restoring' });
    await this.replace(cwd, record.path, original, record.revertedVersion);
    try { await this.save({ ...record, state: 'restored' }); }
    catch (cause) { throw new Error('文件已恢复，但记录状态保存失败；请刷新恢复记录。', { cause }); }
  }
  private async describe(record: HunkRecoveryRecord): Promise<HunkRecoveryView> {
    if (record.state === 'restored') return record;
    try {
      await this.original(record);
      const current = await this.currentVersion(record.cwd, record.path);
      if (current === record.originalVersion && record.state === 'prepared') return { ...record, state: 'unapplied' };
      if (current === record.originalVersion && record.state === 'restoring') return { ...record, state: 'restored', receiptPending: true };
      if (current !== record.revertedVersion) throw new Error('文件已被其他程序修改，未覆盖当前版本');
      return { ...record, state: 'applied' };
    } catch (error) { return { ...record, error: error instanceof Error ? error.message : String(error) }; }
  }
  async list(cwd: string, path?: string): Promise<HunkRecoveryListing> {
    const directory = join(this.storage, 'recovery', 'hunks');
    const names = await readdir(directory).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; });
    const result: HunkRecoveryListing = { records: [], errors: [] };
    for (const id of names) {
      if (!z.uuid().safeParse(id).success) continue;
      try {
        const record = await this.record(id);
        if (record.cwd.toLocaleLowerCase() === resolve(cwd).toLocaleLowerCase() && (!path || record.path === path)) result.records.push(await this.describe(record));
      } catch (error) { result.errors.push({ id, message: error instanceof Error ? error.message : String(error) }); }
    }
    result.records.sort((a, b) => b.createdAt - a.createdAt);
    return result;
  }
}
