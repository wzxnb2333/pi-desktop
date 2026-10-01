import type { Thread } from '../../../shared/contracts.ts';
import type { Turn } from './timeline-groups.ts';

/** Iterate actual conversation order, never the insertion order of the stored plan dictionary. */
export function turnPlans(thread: Pick<Thread, 'plan' | 'plans'> | undefined, turns: Turn[]): Map<string, Thread['plan']> {
  const result = new Map<string, Thread['plan']>();
  if (!thread) return result;
  for (const [index, turn] of turns.entries()) {
    const plan = thread.plans?.[turn.user?.id ?? ''] ??
      (!thread.plans && index === turns.length - 1 ? thread.plan : undefined);
    if (plan !== undefined) result.set(turn.key, plan);
  }
  return result;
}
