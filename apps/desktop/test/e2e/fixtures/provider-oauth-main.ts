import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron';
import type { Provider } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { requestSchema } from '../../../src/shared/contracts.ts';
import { DesktopApplication } from '../../../src/main/application.ts';
import { assertSubtaskObserverRequest } from '../../../src/main/subtask-observer.ts';

interface FixtureState { refreshes: number; openedUrls: string[]; authTokens: string[] }
const fixtureState: FixtureState = { refreshes: 0, openedUrls: [], authTokens: [] };
Object.assign(globalThis, { providerOAuthFixtureState: fixtureState });

const apiBaseUrl = process.env.PI_PROVIDER_OAUTH_FIXTURE_BASE_URL;
if (!apiBaseUrl) throw new Error('Provider OAuth fixture URL is missing');
const native = builtinProviders().find(provider => provider.id === 'openrouter');
if (!native?.auth.oauth) throw new Error('SDK OpenRouter OAuth provider is missing');
const verifyUrl = new URL(apiBaseUrl).origin + '/authorize';
const provider: Provider = {
  ...native,
  auth: {
    ...native.auth,
    oauth: {
      ...native.auth.oauth,
      async login(interaction) {
        interaction.notify({ type: 'device_code', userCode: 'LOCAL-OAUTH-CODE', verificationUri: verifyUrl, expiresInSeconds: 60 });
        await interaction.prompt({ type: 'secret', message: '本地 OAuth 验收确认', placeholder: '输入继续' });
        interaction.signal.throwIfAborted();
        return { type: 'oauth', access: 'LOCAL_OAUTH_ACCESS_1', refresh: 'LOCAL_OAUTH_REFRESH_1', expires: Date.now() - 1 };
      },
      async refresh(credential) {
        fixtureState.refreshes++;
        return { ...credential, access: 'LOCAL_OAUTH_ACCESS_2', refresh: 'LOCAL_OAUTH_REFRESH_2', expires: Date.now() + 3_600_000 };
      },
      async toAuth(credential) {
        fixtureState.authTokens.push(credential.access);
        return { apiKey: credential.access, baseUrl: apiBaseUrl };
      },
    },
  },
};

const directory = dirname(fileURLToPath(import.meta.url));
const userData = process.env.PI_DESKTOP_USER_DATA;
if (userData) app.setPath('userData', userData);
app.setName('Pi Desktop OAuth Fixture');
protocol.registerSchemesAsPrivileged([{ scheme: 'pi-artifact', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
let controller: DesktopApplication | undefined;
let window: BrowserWindow | undefined;
let quitting = false;
let quitReady = false;

function observeWindow(target: BrowserWindow): void {
  target.webContents.on('render-process-gone', (_event, details) => {
    controller?.providerAuth.closeOwner(target.id);
    void log(details.reason);
    if (!quitting && !target.isDestroyed()) target.reload();
  });
  target.on('close', event => {
    controller?.providerAuth.closeOwner(target.id);
    if (quitting && !quitReady) event.preventDefault();
  });
  target.on('closed', () => {
    if (controller?.windows.entries.has(target.id)) controller.closeWindow(target, false);
  });
}

const log = async (error: unknown) => {
  const path = join(app.getPath('userData'), 'logs', 'desktop.log');
  await mkdir(dirname(path), { recursive: true });
  const message = String(error).replace(/(Bearer\s+|api[_-]?key[=:]\s*)[^\s,]+/gi, '$1[redacted]');
  await appendFile(path, `${new Date().toISOString()} ${message}\n`);
};

void app.whenReady().then(async () => {
  window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 1000, minHeight: 640, show: false, frame: false,
    webPreferences: { preload: join(directory, '../preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  controller = new DesktopApplication(window, app.getPath('userData'), join(directory, 'agent-worker.js'), () => [provider]);
  await controller.init();
  observeWindow(window);
  controller.windowFactory = async (key, kind, threadId) => {
    const target = new BrowserWindow({ width: 1280, height: 800, minWidth: 1000, minHeight: 500, show: false, frame: false,
      webPreferences: { preload: join(directory, '../preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    controller!.windows.register(target, key, kind, threadId);
    observeWindow(target);
    await target.loadURL(process.env.ELECTRON_RENDERER_URL!);
    return target;
  };
  ipcMain.handle('desktop:request', async (event, raw: unknown) => {
    const source = BrowserWindow.fromWebContents(event.sender);
    if (!source || !controller?.windows.entries.has(source.id) || event.senderFrame !== source.webContents.mainFrame)
      return { ok: false, error: '不允许的请求来源' };
    try {
      const request = requestSchema.parse(raw);
      assertSubtaskObserverRequest(controller.store.data, request, controller.terminals.list());
      const value = await controller.handle(request, false, source);
      return { ok: true, value: JSON.parse(JSON.stringify(value ?? null)) };
    } catch (error) {
      await log(error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  shell.openExternal = async url => { fixtureState.openedUrls.push(url); };
  window.once('ready-to-show', () => window?.show());
  await window.loadURL(process.env.ELECTRON_RENDERER_URL!);
}).catch(error => { void log(error); app.exit(1); });

app.on('before-quit', event => {
  if (quitReady) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  if (!controller) { quitReady = true; app.exit(0); return; }
  void controller.dispose().finally(() => { quitReady = true; app.quit(); });
});
app.on('window-all-closed', () => app.quit());
process.on('uncaughtException', error => { void log(error); });
