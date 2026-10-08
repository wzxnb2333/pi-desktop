import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, screen, shell, Tray } from 'electron';
import { requestSchema } from '../shared/contracts.ts';
import { translate } from '../shared/localization.ts';
import { DesktopApplication } from './application.ts';
import { StoreRecoveryError } from './store.ts';
import { assertSubtaskObserverRequest } from './subtask-observer.ts';
import { recoverSandboxRuns } from './windows-sandbox.ts';
import type { WindowRecord } from './window-state.ts';

const directory = dirname(fileURLToPath(import.meta.url));
protocol.registerSchemesAsPrivileged([{ scheme: 'pi-artifact', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const userData =
  app.commandLine.getSwitchValue('user-data-dir') ||
  (!app.isPackaged ? process.env.PI_DESKTOP_USER_DATA : undefined);
if (userData) app.setPath('userData', userData);
app.setName('Pi Desktop');
app.setAppUserModelId('dev.pi.desktop');
let controller: DesktopApplication | undefined;
let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let quitReady = false;
const updateTrayMenu = () => {
  if (!tray || !controller) return;
  const locale = controller.store.data.ui.locale;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: translate(locale, '打开 Pi Desktop'), click: () => window?.show() },
    { label: translate(locale, '退出'), click: () => app.quit() },
  ]));
};
const log = async (error: unknown) => {
  const dir = join(app.getPath('userData'), 'logs');
  await mkdir(dir, { recursive: true });
  const message = String(error).replace(/(Bearer\s+|api[_-]?key[=:]\s*)[^\s,]+/gi, '$1[redacted]');
  await appendFile(join(dir, 'desktop.log'), `${new Date().toISOString()} ${message}\n`);
};
const loadWindow = async (target: BrowserWindow) => {
  if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) await target.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await target.loadFile(join(directory, '../renderer/index.html'));
};
const restoreBounds = (target: BrowserWindow, record?: WindowRecord) => {
  if (record?.bounds) {
    const display = screen.getDisplayMatching(record.bounds).workArea;
    const width = Math.min(record.bounds.width, display.width);
    const height = Math.min(record.bounds.height, display.height);
    target.setBounds({ x: Math.max(display.x, Math.min(record.bounds.x, display.x + display.width - width)), y: Math.max(display.y, Math.min(record.bounds.y, display.y + display.height - height)), width, height });
  }
  if (record?.maximized) target.maximize();
};
const configureWindow = (target: BrowserWindow, main: boolean, showWhenReady = true) => {
  target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  target.webContents.on('will-navigate', event => event.preventDefault());
  target.webContents.on('will-prevent-unload', event => { if (controller?.confirmDiscardFiles(target)) event.preventDefault(); });
  target.webContents.on('render-process-gone', (_event, details) => { controller?.providerAuth.closeOwner(target.id); void log(details.reason); if (!quitting && !target.isDestroyed()) target.reload(); });
  target.on('close', event => {
    controller?.providerAuth.closeOwner(target.id);
    if (quitting && !quitReady) { event.preventDefault(); return; }
    if (!quitting && main && controller?.store.data.settings.keepInTray && tray) { event.preventDefault(); controller.voice.closeOwner(target.webContents.id); target.hide(); return; }
    if (!quitting && main && controller && controller.windows.entries.size > 1) { event.preventDefault(); controller.voice.closeOwner(target.webContents.id); target.hide(); return; }
    if (!quitting && main && controller) { event.preventDefault(); app.quit(); return; }
    if (!quitting && !controller?.confirmDiscardFiles(target)) { event.preventDefault(); return; }
    controller?.closeWindow(target, quitting);
  });
  target.on('resize', () => { if (controller?.windows.entries.has(target.id)) { controller.windows.capture(target); controller.changed(); } });
  target.on('moved', () => { if (controller?.windows.entries.has(target.id)) { controller.windows.capture(target); controller.changed(); } });
  if (showWhenReady) target.once('ready-to-show', () => target.show());
};
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    window?.show();
    window?.focus();
  });
  void app
    .whenReady()
    .then(async () => {
      Menu.setApplicationMenu(null);
      window = new BrowserWindow({
        width: 1440,
        height: 940,
        minWidth: 1000,
        minHeight: 640,
        show: false,
        frame: false,
        icon: join(directory, '../../resources/icon.png'),
        backgroundColor: '#f9f9f9',
        title: 'Pi Desktop',
        webPreferences: {
          preload: join(directory, '../preload/index.cjs'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
        },
      });
      controller = new DesktopApplication(
        window,
        app.getPath('userData'),
        join(directory, 'agent-worker.js'),
      );
      while (true) {
        try { await controller.init(); break; } catch (error) {
          if (!(error instanceof StoreRecoveryError)) throw error;
          const locale = controller.store.data.ui.locale;
          const message = error.reason === 'credentials' ? '凭据存储无法恢复，原文件和恢复记录已保留。请检查数据目录后重试。' : error.reason === 'future' ? '数据由更新版本的 Pi Desktop 创建，请使用相应版本打开。' : '桌面数据及备份无法读取，原文件已保留。请检查数据目录后重试。';
          const answer = await dialog.showMessageBox(window, { type: 'error', title: translate(locale, '无法打开桌面数据'), message: translate(locale, message), detail: error.directory, buttons: [translate(locale, '重试'), translate(locale, '打开数据目录'), translate(locale, '退出')], defaultId: 0, cancelId: 2 });
          if (answer.response === 2) { app.exit(1); return; }
          if (answer.response === 1) await shell.openPath(error.directory);
        }
      }
      if (controller.store.recoveredFromBackup) {
        const locale = controller.store.data.ui.locale;
        await dialog.showMessageBox(window, { type: 'warning', message: translate(locale, '已从备份恢复桌面数据'), detail: translate(locale, '原始文件已保留在数据目录，可以检查后继续使用。') });
      }
      while (true) {
        try { await recoverSandboxRuns(join(app.getPath('userData'), 'agent')); break; }
        catch (error) {
          const locale = controller.store.data.ui.locale;
          await log(error);
          const answer = await dialog.showMessageBox(window, {
            type: 'error', title: translate(locale, '沙箱恢复未完成'),
            message: translate(locale, '上次沙箱的清理记录无法恢复。记录会保留；问题解决前不会执行新的沙箱命令。聊天和文件查看仍可使用。'),
            detail: error instanceof Error ? error.message : String(error),
            buttons: [translate(locale, '重试'), translate(locale, '打开数据目录'), translate(locale, '继续打开')], defaultId: 0, cancelId: 2,
          });
          if (answer.response === 2) break;
          if (answer.response === 1) await shell.openPath(join(app.getPath('userData'), 'agent', 'sandbox-leases'));
        }
      }
      controller.windowFactory = async (key, kind, threadId) => {
        const target = new BrowserWindow({ width: kind === 'quick' ? 760 : 1280, height: kind === 'quick' ? 700 : 800, minWidth: kind === 'quick' ? 600 : 1000, minHeight: 500, show: false, frame: false,
          icon: join(directory, '../../resources/icon.png'), backgroundColor: '#f9f9f9', title: kind === 'quick' ? 'Pi Desktop · Quick chat' : 'Pi Desktop',
          webPreferences: { preload: join(directory, '../preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
        });
        const record = controller!.windowRecord(key);
        const maximized = record?.maximized;
        controller!.windows.register(target, key, kind, threadId);
        configureWindow(target, false, false);
        // Windows maximize() also shows the window; defer it until ownership commits.
        restoreBounds(target, record ? { ...record, maximized: false } : undefined);
        target.once('show', () => { if (maximized) target.maximize(); });
        try { await loadWindow(target); return target; }
        catch (error) { controller!.closeWindow(target, false); target.destroy(); throw error; }
      };
      controller.quickShortcut.update(controller.store.data.settings);
      // Only an explicitly started main-app recording can access the microphone.
      const desktopSession = window.webContents.session;
      const appPermission = (contents: Electron.WebContents | null, mainFrame: boolean) => !!contents && mainFrame && [...controller!.windows.entries.values()].some(entry => entry.window.webContents === contents);
      const passivePermissions = new Set(['clipboard-read', 'clipboard-sanitized-write', 'deprecated-sync-clipboard-read', 'notifications', 'local-fonts', 'speaker-selection']);
      desktopSession.setPermissionCheckHandler((contents, permission, _origin, details) => appPermission(contents, details.isMainFrame) && (permission === 'media' ? details.mediaType === 'audio' && controller!.voice.allowsMicrophone(contents!.id) : passivePermissions.has(permission)));
      desktopSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(appPermission(contents, details.isMainFrame) && (permission === 'media' ? 'mediaTypes' in details && !!details.mediaTypes?.length && details.mediaTypes.every(type => type === 'audio') && controller!.voice.allowsMicrophone(contents.id) : passivePermissions.has(permission))));
      ipcMain.handle('desktop:request', async (event, raw: unknown) => {
        const source = BrowserWindow.fromWebContents(event.sender);
        if (!source || !controller?.windows.entries.has(source.id) || event.senderFrame !== source.webContents.mainFrame)
          return { ok: false, error: '不允许的请求来源' };
        try {
          const request = requestSchema.parse(raw);
          assertSubtaskObserverRequest(controller!.store.data, request, controller!.terminals.list());
          const value = await controller!.handle(request, false, source);
          if (request.op === 'ui.update') updateTrayMenu();
          if (request.op === 'settings.patch' || request.op === 'settings.save') controller!.quickShortcut.update(controller!.store.data.settings);
          return { ok: true, value: JSON.parse(JSON.stringify(value ?? null)) };
        } catch (error) {
          void log(error);
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      });
      configureWindow(window, true);
      restoreBounds(window, controller.windowRecord('main'));
      const icon = nativeImage.createFromPath(join(directory, '../../resources/icon.png'));
      if (!icon.isEmpty()) {
        tray = new Tray(icon);
        tray.setToolTip('Pi Desktop');
        updateTrayMenu();
        tray.on('double-click', () => window?.show());
      }
      await loadWindow(window);
      await controller.restoreWindows();
    })
    .catch((error) => {
      void log(error);
      console.error(error);
      app.exit(1);
    });
}
app.on('before-quit', (event) => {
  if (quitReady) return;
  event.preventDefault();
  if (quitting) return;
  if (controller && !controller.confirmDiscardFiles()) return;
  quitting = true;
  const application = controller;
  if (!application) { quitReady = true; app.exit(0); return; }
  void (async () => {
    // Keep services and windows usable if the OS cannot stop a Git helper.
    while (true) {
      try {
        const attempts = await Promise.allSettled([application.operations.prepareShutdown(), application.gitWorkflow.prepareShutdown()]);
        const failure = attempts.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') { application.operations.resume(); application.gitWorkflow.resume(); throw failure.reason; }
        break;
      }
      catch (error) {
        await log(error);
        const locale = application.store.data.ui.locale;
        const detail = error instanceof Error ? error.message : String(error);
        const options: Electron.MessageBoxOptions = {
          type: 'error', title: translate(locale, '暂时无法退出'),
          message: translate(locale, 'Git 进程未能结束。重试停止进程，或返回应用处理后再退出。'),
          detail: detail === '无法结束 Git 进程，请检查进程状态' ? translate(locale, '无法结束 Git 进程，请检查进程状态') : detail,
          buttons: [translate(locale, '重试'), translate(locale, '返回应用')], defaultId: 1, cancelId: 1,
        };
        const answer = window && !window.isDestroyed() ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
        if (answer.response !== 0) { quitting = false; window?.show(); window?.focus(); return; }
      }
    }
    // Operations may need application cancellation to release their repository locks.
    const results = await Promise.allSettled([application.dispose(), application.gitWorkflow.dispose()]);
    for (const result of results) if (result.status === 'rejected') await log(result.reason);
    tray?.destroy(); quitReady = true; app.quit();
  })().catch(error => { quitting = false; void log(error); window?.show(); window?.focus(); });
});
app.on('window-all-closed', () => {
  // Tray mode hides the live window in its close handler. Reaching this event means it was closed.
  app.quit();
});
process.on('uncaughtException', (error) => {
  void log(error);
});
