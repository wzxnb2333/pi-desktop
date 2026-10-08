import { type BrowserWindow, dialog, type DownloadItem, session, shell, webContents, WebContentsView, type WebContentsViewConstructorOptions } from 'electron';
import { type DesktopEvent, type DesktopRequest, webUrlSchema } from '../shared/contracts.ts';
import type { Locale } from '../shared/locale.ts';
import { translate } from '../shared/localization.ts';
import { BrowserFind } from './browser-find.ts';
import { panelCommand } from '../shared/shortcuts.ts';
type Bounds = { x: number; y: number; width: number; height: number; occluded?: boolean };
type Page = { threadId: string; tabId: string; view: WebContentsView; window: BrowserWindow; error?: string; find: BrowserFind; automated?: (url: string) => boolean };
type Surface = { active: string; visible: boolean; bounds: Bounds; revision: number };
type BrowserAction = Extract<DesktopRequest, { op: 'browser.action' }>['action'];
const PARTITION = 'persist:pi-browser';
export class PreviewService {
  private readonly pages = new Map<string, Page>();
  private readonly downloads = new Map<string, DownloadItem>();
  private readonly downloadRecords = new Map<string, Extract<DesktopEvent, { type: 'download' }>>();
  private readonly downloadPaths = new Map<string, string>();
  private readonly grants = new Set<string>();
  private readonly surfaces = new Map<number, Surface>();
  private configured = false;
  private disposing = false;
  constructor(private readonly window: BrowserWindow, private readonly locale: () => Locale, private readonly emit: (event: DesktopEvent, owner?: BrowserWindow) => void = () => {}, private readonly onPageClosed: (threadId: string, tabId: string) => void = () => {}, private readonly onVisit: (threadId: string, tabId: string, url: string, title: string, navigation: boolean) => void = () => {}, private readonly shortcuts: () => Record<string, string> = () => ({})) {}
  private surface(window: BrowserWindow): Surface {
    let surface = this.surfaces.get(window.id);
    if (!surface) { surface = { active: '', visible: false, bounds: { x: 0, y: 0, width: 0, height: 0 }, revision: 0 }; this.surfaces.set(window.id, surface); }
    return surface;
  }
  private present(key: string, page: Page, surface: Surface): void {
    const foreground = surface.visible && key === surface.active;
    const background = !foreground && Boolean(page.automated);
    if (background) page.window.contentView.addChildView(page.view, 0);
    else if (foreground) page.window.contentView.addChildView(page.view);
    // Hidden native views have a zero-sized DOM viewport. Keep automated pages painted
    // below the app so inspect references and later input use the same viewport.
    page.view.setVisible(foreground || background);
  }
  private configure(): void {
    if (this.configured) return;
    this.configured = true;
    const browserSession = session.fromPartition(PARTITION);
    browserSession.setPermissionCheckHandler((_contents, permission, origin) => this.grants.has(origin + ':' + permission));
    browserSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      const raw = details.requestingUrl || contents.getURL();
      if (!webUrlSchema.safeParse(raw).success) return callback(false);
      const origin = new URL(raw).origin;
      const key = origin + ':' + permission;
      if (this.grants.has(key)) return callback(true);
      const locale = this.locale();
      const owner = [...this.pages.values()].find(page => page.view.webContents === contents)?.window;
      if (!owner || owner.isDestroyed()) return callback(false);
      void dialog.showMessageBox(owner, { type: 'question', message: translate(locale, '{p0} 请求 {p1} 权限', { p0: origin, p1: permission }), buttons: [translate(locale, '拒绝'), translate(locale, '本次运行允许')], defaultId: 0, cancelId: 0 }).then(result => {
        if (result.response === 1) this.grants.add(key);
        callback(result.response === 1);
      }, () => callback(false));
    });
    browserSession.on('will-download', (_event, item) => {
      const id = crypto.randomUUID();
      this.downloads.set(id, item);
      const publish = (state: 'progressing' | 'completed' | 'cancelled' | 'interrupted') => {
        const record = { type: 'download' as const, id, name: item.getFilename(), received: item.getReceivedBytes(), total: item.getTotalBytes(), state };
        this.downloadRecords.set(id, record);
        if (state === 'completed') this.downloadPaths.set(id, item.getSavePath());
        this.emit(record);
      };
      item.setSaveDialogOptions({ title: translate(this.locale(), '保存下载文件') });
      publish('progressing');
      item.on('updated', (_event, state) => publish(state));
      item.once('done', (_event, state) => { publish(state); this.downloads.delete(id); });
    });
  }
  private publish(page: Page): void {
    const wc = page.view.webContents;
    if (wc.isDestroyed()) return;
    this.emit({ type: 'browser', threadId: page.threadId, tabId: page.tabId, url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), back: wc.navigationHistory.canGoBack(), forward: wc.navigationHistory.canGoForward(), zoom: wc.getZoomFactor(), error: page.error, matches: page.find.state.matches, find: page.find.state });
  }
  private create(threadId: string, tabId: string, window: BrowserWindow, options: WebContentsViewConstructorOptions = {}): Page {
    this.configure();
    const key = threadId + '/' + tabId;
    const view = new WebContentsView({ ...(options.webContents ? { webContents: options.webContents } : {}), webPreferences: { ...options.webPreferences, session: session.fromPartition(PARTITION), preload: undefined, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webSecurity: true, partition: PARTITION } });
    const page: Page = { threadId, tabId, view, window, find: new BrowserFind(view.webContents) };
    this.pages.set(key, page);
    view.setVisible(false);
    window.contentView.addChildView(view);
    const wc = view.webContents;
    let gestureAt = 0;
    wc.on('before-mouse-event', (_event, input) => { if (input.type === 'mouseDown' || input.type === 'mouseUp') gestureAt = Date.now(); });
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      gestureAt = Date.now();
      const surface = this.surface(page.window);
      if (input.isComposing || page.window.isDestroyed() || !surface.visible || surface.active !== key || !view.getVisible() || !wc.isFocused()) return;
      const command = panelCommand({ key: input.key, ctrlKey: input.control, shiftKey: input.shift, altKey: input.alt, metaKey: input.meta }, this.shortcuts());
      if (!command) return;
      event.preventDefault();
      if (!input.isAutoRepeat) {
        page.window.webContents.focus();
        this.emit({ type: 'panel.command', threadId, tabId, command }, page.window);
      }
    });
    wc.setWindowOpenHandler(details => {
      if (page.automated) { page.error = '智能体页面弹窗已阻止，请使用浏览器导航工具打开目标网址'; this.publish(page); return { action: 'deny' }; }
      if (Date.now() - gestureAt > 3000) { page.error = '已阻止非用户触发的弹窗。请点击网页中的登录或打开链接按钮重试。'; this.publish(page); return { action: 'deny' }; }
      gestureAt = 0;
      if (details.url !== 'about:blank' && !webUrlSchema.safeParse(details.url).success) return { action: 'deny' };
      return { action: 'allow', createWindow: options => {
        const child = this.create(threadId, crypto.randomUUID(), page.window, options);
        this.select(threadId, child.tabId, page.window);
        return child.view.webContents;
      } };
    });
    const navigation = (event: { preventDefault(): void }, target: string) => {
      if (!webUrlSchema.safeParse(target).success && target !== 'about:blank' || page.automated && !page.automated(target)) {
        event.preventDefault(); page.error = '网站尚未授权，请明确导航到目标网站'; this.publish(page);
      }
    };
    wc.on('will-navigate', navigation);
    wc.on('will-redirect', navigation);
    wc.on('did-start-loading', () => { page.error = undefined; this.publish(page); });
    wc.on('did-start-navigation', details => { if (details.isMainFrame && !details.isSameDocument) { page.find.navigating(); this.publish(page); } });
    wc.on('did-stop-loading', () => { page.find.loaded(); this.publish(page); });
    wc.on('did-navigate', () => { this.onVisit(threadId, tabId, wc.getURL(), wc.getTitle(), true); this.publish(page); });
    wc.on('did-navigate-in-page', (_event, _url, mainFrame) => { if (mainFrame) this.onVisit(threadId, tabId, wc.getURL(), wc.getTitle(), true); this.publish(page); });
    wc.on('page-title-updated', () => { this.onVisit(threadId, tabId, wc.getURL(), wc.getTitle(), false); this.publish(page); });
    wc.on('did-fail-load', (_event, code, description, _url, mainFrame) => { if (mainFrame && code !== -3) { page.error = description; this.publish(page); } });
    wc.on('render-process-gone', (_event, details) => { page.error = '网页进程已结束：' + details.reason + '，可以重新加载'; this.publish(page); });
    wc.on('found-in-page', (_event, result) => { if (page.find.result(result)) this.publish(page); });
    wc.on('destroyed', () => {
      if (this.pages.get(key) !== page) return;
      this.pages.delete(key);
      if (!page.window.isDestroyed()) page.window.contentView.removeChildView(view);
      if (!this.disposing) this.onPageClosed(threadId, tabId);
    });
    return page;
  }
  async open(raw: string, threadId = 'legacy', tabId = 'preview', window = this.window): Promise<void> {
    const url = webUrlSchema.parse(raw);
    const page = this.pages.get(threadId + '/' + tabId) ?? this.create(threadId, tabId, window);
    page.automated = undefined;
    this.select(threadId, tabId, window);
    try { await page.view.webContents.loadURL(url); } catch (error) {
      if (!page.view.webContents.isDestroyed() && !(error instanceof Error && error.message.includes('ERR_ABORTED'))) { page.error = error instanceof Error ? error.message : String(error); this.publish(page); }
    }
  }
  select(threadId: string, tabId: string, window = this.window): boolean {
    const surface = this.surface(window);
    surface.active = threadId + '/' + tabId;
    const page = this.pages.get(surface.active);
    if (page && page.window !== window) {
      if (!page.window.isDestroyed()) page.window.contentView.removeChildView(page.view);
      window.contentView.addChildView(page.view);
      page.window = window;
    }
    if (!page) {
      for (const [key, current] of this.pages) if (current.window === window) this.present(key, current, surface);
      return false;
    }
    this.bounds(surface.bounds, window);
    this.publish(page);
    return true;
  }
  bounds(bounds: Bounds, window = this.window): void {
    const surface = this.surface(window);
    const revision = ++surface.revision;
    const wasVisible = surface.visible;
    surface.bounds = bounds;
    surface.visible = bounds.width > 0 && bounds.height > 0 && !bounds.occluded;
    const active = this.pages.get(surface.active);
    if (bounds.occluded && wasVisible && bounds.width > 0 && bounds.height > 0 && active?.window === window && !active.view.webContents.isDestroyed() && active.view.getVisible()) {
      // Native views sit above DOM popovers. Keep their last frame in the renderer while the
      // interactive native view is covered; the image never touches disk or browser history.
      void active.view.webContents.capturePage().then(image => {
        if (surface.revision !== revision || window.isDestroyed() || active.view.webContents.isDestroyed()) return;
        this.emit({ type: 'preview.snapshot', threadId: active.threadId, tabId: active.tabId, image: image.toDataURL() });
        if (active.view.webContents.isFocused()) window.webContents.focus();
        this.present(surface.active, active, surface);
      }).catch(() => {
        if (surface.revision === revision && !active.view.webContents.isDestroyed()) this.present(surface.active, active, surface);
      });
      return;
    }
    if (!bounds.occluded && active) this.emit({ type: 'preview.snapshot', threadId: active.threadId, tabId: active.tabId, image: '' });
    if (!surface.visible && [...this.pages.values()].some(page => page.window === window && !page.view.webContents.isDestroyed() && page.view.webContents.isFocused())) window.webContents.focus();
    const size = window.getContentBounds();
    for (const [key, page] of this.pages) {
      if (page.window !== window) continue;
      this.present(key, page, surface);
      if (surface.visible && key === surface.active) page.view.setBounds({ x: Math.min(bounds.x, size.width), y: Math.min(bounds.y, size.height), width: Math.max(0, Math.min(bounds.width, size.width - bounds.x)), height: Math.max(0, Math.min(bounds.height, size.height - bounds.y)) });
    }
  }
  async action(threadId: string, tabId: string, action: BrowserAction): Promise<void> {
    const key = threadId + '/' + tabId;
    const page = this.pages.get(key);
    if (!page) return;
    const wc = page.view.webContents;
    const locale = this.locale();
    if (action === 'focus') { const surface = this.surface(page.window); if (surface.visible && key === surface.active) wc.focus(); return; }
    if (action === 'close') { wc.close(); return; }
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    if (action === 'reload') wc.reload();
    if (action === 'stop') wc.stop();
    if (action.startsWith('zoom')) wc.setZoomFactor(action === 'zoomReset' ? 1 : Math.max(0.25, Math.min(3, wc.getZoomFactor() + (action === 'zoomIn' ? 0.1 : -0.1))));
    if (['permissions', 'clearSite'].includes(action) && !webUrlSchema.safeParse(wc.getURL()).success) throw new Error('请先打开一个 HTTP(S) 网站');
    if (action === 'permissions') {
      const origin = new URL(wc.getURL()).origin;
      const granted = [...this.grants].filter(value => value.startsWith(origin + ':'));
      const result = await dialog.showMessageBox(page.window, { message: translate(locale, '{p0} · 站点权限', { p0: origin }), detail: granted.join('\n') || translate(locale, '尚未授予权限；网站请求时会询问。'), buttons: [translate(locale, '关闭'), translate(locale, '撤销此站点权限')], cancelId: 0 });
      if (result.response === 1) granted.forEach(value => this.grants.delete(value));
    }
    if (action === 'clearSite' || action === 'clearAll') {
      const result = await dialog.showMessageBox(page.window, { type: 'warning', message: translate(locale, action === 'clearAll' ? '清除浏览器所有站点数据？' : '清除此站点数据？'), detail: translate(locale, '相关网站的登录状态会退出。'), buttons: [translate(locale, '取消'), translate(locale, '清除')], defaultId: 0, cancelId: 0 });
      if (result.response === 1) {
        const origin = new URL(wc.getURL()).origin;
        await wc.session.clearData(action === 'clearAll' ? {} : { origins: [origin] });
        for (const grant of this.grants) if (action === 'clearAll' || grant.startsWith(origin + ':')) this.grants.delete(grant);
        wc.reload();
      }
    }
    this.publish(page);
  }
  find(threadId: string, tabId: string, text: string, forward: boolean): void {
    const page = this.pages.get(threadId + '/' + tabId);
    if (!page) return;
    page.find.search(text, forward);
    this.publish(page);
  }
  download(id: string, action: 'cancel' | 'reveal'): void {
    if (!this.downloadRecords.has(id)) throw new Error('下载记录不存在');
    if (action === 'cancel') this.downloads.get(id)?.cancel();
    else if (this.downloadPaths.has(id)) shell.showItemInFolder(this.downloadPaths.get(id)!);
  }
  listDownloads(): Extract<DesktopEvent, { type: 'download' }>[] { return [...this.downloadRecords.values()]; }
  cacheBytes(): Promise<number> { return session.fromPartition(PARTITION).getCacheSize(); }
  async clearData(options: { cache: boolean; siteData: boolean; origins?: string[] }): Promise<void> {
    const browserSession = session.fromPartition(PARTITION);
    if (options.siteData && (options.origins === undefined || options.origins.length)) {
      await browserSession.clearData({ dataTypes: ['cookies', 'localStorage', 'indexedDB', 'serviceWorkers', 'fileSystems', 'backgroundFetch'], ...(options.origins ? { origins: options.origins } : {}), originMatchingMode: 'third-parties-included' });
      for (const grant of this.grants) if (!options.origins || options.origins.some(origin => grant.startsWith(origin + ':'))) this.grants.delete(grant);
    }
    if (options.cache) { await browserSession.clearData({ dataTypes: ['cache'] }); await browserSession.clearCodeCaches({}); }
  }
  refresh(window = this.window): void { this.pages.get(this.surface(window).active)?.view.webContents.reload(); }
  hide(window = this.window): void {
    const surface = this.surface(window);
    surface.visible = false;
    surface.revision++;
    for (const [key, page] of this.pages) if (page.window === window) {
      if (!page.view.webContents.isDestroyed() && page.view.webContents.isFocused()) window.webContents.focus();
      this.present(key, page, surface);
    }
  }
  closeWindow(window: BrowserWindow): void {
    for (const [key, page] of this.pages) if (page.window === window) {
      this.pages.delete(key);
      if (!window.isDestroyed()) window.contentView.removeChildView(page.view);
      if (!page.view.webContents.isDestroyed()) page.view.webContents.close();
    }
    this.surfaces.delete(window.id);
  }
  closeThread(threadId: string): void { for (const page of [...this.pages.values()]) if (page.threadId === threadId) page.view.webContents.close(); }
  close(): void { this.disposing = true; for (const page of [...this.pages.values()]) page.view.webContents.close(); }
  async external(url: string): Promise<void> { await shell.openExternal(webUrlSchema.parse(url)); }
  agentTabs(threadId: string) {
    return [...this.pages.values()].filter(page => page.threadId === threadId && !page.view.webContents.isDestroyed()).map(page => ({ tabId: page.tabId, url: page.view.webContents.getURL(), title: page.view.webContents.getTitle() }));
  }
  agentFocus(threadId: string, tabId: string, window: BrowserWindow): () => void {
    const focused = webContents.getFocusedWebContents();
    const appFocused = focused === window.webContents;
    return () => {
      if (!appFocused || window.isDestroyed() || !window.isFocused()) return;
      const current = webContents.getFocusedWebContents();
      const page = this.pages.get(threadId + '/' + tabId);
      if (!current || current === page?.view.webContents) window.webContents.focus();
    };
  }
  async capture(threadId: string, tabId: string, signal?: AbortSignal) {
    const page = this.pages.get(threadId + '/' + tabId);
    if (!page || page.view.webContents.isDestroyed()) throw new Error('浏览器标签不存在，请先打开网页');
    const hidden = !page.view.getVisible();
    if (hidden) {
      // Paint below the app surface so background captures do not steal navigation or focus.
      page.window.contentView.addChildView(page.view, 0);
      page.view.setVisible(true);
    }
    const capture = page.view.webContents.capturePage();
    let abort: (() => void) | undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal?.reason instanceof Error ? signal.reason : new Error('浏览器截图操作已取消'));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    try { return await Promise.race([capture, interrupted]); }
    finally {
      if (abort) signal?.removeEventListener('abort', abort);
      if (hidden && !page.window.isDestroyed() && !page.view.webContents.isDestroyed()) {
        page.view.setVisible(false);
        page.window.contentView.addChildView(page.view);
        this.bounds(this.surface(page.window).bounds, page.window);
      }
    }
  }
  agentContents(threadId: string, tabId: string, window?: BrowserWindow, allowed?: (url: string) => boolean, create = false) {
    const page = this.pages.get(threadId + '/' + tabId) ?? (create && window ? this.create(threadId, tabId, window) : undefined);
    if (!page || page.view.webContents.isDestroyed()) throw new Error('浏览器标签不存在，请先打开网页');
    if (!create && page.view.webContents.isCrashed()) throw new Error('网页进程已结束，请重新导航或刷新页面');
    if (allowed) page.automated = allowed;
    if (!page.view.getBounds().width || !page.view.getBounds().height) page.view.setBounds({ x: 0, y: 0, width: 1024, height: 768 });
    this.present(threadId + '/' + tabId, page, this.surface(page.window));
    return page.view.webContents;
  }
  async agentInput<T>(threadId: string, tabId: string, perform: () => Promise<T>): Promise<T> {
    const page = this.pages.get(threadId + '/' + tabId);
    if (!page || page.view.webContents.isDestroyed()) throw new Error('浏览器标签不存在，请先打开网页');
    const hidden = !page.view.getVisible();
    const appFocused = page.window.webContents.isFocused();
    if (hidden) { page.window.contentView.addChildView(page.view, 0); page.view.setVisible(true); }
    try {
      // Native input needs a painted viewport. The app remains above this view and retains focus.
      await new Promise<void>(resolve => setTimeout(resolve, 20));
      return await perform();
    } finally {
      if (hidden && !page.window.isDestroyed() && !page.view.webContents.isDestroyed()) {
        page.view.setVisible(false); page.window.contentView.addChildView(page.view);
        this.bounds(this.surface(page.window).bounds, page.window);
      }
      if (appFocused && !page.window.isDestroyed() && page.window.isFocused()) {
        const focused = webContents.getFocusedWebContents();
        if (!focused || focused === page.view.webContents) page.window.webContents.focus();
      }
    }
  }
}

