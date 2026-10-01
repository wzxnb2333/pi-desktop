import type { Approval, Thread } from '../shared/contracts.ts';
import type { HarnessFocusTarget, TimelineFocusTarget } from '../shared/harness-tools.ts';

export type HarnessFocusResolution =
  | { status: 'focused'; target: TimelineFocusTarget }
  | { status: 'not_focused'; reason: 'message_missing' | 'approval_missing' | 'plan_missing' | 'plan_step_missing' };

function latestMessage(thread: Thread): string | undefined {
  return thread.items.findLast(item => item.role === 'assistant')?.id ?? thread.items.findLast(item => item.role === 'user')?.id;
}

function planFor(thread: Thread): { turnKey: string; steps: Thread['plan'] } | undefined {
  const latestUser = thread.items.findLast(item => item.role === 'user')?.id;
  if (!thread.plans && thread.plan.length) return { turnKey: latestUser ?? 'prologue', steps: thread.plan };
  if (latestUser && thread.plans?.[latestUser]?.length) return { turnKey: latestUser, steps: thread.plans[latestUser] };
  const entry = [...Object.entries(thread.plans ?? {})].findLast(([, steps]) => steps.length);
  return entry ? { turnKey: entry[0], steps: entry[1] } : undefined;
}

export function resolveHarnessFocus(thread: Thread, approvals: readonly Approval[], target: HarnessFocusTarget): HarnessFocusResolution {
  if (target.kind === 'composer') return { status: 'focused', target };
  if (target.kind === 'latest') {
    const id = latestMessage(thread);
    return id ? { status: 'focused', target: { kind: 'message', id } } : { status: 'not_focused', reason: 'message_missing' };
  }
  if (target.kind === 'message') {
    return thread.items.some(item => item.id === target.messageId)
      ? { status: 'focused', target: { kind: 'message', id: target.messageId } }
      : { status: 'not_focused', reason: 'message_missing' };
  }
  if (target.kind === 'approval') {
    const approval = approvals.find(item => item.threadId === thread.id && (!target.approvalId || item.id === target.approvalId));
    return approval ? { status: 'focused', target: { kind: 'approval', id: approval.id } } : { status: 'not_focused', reason: 'approval_missing' };
  }
  const plan = planFor(thread);
  if (!plan) return { status: 'not_focused', reason: 'plan_missing' };
  const step = plan.steps[target.index];
  return step ? { status: 'focused', target: { kind: 'plan', turnKey: plan.turnKey, index: target.index, text: step.text } } : { status: 'not_focused', reason: 'plan_step_missing' };
}
