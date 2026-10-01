import type { AppCommand } from '../../../shared/shortcuts.ts';

export function dispatchWorkbenchCommand(command: AppCommand) {
  window.dispatchEvent(new CustomEvent('pi:command', { detail: command }));
}
