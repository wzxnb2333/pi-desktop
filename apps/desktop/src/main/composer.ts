import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { DesktopData, Thread, UiThread } from '../shared/contracts.ts';
import type { ProjectDirectory } from '../shared/project-directories.ts';
import { projectDirectories, taskDirectory } from '../shared/project-directories.ts';
import type { ContextReference } from '../shared/input-context.ts';
import { type AttachmentInfo, type ComposerPayload, type ComposerPreflight, type ContextSearch, fuzzyScore, rememberDraft } from '../shared/composer.ts';
import { resolveInputContext } from '../worker/input-context.ts';
import { readProjectFile } from './files.ts';
import { safeProjectPath } from './policy.ts';
import { inputCatalog } from './input-catalog.ts';
import { catalogModel } from '../shared/model-configuration.ts';
import { modelCatalog } from './model-catalog.ts';

const excluded = new Set(['.git', 'node_modules', 'dist', 'build', '.cache', '.artifacts']);
const imageTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
export const contentVersion = (text: string): string => createHash('sha256').update(text).digest('hex');
export const sendFingerprint = (payload: ComposerPayload): string => contentVersion(JSON.stringify(payload));

export class ComposerService {
  private readonly searches = new Map<string, AbortController>();
  constructor(private readonly data: () => DesktopData, private readonly storage: string, private readonly allowed: Map<string, Set<string>>) {}
  private roots(thread: Thread): ProjectDirectory[] {
    const project = this.data().projects.find(item => item.id === thread.projectId);
    return project ? projectDirectories(project).map(root => taskDirectory(project, thread, root.id)) : [];
  }
  async attachment(thread: Thread, path: string): Promise<AttachmentInfo> {
    if (!this.allowed.get(thread.id)?.has(path)) throw new Error('请通过附件选择器添加文件');
    const absolute = await safeProjectPath(join(this.storage, 'attachments', thread.id), path);
    const metadata = await stat(absolute);
    if (!metadata.isFile() || metadata.size > 10 * 1024 * 1024) throw new Error('附件必须是小于 10 MB 的普通文件');
    const bytes = await readFile(absolute);
    const mime = imageTypes[extname(path).toLowerCase()];
    let text: string | undefined;
    if (!mime && !bytes.includes(0)) { try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* Binary / unsupported encoding. */ } }
    return { path, name: basename(path), bytes: bytes.length, kind: mime ? 'image' : text !== undefined ? 'text' : 'unsupported',
      preview: mime ? `data:${mime};base64,${bytes.toString('base64')}` : text?.slice(0, 100000),
      version: createHash('sha256').update(bytes).digest('hex'), truncated: !mime && (text?.length ?? 0) > 100000 };
  }
  async detail(thread: Thread, reference: ContextReference, refresh = false): Promise<{ reference: ContextReference; content: string; stale: boolean }> {
    const roots = this.roots(thread);
    const root = reference.directoryId ? roots.find(item => item.id === reference.directoryId) : roots.find(item => item.path === thread.cwd);
    if ((reference.kind === 'file' || reference.kind === 'folder') && !root) throw new Error('目录不属于此项目或已被移除');
    let current = reference.version;
    if (reference.kind === 'file') current = (await readProjectFile(root!.path, reference.id)).version;
    if (reference.kind === 'quote') {
      const message = thread.items.find(item => item.id === reference.id);
      if (!message || !reference.quote || message.text.slice(reference.quote.start, reference.quote.end) !== reference.quote.text) throw new Error('引用原文已改变或不可用，请重新选择');
      current = contentVersion(message.text);
    }
    const stale = !!reference.version && reference.version !== current;
    const resolved = { ...reference, version: current };
    const catalog = inputCatalog(thread, this.data().settings, join(this.storage, 'agent'), roots.length > 1);
    const content = await resolveInputContext(thread.cwd, [resolved], catalog.references.filter(item => item.kind === 'skill').map(item => ({ filePath: item.id, name: item.label })),
      catalog.references.filter(item => item.kind === 'tool').map(item => item.id), roots, thread.items);
    return { reference: refresh || !reference.version ? resolved : reference, content, stale: refresh ? false : stale };
  }
  async preflight(thread: Thread, payload: ComposerPayload): Promise<ComposerPreflight> {
    const model = this.data().settings.models.find(item => item.id === thread.modelId);
    const provider = this.data().settings.modelProviders.find(item => item.id === model?.provider);
    const builtin = catalogModel(provider, model, modelCatalog());
    const issues: ComposerPreflight['issues'] = [];
    let characters = payload.text.length, contextCharacters = 0, images = 0;
    if (!payload.text.trim() && !payload.attachments.length && !payload.context.length) issues.push({ target: '', message: '请输入消息或添加附件与引用' });
    if (!provider) issues.push({ target: '', message: '请选择模型' });
    if (thread.review) issues.push({ target: '', message: '请使用审查入口重新捕获当前版本' });
    for (const path of payload.attachments) {
      try { const item = await this.attachment(thread, path);
        if (item.kind === 'unsupported') throw new Error('不支持此附件格式，请使用 UTF-8 文本或图片');
        if (item.kind === 'image') { images++; if (builtin && !builtin.imageInput) throw new Error('当前模型不支持图片，请切换模型或移除此附件'); }
        else characters += item.preview?.length ?? 0;
      } catch (error) { issues.push({ target: basename(path), message: error instanceof Error ? error.message : String(error) }); }
    }
    for (const reference of payload.context) {
      try { const result = await this.detail(thread, reference); characters += result.content.length; contextCharacters += result.content.length; if (result.stale) throw new Error('引用版本已变化，请查看详情并刷新引用'); }
      catch (error) { issues.push({ target: reference.label, message: error instanceof Error ? error.message : String(error) }); }
    }
    if (characters > 500000 || contextCharacters > 200000) issues.push({ target: '', message: '消息与上下文过大，请减少附件或引用' });
    return { issues, estimatedTokens: Math.ceil(characters / 2) + images * 1500, contextWindow: builtin?.contextWindow ?? model?.contextWindow ?? 0, images };
  }
  remember(thread: Thread, ui: UiThread | undefined, force = false): void {
    if (!ui) return;
    thread.draftHistory = rememberDraft(thread.draftHistory ?? [], { text: ui.draft?.text ?? '', attachments: [...ui.draft?.attachments ?? []], context: structuredClone(ui.contextReferences ?? []) }, Date.now(), force);
  }
  recordRecent(thread: Thread, ui: UiThread): void {
    const execution = thread.directoryId ?? thread.projectId;
    const directoryId = ui.directoryId ?? execution;
    const path = directoryId === execution ? ui.selectedPath : ui.directoryViews?.[directoryId]?.selectedPath;
    if (!path || !this.roots(thread).some(root => root.id === directoryId)) return;
    thread.recentFiles = [{ directoryId, path, at: Date.now() }, ...(thread.recentFiles ?? []).filter(item => item.directoryId !== directoryId || item.path !== path)].slice(0, 50);
  }
  async search(thread: Thread, query: string): Promise<ContextSearch> {
    this.searches.get(thread.id)?.abort(); const controller = new AbortController(); this.searches.set(thread.id, controller);
    const matches: Array<ContextSearch['matches'][number] & { score: number }> = [];
    let visited = 0, limited = false, unreadable = 0;
    const ui = this.data().ui.threads[thread.id];
    const roots = this.roots(thread);
    try {
      for (const root of roots) {
        const open = root.id === (thread.directoryId ?? thread.projectId) ? ui?.openFiles ?? [] : ui?.directoryViews?.[root.id]?.openFiles ?? [];
        const pending = [''];
        while (pending.length) {
          if (controller.signal.aborted) return { matches: [], limited: false, unreadable: 0 };
          if (visited > 100000) { limited = true; break; }
          const directory = pending.shift()!;
          let entries; try { entries = await readdir(await safeProjectPath(root.path, directory), { withFileTypes: true }); }
          catch { unreadable++; continue; }
          for (const entry of entries) {
            if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
            visited++; const path = join(directory, entry.name);
            if (entry.isDirectory()) pending.push(path);
            if (!entry.isDirectory() && !entry.isFile()) continue;
            const score = fuzzyScore(path, query);
            if (score < 0) continue;
            const recent = thread.recentFiles?.findIndex(item => item.directoryId === root.id && item.path === path) ?? -1;
            matches.push({ kind: entry.isDirectory() ? 'folder' : 'file', id: path, directoryId: root.id, label: (roots.length > 1 ? root.name + '/' + entry.name : entry.name).slice(0, 300),
              description: root.name + ' / ' + path, score: score + (open.includes(path) ? 2000 + open.indexOf(path) : 0) + (recent >= 0 ? 500 - recent : 0) });
            if (matches.length > 400) { matches.sort((a, b) => b.score - a.score); matches.length = 200; limited = true; }
          }
        }
      }
      matches.sort((a, b) => b.score - a.score || a.description.localeCompare(b.description));
      return { matches: matches.slice(0, 100).map(({ score: _score, ...item }) => item), limited: limited || matches.length > 100, unreadable };
    } finally { if (this.searches.get(thread.id) === controller) this.searches.delete(thread.id); }
  }
}
