import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { timelineSchema, toolDetailsSchema, type TimelineItem } from '../shared/contracts.ts';
import { mergeTimelineItem } from '../shared/timeline.ts';
import { storedToolResult } from '../shared/tool-results.ts';
import { createHash } from 'node:crypto';
import { MESSAGE_INPUT_ENTRY, storedMessageInputSchema, validMessageInput } from '../shared/message-input.ts';

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}
function contentBlocks(content: unknown): NonNullable<TimelineItem['blocks']> {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((raw): NonNullable<TimelineItem['blocks']> => {
    const part = record(raw);
    if (!part) return [];
    if (part.type === 'text' && typeof part.text === 'string') return [{ type: 'text', text: part.text }];
    if (part.type === 'thinking' && typeof part.thinking === 'string') return [{ type: 'thinking', text: part.thinking }];
    if (part.type === 'image') return [{ type: 'text', text: '[图片附件]' }];
    if (part.type === 'toolCall' && typeof part.id === 'string' && typeof part.name === 'string')
      return [{ type: 'toolCall', id: part.id, name: part.name, args: JSON.stringify(part.arguments ?? {}) }];
    return [];
  });
}
function contentText(content: unknown): string {
  return contentBlocks(content).flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n');
}
export function messageItem(message: unknown, entryId?: string): TimelineItem | undefined {
  const value = record(message);
  if (!value || !['user', 'assistant', 'toolResult', 'custom'].includes(String(value.role))) return;
  if (value.role === 'custom' && value.customType === 'pi-subtask-question' && value.display === false) return;
  const blocks = contentBlocks(value.content);
  const details = value.toolName === 'edit' ? toolDetailsSchema.safeParse(value.details) : undefined;
  const stopReason = timelineSchema.shape.stopReason.safeParse(value.stopReason);
  return {
    id: typeof value.toolCallId === 'string' ? value.toolCallId : `${value.role}-${value.timestamp ?? entryId ?? 'unknown'}`,
    role: value.role === 'toolResult' ? 'tool' : value.role === 'custom' ? 'notice' : value.role as 'user' | 'assistant',
    text: typeof value.errorMessage === 'string' && value.errorMessage ? value.errorMessage : contentText(value.content),
    thinking: blocks.flatMap((part) => part.type === 'thinking' ? [part.text] : []).join('\n'),
    blocks: value.role === 'assistant' ? blocks : undefined,
    toolName: typeof value.toolName === 'string' ? value.toolName : undefined,
    stopReason: stopReason.success ? stopReason.data : undefined,
    details: details?.success ? details.data : undefined,
    toolResult: value.role === 'toolResult' ? storedToolResult(value.details, value.content) : undefined,
    state: value.isError || ['error', 'aborted'].includes(String(value.stopReason)) ? 'error' : 'done',
    timestamp: typeof value.timestamp === 'number' ? value.timestamp : 0, entryId,
  };
}
export function restoreItems(entries: { message?: unknown; id?: string; type?: string; customType?: string; data?: unknown }[]): TimelineItem[] {
  const calls = new Map<string, { name: string; args: string }>();
  const inputs = new Map(entries.flatMap(entry => {
    if (entry.type !== 'custom' || entry.customType !== MESSAGE_INPUT_ENTRY) return [];
    const result = storedMessageInputSchema.safeParse(entry.data);
    return result.success ? [[result.data.itemId, result.data] as const] : [];
  }));
  return entries.flatMap((entry) => {
    const message = record(entry.message);
    const knownCall = typeof message?.toolCallId === 'string' ? calls.get(message.toolCallId) : undefined;
    const item = messageItem(knownCall && message?.role === 'toolResult' ? { ...message, toolName: knownCall.name } : entry.message, entry.id);
    if (!item) return [];
    const input = inputs.get(item.id);
    if (item.role === 'user' && input && createHash('sha256').update(item.text).digest('hex') === input.hash && validMessageInput(item.text, input.input)) item.input = input.input;
    for (const part of item.blocks ?? []) if (part.type === 'toolCall') calls.set(part.id, part);
    const call = calls.get(item.id);
    if (item.role === 'tool' && call) { item.args = call.args; item.toolName = call.name; }
    return [item];
  });
}
export function historyItems(session: AgentSession): TimelineItem[] {
  return restoreItems(session.sessionManager.getBranch());
}
export function eventItem(event: AgentSessionEvent, previous?: TimelineItem, now = Date.now()): TimelineItem | undefined {
  if (event.type === 'message_start' || event.type === 'message_update' || event.type === 'message_end') {
    const item = messageItem(event.message);
    if (!item) return;
    if (event.type !== 'message_end') item.state = 'running';
    item.startedAt = previous?.startedAt ?? (event.type === 'message_start' ? now : undefined);
    item.completedAt = event.type === 'message_end' ? now : undefined;
    item.blocks = item.blocks?.map((block, index) => {
      if (block.type !== 'thinking') return block;
      const old = previous?.blocks?.[index];
      const startedAt = old?.type === 'thinking' ? old.startedAt : undefined;
      const completedAt = old?.type === 'thinking' ? old.completedAt : undefined;
      const delta = event.type === 'message_update' ? event.assistantMessageEvent : undefined;
      return { ...block, startedAt: startedAt ?? (delta?.type === 'thinking_start' && delta.contentIndex === index ? now : undefined),
        completedAt: completedAt ?? (delta?.type === 'thinking_end' && delta.contentIndex === index ? now : event.type === 'message_end' && startedAt !== undefined ? now : undefined) };
    });
    return mergeTimelineItem(item, previous);
  }
  if (event.type === 'tool_execution_start') return {
    id: event.toolCallId, role: 'tool', text: '', thinking: '', toolName: event.toolName,
    args: JSON.stringify(event.args, null, 2), state: 'running', timestamp: now, startedAt: now,
  };
  if (event.type === 'tool_execution_update' || event.type === 'tool_execution_end') {
    const result = event.type === 'tool_execution_end' ? event.result : event.partialResult;
    const details = event.toolName === 'edit' ? toolDetailsSchema.safeParse(result.details) : undefined;
    return mergeTimelineItem({
      id: event.toolCallId, role: 'tool', text: contentText(result.content), thinking: '', toolName: event.toolName,
      timestamp: previous?.timestamp ?? now,
      state: event.type === 'tool_execution_update' ? 'running' : event.isError ? 'error' : 'done',
      completedAt: event.type === 'tool_execution_end' ? now : undefined, details: details?.success ? details.data : undefined,
      toolResult: storedToolResult(result.details, result.content),
    }, previous);
  }
}
