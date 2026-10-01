import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { reviewFileSchema, type ReviewFile, type ReviewRun } from '../shared/reviews.ts';
import { GitService, gitRun, readOnlyGitConfiguration } from './git.ts';
import { safeProjectPath } from './policy.ts';

const snapshotSchema = z.object({ files: z.array(reviewFileSchema.extend({ content: z.string() })), diff: z.string() }).strict();
export async function readCapturedReviewFile(storage: string, id: string, path: string): Promise<z.infer<typeof snapshotSchema>['files'][number]> {
  const snapshot = snapshotSchema.parse(JSON.parse(await readFile(join(storage, 'reviews', z.uuid().parse(id), 'snapshot.json'), 'utf8')));
  const file = snapshot.files.find(file => file.path === path);
  if (!file) throw new Error('文件不属于此审查范围');
  return file;
}
export function reviewVersion(content: string): string {
  return createHash('sha256').update(content.replaceAll('\r\n', '\n')).digest('hex');
}
export async function currentReviewVersion(cwd: string, path: string): Promise<string> {
  const absolute = await safeProjectPath(cwd, path);
  return readFile(absolute).then(bytes => reviewVersion(bytes.toString('utf8')), error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  });
}
export class ReviewSnapshots {
  constructor(private readonly git: GitService, private readonly storage: string) {}
  private location(id: string): string {
    return join(this.storage, 'reviews', z.uuid().parse(id), 'snapshot.json');
  }
  async remove(id: string): Promise<void> {
    const path = this.location(id);
    await rm(join(path, '..'), { recursive: true, force: true });
  }
  async capture(cwd: string, id: string, scope: ReviewRun['scope'], ref: string, signal: AbortSignal): Promise<{ base: string; target: string; files: ReviewFile[]; diff: string }> {
    const configuration = await readOnlyGitConfiguration(cwd, signal);
    const run = (args: string[]) => gitRun(cwd, [...configuration, ...args], signal, { ...process.env, GIT_OPTIONAL_LOCKS: '0' });
    const resolve = async (name: string) => {
      if (!name.trim() || name.startsWith('-') || /[\r\n\0]/.test(name)) throw new Error('请选择有效的分支或提交');
      return (await run(['rev-parse', '--verify', '--end-of-options', name + '^{commit}'])).trim();
    };
    const head = await resolve('HEAD').catch(() => '');
    let base = head;
    let target = '';
    if (scope === 'branch') {
      if (!head) throw new Error('仓库尚无提交');
      target = head;
      base = (await run(['merge-base', await resolve(ref), head])).trim();
    } else if (scope === 'commit') {
      target = await resolve(ref);
      base = (await run(['rev-list', '--parents', '-n', '1', target])).trim().split(' ')[1] ?? '';
    }
    const args = scope === 'uncommitted' ? ['diff', ...(head ? [head] : ['--cached'])] : base ? ['diff', base, target] : ['diff-tree', '--root', '--no-commit-id', '-r', target];
    const diffArgs = [...args, '--relative', '--no-renames', '--no-ext-diff', '--no-textconv'];
    const untracked = scope === 'uncommitted' ? (await run(['ls-files', '--others', '--exclude-standard', '-z', '--', '.'])).split('\0').filter(Boolean) : [];
    const paths = [...new Set([...(await run([...args, '--relative', '--no-renames', '--name-only', '-z', '--', '.'])).split('\0').filter(Boolean), ...untracked])];
    if (!paths.length) throw new Error('所选范围没有可审查的改动');
    if (paths.length > 300) throw new Error('审查范围超过 300 个文件，请选择较小的提交范围');
    const diff = async () => {
      let text = await run([...diffArgs, '-p', '--', '.']);
      if (scope === 'uncommitted' && !head) text += await run(['diff', '--relative', '--no-ext-diff', '--no-textconv', '--', '.']);
      for (const path of untracked) {
        signal.throwIfAborted();
        text += await this.git.untrackedDiff(cwd, path, configuration, signal);
      }
      if (text.length > 2000000) throw new Error('审查差异超过 2 MB，请缩小范围');
      return text;
    };
    const initialDiff = await diff();
    const prefix = (await run(['rev-parse', '--show-prefix'])).replace(/\r?\n$/, '');
    const files: z.infer<typeof snapshotSchema>['files'] = [];
    let total = 0;
    for (const path of paths) {
      signal.throwIfAborted();
      await safeProjectPath(cwd, path);
      const blob = async (revision: string) => {
        const object = await run(['rev-parse', '--verify', '--end-of-options', revision + ':' + prefix + path]).then(value => value.trim(), () => '');
        return object ? run(['cat-file', 'blob', object]) : null;
      };
      const current = target ? await blob(target) : await readFile(await safeProjectPath(cwd, path)).then(bytes => bytes.toString('utf8'), error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      const deleted = current === null;
      const content = current ?? (base ? await blob(base) : null) ?? '';
      const binary = content.includes('\0') || content.includes('\ufffd');
      total += content.length;
      if (total > 10000000) throw new Error('审查快照超过 10 MB，请缩小范围');
      files.push({ path, deleted, binary, version: deleted ? 'missing' : reviewVersion(content),
        lines: binary ? 0 : content ? content.replace(/\r\n/g, '\n').split('\n').length : 0, content: binary ? '' : content });
    }
    if (scope === 'uncommitted' && (initialDiff !== await diff() || (await Promise.all(files.map(async file => await currentReviewVersion(cwd, file.path) !== file.version))).some(Boolean)))
      throw new Error('捕获期间文件发生变化，请重试审查');
    signal.throwIfAborted();
    const path = this.location(id);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify({ files, diff: initialDiff }), { encoding: 'utf8', flag: 'wx' });
    return { base, target, files: files.map(({ content: _content, ...file }) => file), diff: initialDiff };
  }
  async file(id: string, path: string): Promise<z.infer<typeof snapshotSchema>['files'][number]> {
    return readCapturedReviewFile(this.storage, id, path);
  }
  async inspect(cwd: string, files: ReviewFile[]): Promise<Array<ReviewFile & { stale: boolean }>> {
    return Promise.all(files.map(async file => ({ ...file, stale: await currentReviewVersion(cwd, file.path).then(version => version !== file.version, () => true) })));
  }
}
