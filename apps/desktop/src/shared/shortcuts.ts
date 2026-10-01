import { localizeLabel, tr } from './localization.ts';
export const DEFAULT_GLOBAL_KEYBINDINGS = { quickChat: { label: '快捷聊天（全局）', keys: 'Ctrl+Alt+Space' } } as const;
export const DEFAULT_APP_KEYBINDINGS = {
  newThread: { label: '新建任务', keys: 'Ctrl+N' },
  searchThreads: { label: '搜索任务', keys: 'Ctrl+K' },
  settings: { label: '打开设置', keys: 'Ctrl+,' },
  terminal: { label: '切换集成终端', keys: 'Ctrl+J' },
  openBrowser: { label: '打开浏览器标签', keys: 'Ctrl+T' },
  openReview: { label: '打开审查标签', keys: 'Ctrl+Shift+G' },
  commands: { label: '命令面板', keys: 'Ctrl+Shift+P' },
  find: { label: '查找当前对话', keys: 'Ctrl+F' },
  summary: { label: '任务摘要', keys: 'Ctrl+Shift+S' },
  reopen: { label: '重新打开任务标签', keys: 'Ctrl+Shift+T' },
  terminalFind: { label: '查找终端内容', keys: 'Ctrl+Shift+F' },
  terminalClear: { label: '终端清屏', keys: 'Ctrl+Shift+L' },
  terminalCopy: { label: '复制终端选中内容', keys: 'Ctrl+Shift+C' },
  closeBrowser: { label: '隐藏浏览器', keys: 'Escape' },
} as const;
// Only active inside the auxiliary pane; terminal shell input keeps its own bindings.
export const DEFAULT_PANEL_KEYBINDINGS = {
  closePanelTab: { label: '辅助栏：关闭当前标签', keys: 'Ctrl+W' },
  nextPanelTab: { label: '辅助栏：下一个标签', keys: 'Ctrl+Tab' },
  previousPanelTab: { label: '辅助栏：上一个标签', keys: 'Ctrl+Shift+Tab' },
} as const;
export type PanelCommand = keyof typeof DEFAULT_PANEL_KEYBINDINGS | 'openBrowser' | 'openReview';
export function panelCommand(event: Parameters<typeof keyboardShortcut>[0], overrides: Record<string, string> = {}): PanelCommand | undefined {
  const key = keyboardShortcut(event).toLowerCase();
  if (!key) return;
  const bindings = { openBrowser: DEFAULT_APP_KEYBINDINGS.openBrowser, openReview: DEFAULT_APP_KEYBINDINGS.openReview, ...DEFAULT_PANEL_KEYBINDINGS };
  return (Object.keys(bindings) as PanelCommand[]).find(id => (overrides[id] ?? bindings[id].keys).toLowerCase() === key);
}
// These bindings only run while focus is inside the project file tree.
export const DEFAULT_EDITOR_KEYBINDINGS = {
  filePrevious: { label: '文件树：上一项', keys: 'ArrowUp' },
  fileNext: { label: '文件树：下一项', keys: 'ArrowDown' },
  fileParent: { label: '文件树：收起或返回父目录', keys: 'ArrowLeft' },
  fileChild: { label: '文件树：展开或进入子项', keys: 'ArrowRight' },
  fileFirst: { label: '文件树：第一项', keys: 'Home' },
  fileLast: { label: '文件树：最后一项', keys: 'End' },
  fileActivate: { label: '文件树：打开或切换目录', keys: 'Enter' },
  fileToggle: { label: '文件树：打开或切换目录（空格）', keys: 'Space' },
} as const;
// Search-field actions do not intercept shell input or file-tree navigation.
export const DEFAULT_TERMINAL_KEYBINDINGS = {
  terminalFindNext: { label: '终端查找：下一处', keys: 'Enter' },
  terminalFindPrevious: { label: '终端查找：上一处', keys: 'Shift+Enter' },
  terminalFindExit: { label: '终端查找：返回终端', keys: 'Escape' },
} as const;
export const DEFAULT_BROWSER_FIND_KEYBINDINGS = {
  browserFindNext: { label: '网页查找：下一处', keys: 'Enter' },
  browserFindPrevious: { label: '网页查找：上一处', keys: 'Shift+Enter' },
  browserFindExit: { label: '网页查找：清除并返回网页', keys: 'Escape' },
} as const;
export const DEFAULT_BROWSER_ADDRESS_KEYBINDINGS = {
  browserAddressCancel: { label: '网址输入：还原当前地址', keys: 'Escape' },
  browserAddressNext: { label: '网址输入：下一条历史建议', keys: 'ArrowDown' },
  browserAddressPrevious: { label: '网址输入：上一条历史建议', keys: 'ArrowUp' },
  browserAddressChoose: { label: '网址输入：打开历史建议', keys: 'Enter' },
} as const;
export const DEFAULT_COMPOSER_KEYBINDINGS = {
  composerPrevious: { label: '输入建议：上一项', keys: 'ArrowUp' },
  composerNext: { label: '输入建议：下一项', keys: 'ArrowDown' },
  composerChoose: { label: '输入建议：选择', keys: 'Enter' },
  composerDismiss: { label: '输入建议：关闭', keys: 'Escape' },
} as const;
export const DEFAULT_KEYBINDINGS = { ...DEFAULT_GLOBAL_KEYBINDINGS, ...DEFAULT_APP_KEYBINDINGS, ...DEFAULT_PANEL_KEYBINDINGS, ...DEFAULT_EDITOR_KEYBINDINGS, ...DEFAULT_TERMINAL_KEYBINDINGS, ...DEFAULT_BROWSER_FIND_KEYBINDINGS, ...DEFAULT_BROWSER_ADDRESS_KEYBINDINGS, ...DEFAULT_COMPOSER_KEYBINDINGS };
export type BrowserCommand = keyof typeof DEFAULT_BROWSER_FIND_KEYBINDINGS | keyof typeof DEFAULT_BROWSER_ADDRESS_KEYBINDINGS;
export type TerminalCommand = keyof typeof DEFAULT_TERMINAL_KEYBINDINGS;
export type EditorCommand = keyof typeof DEFAULT_EDITOR_KEYBINDINGS;
export type AppCommand = keyof typeof DEFAULT_APP_KEYBINDINGS;
export function composerCommand(event: Parameters<typeof keyboardShortcut>[0], overrides: Record<string, string> = {}): keyof typeof DEFAULT_COMPOSER_KEYBINDINGS | undefined {
  const key = keyboardShortcut(event).toLowerCase();
  return (Object.keys(DEFAULT_COMPOSER_KEYBINDINGS) as Array<keyof typeof DEFAULT_COMPOSER_KEYBINDINGS>).find(id => (overrides[id] ?? DEFAULT_COMPOSER_KEYBINDINGS[id].keys).toLowerCase() === key);
}
export function shortcutMatchesQuery(label: string, keys: string, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  const combination = normalized.replace(/control/g, 'ctrl').replace(/\s+/g, '');
  return !normalized || label.toLocaleLowerCase().includes(normalized) || keys.toLowerCase().replace(/\s+/g, '').includes(combination);
}
export function keyboardShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>): string {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return '';
  return [event.ctrlKey ? 'Ctrl' : '', event.metaKey ? 'Meta' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key].filter(Boolean).join('+');
}
export function editorCommand(event: Parameters<typeof keyboardShortcut>[0], overrides: Record<string, string> = {}): EditorCommand | undefined {
  const key = keyboardShortcut(event).toLowerCase();
  if (!key) return;
  return (Object.keys(DEFAULT_EDITOR_KEYBINDINGS) as EditorCommand[]).find(id => (overrides[id] ?? DEFAULT_EDITOR_KEYBINDINGS[id].keys).toLowerCase() === key);
}
export function shortcutConflicts(overrides: Record<string, string> = {}): string[] {
  const conflicts = new Set<string>();
  const { closeBrowser: _browser, ...terminalGlobals } = DEFAULT_APP_KEYBINDINGS;
  for (const scope of [{ ...DEFAULT_APP_KEYBINDINGS, ...DEFAULT_PANEL_KEYBINDINGS, ...DEFAULT_EDITOR_KEYBINDINGS }, { ...terminalGlobals, ...DEFAULT_TERMINAL_KEYBINDINGS }, { ...terminalGlobals, ...DEFAULT_PANEL_KEYBINDINGS, ...DEFAULT_BROWSER_FIND_KEYBINDINGS }, { ...terminalGlobals, ...DEFAULT_PANEL_KEYBINDINGS, ...DEFAULT_BROWSER_ADDRESS_KEYBINDINGS }, { ...terminalGlobals, ...DEFAULT_COMPOSER_KEYBINDINGS }]) {
    const seen = new Map<string, string>();
    for (const [id, command] of Object.entries({ ...DEFAULT_GLOBAL_KEYBINDINGS, ...scope })) {
      const key = (overrides[id] ?? command.keys).toLowerCase();
      if (!key) continue;
      const previous = seen.get(key);
      if (previous) conflicts.add(tr('{p0} 与 {p1} 使用相同快捷键', { p0: localizeLabel(previous), p1: localizeLabel(command.label) }));
      seen.set(key, command.label);
    }
  }
  return [...conflicts];
}
export function terminalCommand(event: Parameters<typeof keyboardShortcut>[0], overrides: Record<string, string> = {}): TerminalCommand | undefined {
  const key = keyboardShortcut(event).toLowerCase();
  if (!key) return;
  return (Object.keys(DEFAULT_TERMINAL_KEYBINDINGS) as TerminalCommand[]).find(id => (overrides[id] ?? DEFAULT_TERMINAL_KEYBINDINGS[id].keys).toLowerCase() === key);
}
export function browserCommand(event: Parameters<typeof keyboardShortcut>[0], scope: 'find' | 'address', overrides: Record<string, string> = {}): BrowserCommand | undefined {
  const key = keyboardShortcut(event).toLowerCase();
  if (!key) return;
  const bindings = scope === 'find' ? DEFAULT_BROWSER_FIND_KEYBINDINGS : DEFAULT_BROWSER_ADDRESS_KEYBINDINGS;
  return (Object.entries(bindings) as Array<[BrowserCommand, { keys: string }]>).find(([id, binding]) => (overrides[id] ?? binding.keys).toLowerCase() === key)?.[0];
}
