import type { Thread } from '../shared/contracts.ts';

/** Immutable visible context; no fork or session mutation touches a streaming parent. */
export function captureSidechat(parent: Pick<Thread, 'id' | 'title' | 'items'>, anchorItemId?: string, now = Date.now()) {
  const anchor = anchorItemId ? parent.items.findIndex(item => item.id === anchorItemId || item.entryId === anchorItemId) : parent.items.length - 1;
  if (anchorItemId && anchor < 0) throw new Error('侧聊起点已不存在，请重新选择消息');
  const entries = parent.items.slice(0, anchor + 1).map(item => ({
    id: item.id, role: item.role, text: item.text, toolName: item.toolName, args: item.args,
    toolCalls: item.blocks?.filter(block => block.type === 'toolCall'),
    capturedWhileStreaming: item.state === 'running', timestamp: item.timestamp,
  }));
  const context = JSON.stringify(entries);
  if (context.length > 1000000) throw new Error('侧聊上下文过大，请选择较早的消息作为起点');
  return { parentThreadId: parent.id, parentTitle: parent.title, anchorItemId: parent.items[anchor]?.id ?? '', capturedAt: now, temporary: true, context };
}
