import type { Thread } from './contracts.ts';

/** Browser authority belongs only to trusted, editable main tasks. */
export function browserControlAllowed(thread: Pick<Thread, 'projectId' | 'archived' | 'deletedAt' | 'subtaskId' | 'review' | 'sidechat' | 'planMode' | 'policy'>, trusted: boolean): boolean {
  return trusted && Boolean(thread.projectId) && !thread.archived && !thread.deletedAt && !thread.subtaskId && !thread.review && !thread.sidechat && !thread.planMode && thread.policy !== 'deny';
}
