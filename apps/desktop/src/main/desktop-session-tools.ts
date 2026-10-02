import type { DesktopData, Thread, TimelineItem } from '../shared/contracts.ts';
import { searchSessionItems, type ItemSearchMatch } from '../shared/conversation-search.ts';

/**
 * Cross-session projections for the desktop tool surface. The same visibility rule as the sidebar applies
 * (project chats only: no review children, no subagent sessions, no temporary sidechats, nothing deleted),
 * and every projection is bounded so one huge session cannot flood the model's context.
 */

export function visibleSessions(data: DesktopData): Thread[] {
  return data.threads.filter(thread => !!thread.projectId && !thread.subtaskId && !thread.review && !thread.sidechat?.temporary && !thread.deletedAt);
}

export interface SessionSummary {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  status: Thread['status'];
  updatedAt: number;
  pinned: boolean;
  archived: boolean;
  unread: boolean;
  messages: number;
}

export function sessionSummary(data: DesktopData, thread: Thread): SessionSummary {
  return {
    id: thread.id,
    title: thread.title,
    projectId: thread.projectId ?? '',
    projectName: data.projects.find(project => project.id === thread.projectId)?.name ?? '',
    status: thread.status,
    updatedAt: thread.updatedAt,
    pinned: !!thread.pinned,
    archived: !!thread.archived,
    unread: (thread.readAt ?? 0) < (thread.items.at(-1)?.timestamp ?? thread.createdAt),
    messages: thread.items.length,
  };
}

export function listSessions(data: DesktopData, filter: { projectId?: string; query?: string; pinned?: boolean; archived?: boolean; since?: number; limit?: number }): { sessions: SessionSummary[]; total: number } {
  const needle = (filter.query ?? '').trim().toLowerCase();
  const matched = visibleSessions(data)
    .filter(thread => !filter.projectId || thread.projectId === filter.projectId)
    .filter(thread => filter.pinned === undefined || !!thread.pinned === filter.pinned)
    .filter(thread => filter.archived === undefined || !!thread.archived === filter.archived)
    .filter(thread => filter.since === undefined || thread.updatedAt >= filter.since)
    .filter(thread => !needle || thread.title.toLowerCase().includes(needle))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const limit = filter.limit ?? 20;
  return { sessions: matched.slice(0, limit).map(thread => sessionSummary(data, thread)), total: matched.length };
}

export interface SessionMessage {
  id: string;
  role: TimelineItem['role'];
  timestamp: number;
  text: string;
  truncated: boolean;
}

/** Message text only: no thinking, no tool arguments, no drafts, no attachments or context references. */
export function sessionMessages(thread: Thread, filter: { roles?: ('user' | 'assistant')[]; limit?: number; offset?: number; maxChars?: number }): { title: string; projectId: string; total: number; offset: number; messages: SessionMessage[] } {
  const roles = filter.roles?.length ? filter.roles : ['user', 'assistant'];
  const eligible = thread.items.filter(item => roles.includes(item.role as 'user' | 'assistant') && (item.text ?? '').length > 0);
  const offset = filter.offset ?? 0;
  const limit = filter.limit ?? 50;
  const maxChars = filter.maxChars ?? 8000;
  const page = eligible.slice(offset, offset + limit).map(item => {
    const text = item.text ?? '';
    return { id: item.id, role: item.role, timestamp: item.timestamp, text: text.slice(0, maxChars), truncated: text.length > maxChars };
  });
  return { title: thread.title, projectId: thread.projectId ?? '', total: eligible.length, offset, messages: page };
}

export interface SessionSearchHit extends ItemSearchMatch {
  threadId: string;
  title: string;
  projectId: string;
  projectName: string;
}

export function searchSessions(data: DesktopData, filter: { query: string; projectId?: string; limit?: number }): { hits: SessionSearchHit[]; sessions: number; truncated: boolean } {
  const limit = filter.limit ?? 50;
  const hits: SessionSearchHit[] = [];
  let sessions = 0;
  for (const thread of visibleSessions(data).sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (filter.projectId && thread.projectId !== filter.projectId) continue;
    const found = searchSessionItems(thread.items, filter.query, limit - hits.length);
    if (!found.length) continue;
    sessions += 1;
    for (const hit of found) {
      hits.push({
        ...hit, threadId: thread.id, title: thread.title, projectId: thread.projectId ?? '',
        projectName: data.projects.find(project => project.id === thread.projectId)?.name ?? '',
      });
      if (hits.length >= limit) break;
    }
    if (hits.length >= limit) break;
  }
  return { hits, sessions, truncated: hits.length >= limit };
}
