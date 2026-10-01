import type { BrowserWindow } from 'electron';
import { uiSchema, type DesktopData, type UiState } from '../shared/contracts.ts';

export type WindowRecord = NonNullable<DesktopData['windows']>[string];
export type WindowEntry = { key: string; kind: WindowRecord['kind']; window: BrowserWindow; dirty: boolean };

/** Main-process ownership: renderer navigation cannot create a second editable task view. */
export class WindowState {
  readonly entries = new Map<number, WindowEntry>();
  private readonly transfers = new Set<string>();
  constructor(private readonly data: () => DesktopData) {}
  register(window: BrowserWindow, key: string, kind: WindowRecord['kind'], activeThreadId?: string): void {
    this.entries.set(window.id, { key, kind, window, dirty: false });
    const data = this.data();
    data.windows ??= {};
    if (!data.windows[key]) data.windows[key] = { kind, open: true, frame: this.frame(uiSchema.parse({ sidebarOpen: kind === 'main', summaryOpen: kind === 'main' ? undefined : false })) };
    data.windows[key].open = true;
    if (activeThreadId !== undefined) this.setFrame(window, { ...this.ui(window), activeThreadId, view: 'thread' });
    const ui = this.ui(window);
    this.setFrame(window, ui);
    if (ui.activeThreadId && this.owner(ui.activeThreadId, window)) this.setFrame(window, { ...ui, activeThreadId: '' });
  }
  private frame(ui: UiState): WindowRecord['frame'] {
    const { threads: _threads, locale: _locale, ...frame } = ui;
    return frame;
  }
  entry(window: BrowserWindow): WindowEntry {
    const entry = this.entries.get(window.id);
    if (!entry) throw new Error('窗口已关闭');
    return entry;
  }
  ui(window: BrowserWindow): UiState {
    const data = this.data();
    const entry = this.entry(window);
    const ui = entry.kind === 'main' ? data.ui : uiSchema.parse({ ...data.windows?.[entry.key]?.frame, locale: data.ui.locale, threads: data.ui.threads });
    let activeThreadId = ui.activeThreadId;
    const visited = new Set<string>();
    while (data.threads.some(thread => thread.id === activeThreadId && thread.subtaskId)) {
      if (visited.has(activeThreadId)) { activeThreadId = ''; break; }
      visited.add(activeThreadId);
      activeThreadId = data.subtasks.find(record => record.childThreadId === activeThreadId)?.parentThreadId ?? '';
    }
    return activeThreadId === ui.activeThreadId ? ui : { ...ui, activeThreadId };
  }
  project(window: BrowserWindow): DesktopData { return { ...this.data(), ui: this.ui(window) }; }
  setFrame(window: BrowserWindow, ui: UiState): void {
    const entry = this.entry(window);
    const data = this.data();
    data.ui.locale = ui.locale;
    if (entry.kind === 'main') data.ui = { ...ui, threads: data.ui.threads };
    data.windows![entry.key].frame = this.frame(ui);
  }
  update(window: BrowserWindow, ui: UiState): UiState {
    const owner = ui.activeThreadId && this.owner(ui.activeThreadId, window);
    if (owner) {
      this.focus(owner.window);
      ui = { ...ui, activeThreadId: this.ui(window).activeThreadId };
    }
    if (this.transfers.has(ui.activeThreadId) && this.ui(window).activeThreadId !== ui.activeThreadId)
      ui = { ...ui, activeThreadId: this.ui(window).activeThreadId };
    this.setFrame(window, ui);
    return this.ui(window);
  }
  owner(threadId: string, except?: BrowserWindow): WindowEntry | undefined {
    return [...this.entries.values()].find(entry => entry.window !== except && !entry.window.isDestroyed() && this.ui(entry.window).activeThreadId === threadId);
  }
  assertEditable(window: BrowserWindow, threadId: string): void {
    const owner = this.owner(threadId, window);
    if (owner) { this.focus(owner.window); throw new Error('此任务已在另一个窗口打开，请在该窗口继续'); }
    if (this.transfers.has(threadId) && this.ui(window).activeThreadId !== threadId) throw new Error('正在打开任务窗口，请稍后重试');
  }
  beginTransfer(threadId: string): () => void {
    if (this.transfers.has(threadId)) throw new Error('正在打开任务窗口，请稍后重试');
    this.transfers.add(threadId);
    let active = true;
    return () => { if (active) { active = false; this.transfers.delete(threadId); } };
  }
  focus(window: BrowserWindow): void {
    if (window.isDestroyed() || this.transfers.has(this.ui(window).activeThreadId)) return;
    if (window.isMinimized()) window.restore(); window.show(); window.focus();
  }
  release(window: BrowserWindow, preserveOpen = false): void {
    const entry = this.entries.get(window.id);
    if (!entry) return;
    const record = this.data().windows?.[entry.key];
    if (record) record.open = preserveOpen;
    this.entries.delete(window.id);
  }
  detach(window: BrowserWindow): void { this.setFrame(window, { ...this.ui(window), activeThreadId: '' }); }
  capture(window: BrowserWindow): void {
    const record = this.data().windows?.[this.entry(window).key];
    if (record && !window.isDestroyed()) { record.bounds = window.getNormalBounds(); record.maximized = window.isMaximized(); }
  }
}
