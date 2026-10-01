import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type BrowserWindow, nativeImage, session, WebContentsView } from 'electron';
import type { Thread } from '../shared/contracts.ts';
import { artifactAnnotationSchema, type ArtifactAnnotation, type ArtifactAnnotationView, type ArtifactCapture, type ArtifactDocument, type ArtifactStatus } from '../shared/artifacts.ts';
import type { AnnotationRect } from '../shared/browser-annotations.ts';
import { artifactFile, artifactHash, artifactKind, artifactMime } from './artifact-files.ts';
import { safeProjectPath } from './policy.ts';

type Bounds = { x: number; y: number; width: number; height: number };
type Document = ArtifactDocument & { threadId: string; directoryId: string; root: string; window: BrowserWindow; bytes: Buffer; resources: Record<string, string>; view?: WebContentsView; boundsRevision: number; state: ArtifactStatus; };
type Capture = ArtifactCapture & { owner: number; threadId: string; document: Document; bytes: Buffer; resources: Record<string, string>; scrollX: number; scrollY: number; at: number; };

/** HTML runs in an ephemeral, permission-denied session with no preload or desktop IPC. */
export class ArtifactPreview {
  private readonly documents = new Map<number, Document>();
  private readonly generations = new Map<number, string>();
  private readonly captures = new Map<string, Capture>();
  private readonly pendingCaptures = new Map<number, symbol>();
  private readonly writes = new Map<string, Promise<unknown>>();
  private readonly closing = new Set<Promise<void>>();
  constructor(private readonly storage: string, private readonly thread: (id: string) => Thread, private readonly directory: (threadId: string, directoryId: string) => string, private readonly save: (id: string, annotations: ArtifactAnnotation[]) => Promise<void>, private readonly report: (error: unknown) => void) {}

  async open(window: BrowserWindow, threadId: string, directoryId: string, path: string, id: string): Promise<ArtifactDocument> {
    this.close(window); this.generations.set(window.id, id);
    const root = this.directory(threadId, directoryId), kind = artifactKind(path);
    const file = await artifactFile(root, path);
    if (kind === 'pdf' && !file.bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('此文件不是有效的 PDF');
    if (window.isDestroyed() || this.generations.get(window.id) !== id) throw new Error('预览已取消');
    const document: Document = { id, threadId, directoryId, root, path: file.path, version: file.version, kind, bytes: file.bytes, resources: {}, window, boundsRevision: 0, state: { loading: kind === 'html', blocked: [], allowed: [] } };
    this.documents.set(window.id, document);
    if (kind === 'html') this.html(document);
    return { id, path: document.path, version: file.version, kind, ...(kind === 'pdf' ? { data: file.bytes.toString('base64') } : {}) };
  }
  private html(document: Document): void {
    const isolated = session.fromPartition('pi-artifact-' + document.id, { cache: false });
    isolated.setPermissionCheckHandler(() => false);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.on('will-download', event => event.preventDefault());
    isolated.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      const local = url.protocol === 'pi-artifact:' && url.hostname === document.id;
      const inline = ['data:', 'blob:'].includes(url.protocol);
      const network = ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && document.state.allowed.includes(url.origin);
      if (!local && !inline && !network && ['https:', 'http:'].includes(url.protocol) && !document.state.blocked.includes(url.origin)) document.state.blocked = [...document.state.blocked, url.origin].slice(-50);
      callback({ cancel: !local && !inline && !network });
    });
    isolated.protocol.handle('pi-artifact', async request => {
      try {
        const url = new URL(request.url);
        if (this.documents.get(document.window.id) !== document || url.hostname !== document.id || request.method !== 'GET') return new Response('Unavailable', { status: 403 });
        const path = decodeURIComponent(url.pathname.slice(1));
        if (path.split(/[\/]/).some(part => part.startsWith('.'))) return new Response('Unavailable', { status: 403 });
        const mime = artifactMime(path); if (!mime) return new Response('Unsupported resource', { status: 415 });
        const file = path === document.path ? { bytes: document.bytes, version: document.version, path } : await artifactFile(document.root, path);
        if (Object.keys(document.resources).length >= 1000 && !document.resources[file.path]) return new Response('Resource limit', { status: 413 });
        document.resources[file.path] = file.version;
        // Network is enforced by the session interceptor, including redirects and script-created requests.
        return new Response(new Uint8Array(file.bytes), { headers: { 'Content-Type': mime + (mime.startsWith('text/') ? '; charset=utf-8' : ''), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline' http: https:; style-src 'self' 'unsafe-inline' http: https:; img-src 'self' data: blob: http: https:; font-src 'self' data: http: https:; media-src 'self' blob: http: https:; connect-src 'self' http: https:; base-uri 'self'; form-action 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'" } });
      } catch { return new Response('Resource unavailable', { status: 404 }); }
    });
    const view = new WebContentsView({ webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webSecurity: true, preload: undefined, devTools: false } });
    document.view = view; view.setVisible(false); view.setBounds({ x: 0, y: 0, width: 800, height: 600 }); document.window.contentView.addChildView(view);
    const wc = view.webContents, url = 'pi-artifact://' + document.id + '/' + document.path.split('/').map(encodeURIComponent).join('/');
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (event, target) => { if (target.split('#')[0] !== url) { event.preventDefault(); document.state.error = '预览中已阻止页面跳转，请从文件列表打开目标文件'; } });
    wc.on('will-redirect', event => event.preventDefault());
    wc.on('did-start-loading', () => { document.state.loading = true; });
    wc.on('did-stop-loading', () => { document.state.loading = false; });
    wc.on('render-process-gone', () => { document.state.loading = false; document.state.error = '产物预览进程已结束，请重新加载'; });
    void wc.loadURL(url).catch(error => { if (!wc.isDestroyed()) { document.state.loading = false; document.state.error = String(error); } });
  }
  private get(window: BrowserWindow, threadId: string, id: string): Document {
    const value = this.documents.get(window.id);
    if (!value || value.id !== id || value.threadId !== threadId) throw new Error('预览已关闭或属于其他任务');
    this.thread(threadId); return value;
  }
  status(window: BrowserWindow, threadId: string, id: string) { return this.get(window, threadId, id).state; }
  bounds(window: BrowserWindow, threadId: string, id: string, bounds: Bounds) {
    const document = this.get(window, threadId, id), view = document.view; if (!view || view.webContents.isDestroyed()) return;
    document.boundsRevision++;
    const size = window.getContentBounds(), width = Math.max(0, Math.min(bounds.width, size.width - bounds.x)), height = Math.max(0, Math.min(bounds.height, size.height - bounds.y));
    const visible = width > 0 && height > 0;
    if (visible) view.setBounds({ ...bounds, width, height });
    else if (view.webContents.isFocused()) window.webContents.focus();
    view.setVisible(visible);
  }
  network(window: BrowserWindow, threadId: string, id: string, origin: string, allowed: boolean) {
    const document = this.get(window, threadId, id);
    document.state.allowed = allowed ? [...new Set([...document.state.allowed, origin])] : document.state.allowed.filter(item => item !== origin);
    document.state.blocked = document.state.blocked.filter(item => item !== origin); document.view?.webContents.reload();
  }
  stop(window: BrowserWindow, threadId: string, id: string) { const document = this.get(window, threadId, id); document.view?.webContents.stop(); document.state.loading = false; }
  async capture(window: BrowserWindow, threadId: string, id: string, pdf?: { image: string; page: number }): Promise<ArtifactCapture> {
    const document = this.get(window, threadId, id);
    if (this.pendingCaptures.has(window.id)) throw new Error('正在截取产物，请稍后重试');
    const token = Symbol(); this.pendingCaptures.set(window.id, token);
    try {
    let bytes: Buffer, scrollX = 0, scrollY = 0;
    if (document.kind === 'pdf') {
      if (!pdf) throw new Error('PDF 页面尚未完成渲染');
      bytes = Buffer.from(pdf.image.split(',')[1], 'base64');
    } else {
      const view = document.view!; if (document.state.loading || view.webContents.isDestroyed()) throw new Error('请等待产物完成加载');
      const hidden = !view.getVisible(), revision = document.boundsRevision, controller = new AbortController();
      if (hidden) { window.contentView.addChildView(view, 0); view.setVisible(true); }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const work = async () => {
          const position: unknown = await view.webContents.executeJavaScriptInIsolatedWorld(1003, [{ code: '({x:scrollX,y:scrollY})' }]); controller.signal.throwIfAborted();
          let x = 0, y = 0;
          if (position && typeof position === 'object' && 'x' in position && typeof position.x === 'number' && 'y' in position && typeof position.y === 'number') { x = Math.max(0, position.x); y = Math.max(0, position.y); }
          const image = await view.webContents.capturePage(); controller.signal.throwIfAborted();
          return { bytes: image.toPNG(), x, y };
        };
        const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { const error = new Error('产物截图超时，请重试'); controller.abort(error); reject(error); }, 30000); });
        const result = await Promise.race([work(), timeout]); bytes = result.bytes; scrollX = result.x; scrollY = result.y;
      } finally {
        clearTimeout(timer);
        if (hidden && !window.isDestroyed() && !view.webContents.isDestroyed()) { if (document.boundsRevision === revision) view.setVisible(false); window.contentView.addChildView(view); }
      }
    }
    if (this.get(window, threadId, id) !== document || this.pendingCaptures.get(window.id) !== token) throw new Error('预览已取消');
    if (bytes.length > 10 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('标注截图无效或超过 10 MB');
    const image = nativeImage.createFromBuffer(bytes), size = image.getSize();
    if (image.isEmpty() || size.width > 20000 || size.height > 20000) throw new Error('标注截图无效或超过 10 MB');
    for (const [key, item] of this.captures) if (item.owner === window.id || Date.now() - item.at > 300000) this.captures.delete(key);
    const capture: Capture = { id: crypto.randomUUID(), image: 'data:image/png;base64,' + bytes.toString('base64'), width: size.width, height: size.height, page: document.kind === 'pdf' ? pdf!.page : 1, owner: window.id, threadId, document, bytes, resources: { ...document.resources }, scrollX, scrollY, at: Date.now() };
    this.captures.set(capture.id, capture);
    return { id: capture.id, image: capture.image, width: capture.width, height: capture.height, page: capture.page };
    } finally { if (this.pendingCaptures.get(window.id) === token) this.pendingCaptures.delete(window.id); }
  }
  private async imagePath(threadId: string, id: string, context = false) {
    if (!threadId || /[<>:"/\\|?*]/.test(threadId) || ['.', '..'].includes(threadId) || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('标注存储标识无效');
    return safeProjectPath(this.storage, join('attachments', threadId, context ? 'artifact-context' : 'artifact-annotations', id + '.png'));
  }
  private exclusive<T>(threadId: string, action: () => Promise<T>) {
    const next = (this.writes.get(threadId) ?? Promise.resolve()).catch(() => {}).then(action); this.writes.set(threadId, next);
    void next.finally(() => { if (this.writes.get(threadId) === next) this.writes.delete(threadId); }).catch(() => {}); return next;
  }
  saveCapture(window: BrowserWindow, threadId: string, captureId: string, rect: AnnotationRect, comment: string) {
    return this.exclusive(threadId, async () => {
      const capture = this.captures.get(captureId);
      if (!capture || capture.owner !== window.id || capture.threadId !== threadId || Date.now() - capture.at > 300000) throw new Error('标注截图已失效，请重新截图');
      if (rect.x + rect.width > capture.width || rect.y + rect.height > capture.height) throw new Error('请选择截图范围内的元素或区域');
      const document = capture.document, thread = this.thread(threadId), previous = thread.artifactAnnotations;
      const saved = previous?.find(item => item.id === captureId);
      if (saved) { if (saved.deleting) throw new Error('此标注正在删除，请完成删除后重试'); return saved; }
      if ((previous?.length ?? 0) >= 200) throw new Error('此聊天最多保存 200 条产物标注');
      const item = artifactAnnotationSchema.parse({ id: captureId, createdAt: Date.now(), root: document.root, directoryId: document.directoryId, path: document.path, kind: document.kind, version: document.version, resources: capture.resources, imageHash: artifactHash(capture.bytes), page: capture.page, width: capture.width, height: capture.height, scrollX: capture.scrollX, scrollY: capture.scrollY, rect, comment });
      const path = await this.imagePath(threadId, captureId); await mkdir(dirname(path), { recursive: true });
      try { await writeFile(path, capture.bytes, { flag: 'wx' }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !(await readFile(path)).equals(capture.bytes)) throw error; }
      try { this.thread(threadId); await this.save(threadId, [...(previous ?? []), item]); }
      catch (error) { try { await unlink(path); } catch (cleanup) { throw new AggregateError([error, cleanup], '标注保存失败且截图未能清理'); } throw error; }
      return item;
    });
  }
  read(threadId: string, id: string): Promise<ArtifactAnnotationView> { return this.exclusive(threadId, () => this.readSaved(threadId, id)); }
  private async readSaved(threadId: string, id: string): Promise<ArtifactAnnotationView> {
    const item = this.thread(threadId).artifactAnnotations?.find(value => value.id === id); if (!item) throw new Error('产物标注不存在');
    if (item.deleting) throw new Error('此标注正在删除，请完成删除后重试');
    const file = await artifactFile(this.storage, await this.imagePath(threadId, id), 10 * 1024 * 1024);
    if (file.version !== item.imageHash) throw new Error('标注截图已损坏，原始记录仍保留');
    let stale = true;
    try {
      const root = this.directory(threadId, item.directoryId);
      stale = root !== item.root || (await artifactFile(root, item.path)).version !== item.version;
      if (!stale) for (const [path, version] of Object.entries(item.resources)) if ((await artifactFile(root, path)).version !== version) { stale = true; break; }
    } catch { /* Missing files and detached directories cannot validate old positions. */ }
    return { item, image: 'data:image/png;base64,' + file.bytes.toString('base64'), stale };
  }
  remove(threadId: string, id: string) {
    return this.exclusive(threadId, async () => {
      const thread = this.thread(threadId), previous = thread.artifactAnnotations, item = previous?.find(item => item.id === id);
      if (!item) return;
      if (!item.deleting) await this.save(threadId, previous!.map(item => item.id === id ? { ...item, deleting: true } : item));
      await unlink(await this.imagePath(threadId, id)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      await this.save(threadId, this.thread(threadId).artifactAnnotations!.filter(item => item.id !== id));
      this.captures.delete(id);
    });
  }
  attachment(threadId: string, id: string) {
    return this.exclusive(threadId, async () => {
      const result = await this.readSaved(threadId, id), path = await this.imagePath(threadId, id, true);
      await mkdir(dirname(path), { recursive: true }); await writeFile(path, Buffer.from(result.image.split(',')[1], 'base64')); return { path, item: result.item, stale: result.stale };
    });
  }
  discard(window: BrowserWindow, captureId: string) { if (this.captures.get(captureId)?.owner === window.id) this.captures.delete(captureId); }
  close(window: BrowserWindow, id?: string) {
    const document = this.documents.get(window.id);
    if (id && id !== this.generations.get(window.id)) return;
    this.pendingCaptures.delete(window.id);
    this.generations.delete(window.id); this.documents.delete(window.id);
    for (const [key, value] of this.captures) if (value.owner === window.id) this.captures.delete(key);
    if (document?.view) {
      const { view } = document, isolated = view.webContents.session;
      if (!window.isDestroyed()) window.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) view.webContents.close();
      isolated.protocol.unhandle('pi-artifact'); isolated.webRequest.onBeforeRequest(null);
      const cleanup = isolated.closeAllConnections().then(() => isolated.clearData()).then(() => isolated.clearCache()); this.closing.add(cleanup);
      void cleanup.catch(this.report).finally(() => this.closing.delete(cleanup));
    }
  }
  async closeThread(threadId: string) { for (const document of this.documents.values()) if (document.threadId === threadId) this.close(document.window); await this.writes.get(threadId); }
  async dispose() { for (const document of this.documents.values()) this.close(document.window); this.generations.clear(); this.captures.clear(); await Promise.all([...this.writes.values(), ...this.closing]); }
}
