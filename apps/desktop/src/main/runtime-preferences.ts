import type { Settings, Thread } from '../shared/contracts.ts';

export function shouldNotifyCompletion(settings: Settings, focused: boolean): boolean {
  return settings.notifications !== false && settings.notificationMode !== 'never' && (settings.notificationMode === 'always' || !focused);
}

export class RuntimeSleepPreference {
  private id?: number;
  private failed = false;
  private disposed = false;
  constructor(private readonly blocker: { start(type: 'prevent-app-suspension'): number; stop(id: number): boolean }, private readonly onError: (error: Error) => void) {}
  update(enabled: boolean, threads: ReadonlyArray<Pick<Thread, 'status'>>): void {
    const needed = !this.disposed && enabled && threads.some(thread => thread.status === 'running');
    if (!needed) {
      if (this.id !== undefined) this.blocker.stop(this.id);
      this.id = undefined;
      this.failed = false;
    } else if (this.id === undefined && !this.failed) {
      try { this.id = this.blocker.start('prevent-app-suspension'); }
      catch { this.failed = true; this.onError(new Error('无法启用防休眠，请重新打开此选项后重试。')); }
    }
  }
  dispose(): void { this.disposed = true; this.update(false, []); }
}
