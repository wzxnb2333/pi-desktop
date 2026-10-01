import type { DesktopData, DesktopRequest, TerminalInfo } from '../shared/contracts.ts';

/** Renderer conversations are observers. Agent tools call application services internally. */
export function assertSubtaskObserverRequest(data: DesktopData, request: DesktopRequest, terminals: readonly Pick<TerminalInfo, 'id' | 'threadId'>[] = []): void {
  const child = (id: string | undefined) => !!id && data.threads.some(thread => thread.id === id && !!thread.subtaskId);
  const target = 'threadId' in request ? request.threadId : 'id' in request && request.op.startsWith('thread.') ? request.id : 'id' in request && request.op.startsWith('terminal.') ? terminals.find(terminal => terminal.id === request.id)?.threadId : undefined;
  if (request.op.startsWith('subtask.') || child(target) || 'parentThreadId' in request && child(request.parentThreadId))
    throw new Error('子智能体由主代理管理，用户只能查看会话');
  if (request.op === 'ui.update' && child(request.frame?.activeThreadId ?? request.ui.activeThreadId))
    throw new Error('子智能体由主代理管理，请在右侧标签页查看');
}
