import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { voiceModel, voiceModelUrl, VOICE_MODELS } from '../shared/voice-models.ts';
import type { VoiceModelId, VoiceModelState } from '../shared/voice.ts';

const manifestSchema = z.object({ application: z.literal('Pi Desktop Voice'), digest: z.string(), files: z.array(z.object({ path: z.string(), size: z.number(), hash: z.string() }).strict()).max(20000) }).strict();
const ownerSchema = z.object({ application: z.literal('Pi Desktop Voice staging'), pid: z.number().int().positive() }).strict();
const manifestFile = '.pi-voice-model.json';
async function hashFile(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(path, { signal })) hash.update(chunk); return hash.digest('hex');
}
function childPath(root: string, path: string): string {
  if (!path || path.includes('\\') || path.includes(':') || path.split('/').some(part => part === '..') || isAbsolute(path)) throw new Error('模型路径无效');
  const target = resolve(root, path); if (relative(root, target).startsWith('..') || target === resolve(root)) throw new Error('模型路径无效'); return target;
}
async function filesIn(root: string, signal?: AbortSignal): Promise<{ path: string; size: number; hash: string }[]> {
  const result: { path: string; size: number; hash: string }[] = [];
  const walk = async (dir: string) => {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      signal?.throwIfAborted(); const path = join(dir, item.name), info = await lstat(path);
      if (info.isSymbolicLink() || !info.isFile() && !info.isDirectory() || info.isFile() && info.nlink > 1) throw new Error('模型目录不能包含链接或特殊文件');
      if (info.isDirectory()) await walk(path);
      else if (item.name !== manifestFile) result.push({ path: relative(root, path).replaceAll('\\', '/'), size: info.size, hash: await hashFile(path, signal) });
    }
  };
  await walk(root); return result;
}
async function tar(args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => execFile('tar', args, { windowsHide: true, signal, maxBuffer: 8000000 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
}

/** Only pinned archives are extracted; deletion is restricted to marked, app-owned model folders. */
export class VoiceModels {
  private readonly verified = new Map<VoiceModelId, string>();
  constructor(readonly root: string) {}
  async recover(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    for (const item of await readdir(this.root, { withFileTypes: true })) if (item.isDirectory() && /^\.pi-voice-stage-[0-9a-f-]{36}$/.test(item.name)) {
      const path = childPath(this.root, item.name);
      let owner: z.infer<typeof ownerSchema>;
      try { owner = ownerSchema.parse(JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'))); } catch { continue; }
      try { process.kill(owner.pid, 0); continue; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue; }
      if ((await lstat(path)).isSymbolicLink()) continue;
      await rm(path, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
    }
  }
  async inspect(id: VoiceModelId): Promise<VoiceModelState> {
    const asset = voiceModel(id), target = childPath(this.root, asset.folder);
    try {
      const info = await lstat(target); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('模型目录无效');
      const manifest = manifestSchema.parse(JSON.parse(await readFile(join(target, manifestFile), 'utf8')));
      if (manifest.digest !== asset.sha256) throw new Error('模型版本不匹配');
      for (const path of asset.required) await access(childPath(target, path));
      return { id, status: 'installed', bytes: manifest.files.reduce((sum, item) => sum + item.size, 0) };
    } catch (error) {
      let exists = true; try { await lstat(target); } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') exists = false; }
      return { id, status: exists ? 'corrupt' : 'missing', bytes: 0, ...(exists ? { error: error instanceof Error ? error.message : String(error) } : {}) };
    }
  }
  async list(): Promise<VoiceModelState[]> { return Promise.all(VOICE_MODELS.map(asset => this.inspect(asset.id))); }
  async verify(id: VoiceModelId, signal: AbortSignal, fresh = false): Promise<void> {
    const asset = voiceModel(id), target = childPath(this.root, asset.folder);
    const manifest = manifestSchema.parse(JSON.parse(await readFile(join(target, manifestFile), 'utf8')));
    if ((await lstat(target)).isSymbolicLink() || manifest.digest !== asset.sha256) throw new Error('模型校验失败，请重新安装');
    const fingerprint: string[] = [];
    for (const file of manifest.files) {
      const path = childPath(target, file.path), info = await lstat(path); signal.throwIfAborted();
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.size) throw new Error('模型校验失败，请重新安装');
      fingerprint.push(file.path + ':' + info.size + ':' + info.mtimeMs + ':' + file.hash);
    }
    const key = fingerprint.join('|'); if (!fresh && this.verified.get(id) === key) return;
    for (const file of manifest.files) if (await hashFile(childPath(target, file.path), signal) !== file.hash) throw new Error('模型校验失败，请重新安装');
    for (const path of asset.required) await access(childPath(target, path));
    this.verified.set(id, key);
  }
  async install(id: VoiceModelId, archive: string | undefined, signal: AbortSignal, progress: (stage: string, fraction?: number) => void): Promise<void> {
    await this.recover(); const asset = voiceModel(id), target = childPath(this.root, asset.folder);
    try { await access(target); throw new Error('此模型目录已存在，请先卸载后安装'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const stage = childPath(this.root, '.pi-voice-stage-' + crypto.randomUUID()); await mkdir(stage);
    await writeFile(join(stage, 'owner.json'), JSON.stringify({ application: 'Pi Desktop Voice staging', pid: process.pid }));
    try {
      let source = archive;
      if (!source) {
        progress('正在下载离线模型', 0); source = join(stage, asset.filename);
        const response = await fetch(voiceModelUrl(asset), { signal }); if (!response.ok || !response.body) throw new Error('模型下载失败，请重试或导入固定版本');
        const file = await open(source, 'wx'); let bytes = 0;
        const reader = response.body.getReader();
        try { while (true) { const { value: chunk, done } = await reader.read(); if (done) break; signal.throwIfAborted(); bytes += chunk.byteLength; if (bytes > asset.bytes) throw new Error('模型下载体积不匹配'); let offset = 0; while (offset < chunk.byteLength) { const result = await file.write(chunk.subarray(offset)); if (!result.bytesWritten) throw new Error('模型下载未完成'); offset += result.bytesWritten; } progress('正在下载离线模型', bytes / asset.bytes); } }
        catch (error) { await reader.cancel().catch(() => {}); throw error; }
        finally { await file.close(); }
        if (bytes !== asset.bytes) throw new Error('模型下载未完成');
      }
      signal.throwIfAborted(); progress('正在校验离线模型');
      if ((await stat(source)).size !== asset.bytes || await hashFile(source, signal) !== asset.sha256) throw new Error('模型校验失败，请选择指定版本的原始模型包');
      const extracted = join(stage, asset.folder);
      if (asset.filename.endsWith('.onnx')) { await mkdir(extracted); await copyFile(source, join(extracted, asset.filename)); }
      else {
        progress('正在解压离线模型'); const entries = (await tar(['-tf', source], signal)).split(/\r?\n/).filter(Boolean);
        for (const entry of entries) { childPath(stage, entry); if (entry !== asset.folder + '/' && !entry.startsWith(asset.folder + '/')) throw new Error('模型包包含无效路径'); }
        await tar(['-xf', source, '-C', stage], signal);
      }
      signal.throwIfAborted(); progress('正在验证模型文件');
      const files = await filesIn(extracted, signal); for (const path of asset.required) await access(childPath(extracted, path));
      await writeFile(join(extracted, manifestFile), JSON.stringify({ application: 'Pi Desktop Voice', digest: asset.sha256, files }));
      signal.throwIfAborted(); await rename(extracted, target); this.verified.delete(id); progress('离线模型已安装', 1);
    } finally { await rm(stage, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 }); }
  }
  async remove(id: VoiceModelId): Promise<void> {
    const asset = voiceModel(id), target = childPath(this.root, asset.folder);
    const canonicalRoot = await realpath(this.root), canonicalTarget = await realpath(target);
    if (canonicalTarget !== join(canonicalRoot, asset.folder) || (await lstat(target)).isSymbolicLink()) throw new Error('模型路径无效');
    const manifest = manifestSchema.parse(JSON.parse(await readFile(join(target, manifestFile), 'utf8')));
    if (manifest.digest !== asset.sha256) throw new Error('模型归属无法确认，未删除目录');
    const expected = new Set(manifest.files.map(item => item.path));
    const actual = await filesIn(target); if (actual.some(file => !expected.has(file.path))) throw new Error('模型目录包含额外文件，请先移出后卸载');
    await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 }); this.verified.delete(id);
  }
}
