import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { annotationPageSchema, annotationSelection, browserAnnotationSchema, type AnnotationCapture, type AnnotationPage, type AnnotationSelection, type BrowserAnnotation } from '../shared/browser-annotations.ts';
import type { Thread } from '../shared/contracts.ts';
import { annotationDocument } from './annotation-document.ts';
import type { PreviewService } from './preview.ts';
import { safeProjectPath } from './policy.ts';

type AnnotationSource = {
  agentContents(threadId: string, tabId: string): Pick<ReturnType<PreviewService['agentContents']>, 'executeJavaScriptInIsolatedWorld'>;
  capture(threadId: string, tabId: string): Promise<{ isEmpty(): boolean; toPNG(): Buffer }>;
};
export class BrowserAnnotations {
  private readonly captures = new Map<string, { owner: number; threadId: string; tabId: string; at: number; page: AnnotationPage; bytes: Buffer }>();
  private readonly writes = new Map<string, Promise<unknown>>();
  private readonly pendingCaptures = new Map<number, { threadId: string; token: symbol }>();
  private disposed = false;
  constructor(private readonly storage: string, private readonly preview: AnnotationSource, private readonly thread: (id: string) => Thread, private readonly save: (threadId: string, annotations: BrowserAnnotation[]) => Promise<void>) {}
  private path(threadId: string, id: string, kind = 'annotations') {
    if (!threadId || /[<>:"/\\|?*]/.test(threadId) || ['.', '..'].includes(threadId) || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('标注存储标识无效');
    return safeProjectPath(this.storage, join('attachments', threadId, kind, id + '.png'));
  }
  private async inspect(threadId: string, tabId: string): Promise<AnnotationPage> {
    const wc = this.preview.agentContents(threadId, tabId);
    const raw: unknown = await wc.executeJavaScriptInIsolatedWorld(1002, [{ code: '(' + annotationDocument.toString() + ')()' }]);
    if (!raw || typeof raw !== 'object' || !('text' in raw)) throw new Error('无法读取网页标注信息');
    const { text: content, ...page } = raw;
    return annotationPageSchema.parse({ ...page, fingerprint: createHash('sha256').update(JSON.stringify({ ...page, text: content })).digest('hex') });
  }
  private async imagePage(threadId: string, tabId: string) {
    const controller = new AbortController();
    const work = async () => {
      const page = await this.inspect(threadId, tabId); controller.signal.throwIfAborted();
      const image = await this.preview.capture(threadId, tabId); controller.signal.throwIfAborted();
      if (image.isEmpty()) throw new Error('网页截图为空，请等待页面加载后重试');
      const bytes = image.toPNG(); if (bytes.length > 10 * 1024 * 1024) throw new Error('标注截图超过 10 MB，请缩小浏览器区域');
      const after = await this.inspect(threadId, tabId); controller.signal.throwIfAborted();
      if (after.fingerprint !== page.fingerprint) throw new Error('页面正在变化，请等待稳定后重新截图');
      page.fingerprint = createHash('sha256').update(page.fingerprint).update(bytes).digest('hex');
      return { page, bytes };
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { const error = new Error('网页标注读取超时，请重试'); controller.abort(error); reject(error); }, 30000); });
    try { return await Promise.race([work(), timeout]); }
    finally { clearTimeout(timer); }
  }
  async capture(threadId: string, tabId: string, owner: number): Promise<AnnotationCapture> {
    if (this.disposed) throw new Error('标注截图已失效，请重新截图');
    this.thread(threadId);
    for (const [id, item] of this.captures) if (Date.now() - item.at > 300000) this.captures.delete(id);
    const token = Symbol(); this.pendingCaptures.set(owner, { threadId, token });
    try {
      const { page, bytes } = await this.imagePage(threadId, tabId);
      if (this.disposed || this.pendingCaptures.get(owner)?.token !== token) throw new Error('标注截图已失效，请重新截图');
      this.thread(threadId);
      for (const [id, item] of this.captures) if (item.owner === owner) this.captures.delete(id);
      const id = crypto.randomUUID(); this.captures.set(id, { owner, threadId, tabId, at: Date.now(), page, bytes });
      return { id, page, image: 'data:image/png;base64,' + bytes.toString('base64') };
    } finally { if (this.pendingCaptures.get(owner)?.token === token) this.pendingCaptures.delete(owner); }
  }
  discard(owner: number, id?: string): void {
    if (!id) this.pendingCaptures.delete(owner);
    for (const [key, capture] of this.captures) if (capture.owner === owner && (!id || key === id)) this.captures.delete(key);
  }
  private exclusive<T>(threadId: string, action: () => Promise<T>): Promise<T> {
    const next = (this.writes.get(threadId) ?? Promise.resolve()).catch(() => {}).then(action);
    this.writes.set(threadId, next); void next.finally(() => { if (this.writes.get(threadId) === next) this.writes.delete(threadId); }).catch(() => {}); return next;
  }
  saveCapture(threadId: string, id: string, owner: number, selection: AnnotationSelection): Promise<BrowserAnnotation> {
    return this.exclusive(threadId, async () => {
      const capture = this.captures.get(id);
      if (!capture || capture.threadId !== threadId || capture.owner !== owner || Date.now() - capture.at > 300000) throw new Error('标注截图已失效，请重新截图');
      const thread = this.thread(threadId);
      const saved = thread.browserAnnotations?.find(item => item.id === id);
      if (saved) { if (saved.deleting) throw new Error('此标注正在删除，请完成删除后重试'); return saved; }
      if ((thread.browserAnnotations?.length ?? 0) >= 200) throw new Error('此聊天最多保存 200 条网页标注');
      const { page } = capture;
      const record = browserAnnotationSchema.parse({ id, createdAt: Date.now(), tabId: capture.tabId, url: page.url, title: page.title, fingerprint: page.fingerprint, viewport: { width: page.width, height: page.height, scrollX: page.scrollX, scrollY: page.scrollY }, ...annotationSelection(page, selection) });
      const path = await this.path(threadId, id); await mkdir(dirname(path), { recursive: true });
      try { await writeFile(path, capture.bytes, { flag: 'wx' }); }
      catch (error) {
        // A previous failed commit may have left this owned screenshot behind.
        // Reuse only identical bytes; never overwrite another file on retry.
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !(await readFile(path)).equals(capture.bytes)) throw error;
      }
      try {
        this.thread(threadId); await this.save(threadId, [...(thread.browserAnnotations ?? []), record]);
      } catch (error) {
        try { await unlink(path); } catch (cleanup) { throw new AggregateError([error, cleanup], '标注保存失败且截图未能清理'); } throw error;
      }
      // Keep the owned capture until discard/expiry so a lost IPC acknowledgement
      // can be retried without saving a second annotation.
      return record;
    });
  }
  read(threadId: string, id: string) { return this.exclusive(threadId, () => this.readSaved(threadId, id)); }
  private async readSaved(threadId: string, id: string) {
    const item = this.thread(threadId).browserAnnotations?.find(item => item.id === id);
    if (!item) throw new Error('网页标注不存在');
    if (item.deleting) throw new Error('此标注正在删除，请完成删除后重试');
    const bytes = await readFile(await this.path(threadId, id));
    let current: AnnotationPage | undefined;
    try { current = (await this.imagePage(threadId, item.tabId)).page; } catch { /* A closed or unavailable page cannot validate the stored annotation. */ }
    return { item, image: 'data:image/png;base64,' + bytes.toString('base64'), stale: !current || current.fingerprint !== item.fingerprint };
  }
  remove(threadId: string, id: string): Promise<void> {
    return this.exclusive(threadId, async () => {
      const thread = this.thread(threadId), item = thread.browserAnnotations?.find(item => item.id === id);
      if (!item) return; // A lost removal acknowledgement is safe to retry.
      // Persist the intent first. A locked PNG or failed final commit leaves a
      // visible, restart-safe retry entry instead of an unreachable orphan.
      if (!item.deleting) await this.save(threadId, thread.browserAnnotations!.map(item => item.id === id ? { ...item, deleting: true } : item));
      await unlink(await this.path(threadId, id)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      await this.save(threadId, this.thread(threadId).browserAnnotations!.filter(item => item.id !== id));
      this.captures.delete(id);
    });
  }
  attachment(threadId: string, id: string) {
    return this.exclusive(threadId, async () => {
      const value = await this.readSaved(threadId, id);
      const path = await this.path(threadId, id, 'browser-context'); await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(value.image.split(',')[1], 'base64'));
      return { path, item: value.item, stale: value.stale };
    });
  }
  async closeThread(threadId: string) {
    for (const [owner, pending] of this.pendingCaptures) if (pending.threadId === threadId) this.pendingCaptures.delete(owner);
    for (const [id, capture] of this.captures) if (capture.threadId === threadId) this.captures.delete(id);
    await this.writes.get(threadId);
  }
  async dispose() { this.disposed = true; this.pendingCaptures.clear(); this.captures.clear(); await Promise.allSettled(this.writes.values()); }
}
