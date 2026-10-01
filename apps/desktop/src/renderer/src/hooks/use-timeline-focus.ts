import { tr } from "../../../shared/localization.ts";
import type { TimelineFocusTarget as SharedTimelineFocusTarget } from '../../../shared/harness-tools.ts';
import { useEffect, useRef } from 'react';
import { useApp } from '../state/app.tsx';
import { waitForConversationLayout } from '../lib/conversation-layout.ts';

export type TimelineFocusTarget = SharedTimelineFocusTarget;
export interface TimelineFocusRequest { threadId: string; target: TimelineFocusTarget; }

/** The timeline owns navigation so closing an overlay sidebar cannot cancel its own jump. */
export function useTimelineFocus(): void {
  const app = useApp();
  const { timelineFocus: request, activeId, view, timelineRef, threadUi } = app;
  const latest = useRef(app);
  latest.current = app;
  useEffect(() => {
    if (!request) return;
    const finish = () => latest.current.finishTimelineFocus(request);
    const root = timelineRef.current;
    if (request.threadId !== activeId || view !== 'thread' || !root) { finish(); return; }
    if (request.target.kind === 'composer') {
      finish();
      const input = document.querySelector<HTMLTextAreaElement>('.composer-input:not([hidden])');
      if (input) input.focus(); else latest.current.setError(tr('输入框当前不可用，请重新打开任务。'));
      return;
    }
    const controller = new AbortController();
    const interrupt = (event: Event) => { if (!event.defaultPrevented) { controller.abort(); finish(); } };
    const wanted = request.target;
    const turn = wanted.kind === 'plan' ? [...root.querySelectorAll<HTMLElement>('[data-turn-key]')].find(node => node.dataset.turnKey === wanted.turnKey) : undefined;
    const target = wanted.kind === 'plan'
      ? [...(turn?.querySelectorAll<HTMLElement>('[data-plan-step]') ?? [])].find(node => node.dataset.planStep === String(wanted.index) && node.dataset.planText === wanted.text)
      : wanted.kind === 'message' ? [...root.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.dataset.messageId === wanted.id)
      : [...root.querySelectorAll<HTMLElement>('[data-approval-id]')].find(node => node.dataset.approvalId === wanted.id);
    if (wanted.kind === 'plan' && !target && !threadUi.folds?.['plan:' + wanted.turnKey]) {
      latest.current.patchThread({ folds: { ...(threadUi.folds ?? {}), ['plan:' + wanted.turnKey]: true } });
      return;
    }
    window.addEventListener('wheel', interrupt, { passive: true });
    window.addEventListener('pointerdown', interrupt);
    window.addEventListener('keydown', interrupt);
    void (async () => {
      const visible = target && await waitForConversationLayout(root, target, controller.signal);
      if (controller.signal.aborted) return;
      finish();
      if (!visible || !target) { latest.current.setError(tr("这条计划或审批已更新，请重新打开摘要选择。")); return; }
      latest.current.followRef.current = false;
      target.focus({ preventScroll: true });
      const planScroller = target.closest<HTMLElement>('.disclosure-plan .disclosure-content');
      if (planScroller) {
        const stepBounds = target.getBoundingClientRect();
        const planBounds = planScroller.getBoundingClientRect();
        planScroller.scrollTop += stepBounds.top - planBounds.top - (planScroller.clientHeight - stepBounds.height) / 2;
      }
      const bounds = target.getBoundingClientRect();
      const viewport = root.getBoundingClientRect();
      root.scrollTop += bounds.top - viewport.top - (root.clientHeight - bounds.height) / 2;
    })();
    return () => {
      controller.abort();
      window.removeEventListener('wheel', interrupt);
      window.removeEventListener('pointerdown', interrupt);
      window.removeEventListener('keydown', interrupt);
    };
  }, [request, activeId, view, timelineRef, threadUi]);
}
