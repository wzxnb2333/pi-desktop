import { contextBridge, ipcRenderer } from 'electron';
import { type DesktopBridge, desktopEventSchema, requestSchema } from '../shared/contracts.ts';

const bridge: DesktopBridge = {
  async invoke(request) {
    const reply: unknown = await ipcRenderer.invoke('desktop:request', requestSchema.parse(request));
    if (!reply || typeof reply !== 'object' || !('ok' in reply)) throw new Error('桌面服务返回了无效响应');
    const result = reply as { ok: boolean; value?: unknown; error?: string };
    if (!result.ok) throw new Error(result.error || '操作失败');
    return result.value;
  },
  onEvent(callback) {
    const listener = (_event: Electron.IpcRendererEvent, raw: unknown) => {
      const parsed = desktopEventSchema.safeParse(raw);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on('desktop:event', listener);
    return () => ipcRenderer.removeListener('desktop:event', listener);
  },
};
contextBridge.exposeInMainWorld('desktop', bridge);
