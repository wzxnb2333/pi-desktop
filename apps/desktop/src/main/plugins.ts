import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadSkills } from '@earendil-works/pi-coding-agent';
import type { McpConfig, Settings } from '../shared/contracts.ts';
import { type Plugin, type PluginManifest, type PluginRevision, type PluginSource, pluginManifestSchema, pluginPathSchema, resolvePluginMcpServer } from '../shared/plugins.ts';
import { validateMcpConfiguration } from '../shared/mcp-configuration.ts';
import { unpackPluginZip } from './plugin-zip.ts';

type Progress = (stage: string) => void;
// Keep credentials for approved, temporarily disabled plugins, but never for unapproved candidates.
export function pluginMcpConfigurations(records: Plugin[], activeOnly = false): McpConfig[] {
  return records.filter(record => record.current.approved && (!activeOnly || record.enabled)).flatMap(record =>
    record.current.manifest.mcp.map(server => ({ ...server, id: 'plugin:' + record.id + ':' + server.id })));
}
export class Plugins {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly storage: string, private readonly records: () => Plugin[], private readonly save: (next: Plugin[], signal?: AbortSignal) => Promise<void>) {}
  private root(id: string): string { return join(this.storage, 'plugins', createHash('sha256').update(id).digest('hex')); }
  private revisionPath(id: string, revision: string): string { return join(this.root(id), revision, 'content'); }
  private async exclusive<T>(run: () => Promise<T>): Promise<T> {
    const task = this.queue.catch(() => {}).then(run); this.queue = task; return task;
  }
  private async files(directory: string, signal?: AbortSignal): Promise<Array<{ path: string; bytes: Buffer }>> {
    const output: Array<{ path: string; bytes: Buffer }> = []; const names = new Set<string>(); let size = 0; let entries = 0;
    const root = await realpath(directory);
    const walk = async (path: string, prefix: string) => {
      for (const name of (await readdir(path)).sort()) {
        signal?.throwIfAborted();
        if (name === '.git') continue;
        if (++entries > 5000) throw new Error('插件文件数量超过 5000');
        const key = prefix + name; pluginPathSchema.parse(key);
        if (names.has(key.toLowerCase())) throw new Error('插件文件名存在大小写冲突'); names.add(key.toLowerCase());
        const absolute = join(path, name); const metadata = await lstat(absolute);
        if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) throw new Error('插件不支持链接或特殊文件');
        const canonical = await realpath(absolute); const rel = relative(root, canonical);
        if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('插件路径必须位于包内');
        if (metadata.isDirectory()) await walk(absolute, key + '/');
        else {
          size += metadata.size;
          if (metadata.size > 50 * 1048576 || size > 200 * 1048576) throw new Error('插件超过文件或总容量限制');
          const bytes = await readFile(absolute); const after = await lstat(absolute);
          if (after.mtimeMs !== metadata.mtimeMs || after.size !== metadata.size || bytes.length !== metadata.size) throw new Error('读取插件时源文件发生变化，请重试');
          output.push({ path: key, bytes });
        }
      }
    };
    await walk(root, ''); return output;
  }
  private hash(files: Array<{ path: string; bytes: Buffer }>): string {
    const digest = createHash('sha256');
    for (const file of files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) digest.update(JSON.stringify([file.path, file.bytes.length, createHash('sha256').update(file.bytes).digest('hex')]) + '\n');
    return digest.digest('hex');
  }
  private async manifest(directory: string): Promise<PluginManifest> {
    const bytes = await readFile(join(directory, 'pi-plugin.json'));
    if (bytes.length > 65536) throw new Error('插件清单超过 64 KB');
    const manifest = pluginManifestSchema.parse(JSON.parse(bytes.toString('utf8')));
    for (const resource of [...manifest.skills, ...manifest.extensions]) {
      const path = join(directory, resource.path); const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('插件资源必须是普通文件');
    }
    for (const resource of manifest.skills) {
      const result = loadSkills({ cwd: directory, agentDir: directory, includeDefaults: false, skillPaths: [join(directory, resource.path)] });
      if (!result.skills.length || result.diagnostics.some(item => item.type === 'error')) throw new Error('插件 Skill 无效：' + resource.path);
    }
    for (const resource of manifest.extensions) if (!['.ts', '.js', '.mjs', '.cjs'].includes(extname(resource.path))) throw new Error('插件扩展必须是 JavaScript 或 TypeScript 文件');
    for (const server of manifest.mcp) validateMcpConfiguration(server, true);
    return manifest;
  }
  private async prepare(source: string, signal: AbortSignal, progress: Progress): Promise<PluginRevision> {
    signal.throwIfAborted(); const original = await realpath(source); const metadata = await lstat(original);
    const revision = crypto.randomUUID(); const staging = join(this.storage, 'plugins', '.staging-' + revision);
    const inside = relative(original, staging);
    if (metadata.isDirectory() && inside !== '..' && !inside.startsWith('..' + sep) && !isAbsolute(inside)) throw new Error('插件源目录不能包含安装目录');
    await mkdir(staging, { recursive: true });
    await writeFile(join(staging, '.pi-plugin-owner.json'), JSON.stringify({ kind: 'pi-plugin-stage', revision, pid: process.pid }), { flag: 'wx' });
    let published = '';
    try {
      progress('读取并验证插件');
      const content = join(staging, 'content');
      if (metadata.isDirectory()) {
        await mkdir(content);
        for (const file of await this.files(original, signal)) {
          signal.throwIfAborted(); const target = join(content, file.path); await mkdir(join(target, '..'), { recursive: true }); await writeFile(target, file.bytes, { flag: 'wx' });
        }
      } else if (metadata.isFile() && extname(original).toLowerCase() === '.zip' && metadata.size <= 200 * 1048576) {
        const extracted = join(staging, 'extracted'); await mkdir(extracted); progress('解压并验证插件归档');
        await unpackPluginZip(original, extracted, signal);
        let root = extracted;
        if (!(await lstat(join(root, 'pi-plugin.json')).then(item => item.isFile(), () => false))) {
          const entries = await readdir(root, { withFileTypes: true });
          if (entries.length !== 1 || !entries[0].isDirectory()) throw new Error('插件根目录缺少 pi-plugin.json');
          root = join(root, entries[0].name);
        }
        await rename(root, content);
      } else throw new Error('请选择插件目录或 ZIP 归档');
      const files = await this.files(content, signal); const manifest = await this.manifest(content); const hash = this.hash(files);
      signal.throwIfAborted(); progress('保存插件版本'); signal.throwIfAborted();
      const final = join(this.root(manifest.id), revision); await mkdir(this.root(manifest.id), { recursive: true });
      await writeFile(join(staging, '.pi-plugin-owner.json'), JSON.stringify({ kind: 'pi-plugin-version', id: manifest.id, revision, pid: process.pid }));
      await rename(staging, final); published = final;
      return { revision, path: join(final, 'content'), hash, manifest, installedAt: Date.now(), approved: false };
    } finally { if (!published) await rm(staging, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 }); }
  }
  async install(source: string, signal: AbortSignal, progress: Progress, expectedId?: string): Promise<Plugin> {
    return this.exclusive(async () => {
      let revision: PluginRevision | undefined; let committed = false;
      const existing = expectedId ? this.records().find(item => item.id === expectedId) : undefined;
      try {
        revision = await this.prepare(source, signal, progress);
        signal.throwIfAborted();
        if (expectedId && revision.manifest.id !== expectedId) throw new Error('更新包的插件标识不匹配，原版本已保留');
        const current = this.records().find(item => item.id === revision!.manifest.id);
        if (current && current.current.hash === revision.hash) return current;
        const next: Plugin = current ? { ...current, source, candidate: revision, error: undefined } : { id: revision.manifest.id, source, enabled: false, current: revision };
        await this.save(current ? this.records().map(record => record.id === next.id ? next : record) : [...this.records(), next], signal);
        committed = true;
        return next;
      } catch (error) {
        if (existing && !signal.aborted) await this.save(this.records().map(record => record.id === existing.id ? { ...record, error: error instanceof Error ? error.message : String(error) } : record), signal);
        throw error;
      } finally {
        if (revision && !committed) await this.removeRevision(revision.manifest.id, revision);
      }
    });
  }
  private async removeRevision(id: string, revision: PluginRevision): Promise<void> {
    const expected = this.revisionPath(id, revision.revision);
    if (resolve(revision.path).toLowerCase() !== resolve(expected).toLowerCase()) throw new Error('插件版本目录无效，未删除文件');
    await rm(join(expected, '..'), { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
  }
  async verify(id: string, revision: PluginRevision, signal?: AbortSignal): Promise<void> {
    if (resolve(revision.path).toLowerCase() !== resolve(this.revisionPath(id, revision.revision)).toLowerCase()) throw new Error('插件版本目录无效，未加载代码');
    if (this.hash(await this.files(revision.path, signal)) !== revision.hash) throw new Error('插件安装文件发生变化，请重新安装并授权');
  }
  async setEnabled(id: string, enabled: boolean, hash?: string, signal?: AbortSignal): Promise<Plugin> {
    return this.exclusive(async () => {
      const record = this.records().find(item => item.id === id); if (!record) throw new Error('插件不存在');
      const next = structuredClone(record);
      if (enabled) {
        const revision = record.candidate ?? record.current;
        if (hash !== revision.hash) throw new Error('插件版本已变化，请重新查看授权内容');
        await this.verify(id, revision, signal); signal?.throwIfAborted();
        if (next.candidate) { next.previous = next.current; next.current = next.candidate; next.candidate = undefined; }
        next.current.approved = true;
      }
      next.enabled = enabled; next.error = undefined;
      signal?.throwIfAborted();
      await this.save(this.records().map(record => record.id === id ? next : record), signal);
      return next;
    });
  }
  async rollback(id: string, signal?: AbortSignal): Promise<Plugin> {
    return this.exclusive(async () => {
      const record = this.records().find(item => item.id === id); if (!record?.previous) throw new Error('没有可回退的插件版本');
      await this.verify(id, record.previous, signal); signal?.throwIfAborted();
      const next = { ...record, current: record.previous, previous: record.current, enabled: record.enabled && record.previous.approved, candidate: undefined, error: undefined };
      await this.save(this.records().map(record => record.id === id ? next : record), signal);
      return next;
    });
  }
  async uninstall(id: string, signal?: AbortSignal): Promise<void> {
    return this.exclusive(async () => {
      const index = this.records().findIndex(item => item.id === id); if (index < 0) throw new Error('插件不存在');
      signal?.throwIfAborted();
      await this.save(this.records().filter(record => record.id !== id), signal);
      // Old workers retain their exact files until the next app start; never break an active run.
    });
  }
  async settings(base: Settings): Promise<Settings> {
    const result = structuredClone(base);
    for (const record of this.records().filter(item => item.enabled && item.current.approved)) {
      const revision = structuredClone(record.current); await this.verify(record.id, revision);
      for (const kind of ['skill', 'extension'] as const) for (const resource of kind === 'skill' ? revision.manifest.skills : revision.manifest.extensions)
        result.resources.push({ id: 'plugin:' + record.id + ':' + kind + ':' + resource.path, name: resource.name, path: join(revision.path, resource.path), kind, enabled: true });
      result.mcpServers.push(...revision.manifest.mcp.map(server => resolvePluginMcpServer({ ...record, current: revision }, server)));
    }
    if (new Set(result.resources.map(item => item.id)).size !== result.resources.length || new Set(result.mcpServers.map(item => item.id)).size !== result.mcpServers.length) throw new Error('插件资源或 MCP 标识与已有配置冲突');
    return result;
  }
  async catalog(sources: PluginSource[]): Promise<Array<{ sourceId: string; path: string; manifest?: PluginManifest; error?: string }>> {
    const results: Array<{ sourceId: string; path: string; manifest?: PluginManifest; error?: string }> = [];
    for (const source of sources) {
      try {
        const root = await realpath(source.path);
        for (const entry of (await readdir(root, { withFileTypes: true })).slice(0, 200)) {
          if (!entry.isDirectory() && !(entry.isFile() && extname(entry.name).toLowerCase() === '.zip')) continue;
          const path = join(root, entry.name);
          try { results.push({ sourceId: source.id, path, ...(entry.isDirectory() ? { manifest: await this.manifest(path) } : {}) }); }
          catch (error) { results.push({ sourceId: source.id, path, error: String(error) }); }
        }
      } catch (error) { results.push({ sourceId: source.id, path: source.path, error: String(error) }); }
    }
    return results;
  }
  async collect(): Promise<string[]> {
    const errors: string[] = []; const root = join(this.storage, 'plugins'); await mkdir(root, { recursive: true });
    const retained = new Set(this.records().flatMap(record => [record.current, record.previous, record.candidate].filter((item): item is PluginRevision => !!item).map(item => join(this.root(record.id), item.revision).toLowerCase())));
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const path = join(root, entry.name);
      if (entry.name.startsWith('.staging-')) {
        try {
          const owner = JSON.parse(await readFile(join(path, '.pi-plugin-owner.json'), 'utf8')) as { kind?: unknown; revision?: unknown; pid?: unknown };
          if (!['pi-plugin-stage', 'pi-plugin-version'].includes(String(owner.kind)) || typeof owner.revision !== 'string' || entry.name !== '.staging-' + owner.revision || typeof owner.pid !== 'number') continue;
          let active = owner.pid !== process.pid;
          if (active) { try { process.kill(owner.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') active = false; } }
          if (!active) await rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
        } catch (error) { errors.push(path + ': ' + String(error)); }
      } else if (/^[0-9a-f]{64}$/.test(entry.name)) {
        for (const version of await readdir(path, { withFileTypes: true })) {
          const target = join(path, version.name);
          if (!version.isDirectory() || version.isSymbolicLink() || retained.has(target.toLowerCase())) continue;
          try {
            const owner = JSON.parse(await readFile(join(target, '.pi-plugin-owner.json'), 'utf8')) as { kind?: unknown; id?: unknown; revision?: unknown };
            if (owner.kind !== 'pi-plugin-version' || typeof owner.id !== 'string' || typeof owner.revision !== 'string' || owner.revision !== version.name || this.root(owner.id) !== path) continue;
            await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
          } catch (error) { errors.push(target + ': ' + String(error)); }
        }
      }
    }
    return errors;
  }
}
