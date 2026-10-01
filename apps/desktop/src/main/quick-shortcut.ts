import { DEFAULT_GLOBAL_KEYBINDINGS } from '../shared/shortcuts.ts';
import type { Settings, ShortcutStatus } from '../shared/contracts.ts';

type Registry = { register(keys: string, callback: () => void): boolean; unregister(keys: string): void };
export class QuickShortcut {
  private value: ShortcutStatus = { requested: '', registered: '', error: '' };
  constructor(private readonly registry: Registry, private readonly open: () => void) {}
  status(): ShortcutStatus { return { ...this.value }; }
  update(settings: Settings, retry = false): ShortcutStatus {
    const requested = settings.shortcuts?.quickChat ?? DEFAULT_GLOBAL_KEYBINDINGS.quickChat.keys;
    if (requested === this.value.requested && !retry && (this.value.registered || !requested || this.value.error)) return this.status();
    if (requested === this.value.registered) { this.value = { requested, registered: requested, error: '' }; return this.status(); }
    try {
      if (requested && !this.registry.register(requested, this.open)) throw new Error('register failed');
      if (this.value.registered) this.registry.unregister(this.value.registered);
      this.value = { requested, registered: requested, error: '' };
    } catch {
      this.value = { ...this.value, requested, error: '快捷聊天快捷键注册失败；可能已被占用，请更换组合键或重试。' };
    }
    return this.status();
  }
  dispose(): void { if (this.value.registered) this.registry.unregister(this.value.registered); this.value.registered = ''; }
}
