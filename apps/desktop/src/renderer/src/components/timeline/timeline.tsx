import { localizeAppError, tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { ArrowDown } from 'lucide-react';
import { useMemo } from 'react';
import type { Thread } from '../../../../shared/contracts.ts';
import { useAutoScroll } from '../../hooks/use-auto-scroll.ts';
import { useTimelineFocus } from '../../hooks/use-timeline-focus.ts';
import { groupTurns } from '../../lib/timeline-groups.ts';
import { turnPlans } from '../../lib/turn-plans.ts';
import { useApp } from '../../state/app.tsx';
import { ApprovalCard } from './message.tsx';
import { TurnView } from './turn.tsx';
import { Welcome } from './welcome.tsx';
import { SelectionQuote } from '../composer/selection-quote.tsx';

const noPlan: Thread['plan'] = [];

export function Timeline() {
  useLocale();
  useTimelineFocus();
  const {
    thread,
    approvals,
    activeId,
    timelineRef,
    followRef,
    running,
    invoke,
    updateDraft,
    composerRef,
    threadUi, patchThread, data, selectThread,
  } = useApp();
  const items = thread?.items;
  const turns = useMemo(() => groupTurns(items ?? [], running), [items, running]);
  const plans = useMemo(() => turnPlans(thread, turns), [thread?.plan, thread?.plans, turns]);
  const waiting = useMemo(() => approvals.filter((item) => item.threadId === activeId), [approvals, activeId]);
  const { pinned, onScroll, scrollToLatest } = useAutoScroll({
    scrollRef: timelineRef,
    followRef,
    threadId: activeId,
    deps: [items, waiting],
    saved: threadUi.scroll,
    onSave: (threadId, scroll) => patchThread({ scroll }, threadId),
  });
  return (
    <div className={`timeline ${!thread?.items.length ? 'timeline-empty' : ''}`} ref={timelineRef} onScroll={onScroll}>
      <SelectionQuote key={activeId} />
      {thread?.revision && <div className="message-revision-origin"><span>{tr('此会话为消息分支')}</span><button type="button" disabled={!data.threads.some(item => item.id === thread.revision?.parentThreadId && !item.deletedAt)} onClick={() => { const parent = data.threads.find(item => item.id === thread.revision?.parentThreadId); if (parent) selectThread(parent); }}>{tr('返回原会话')}</button></div>}
      {!thread?.items.length && <Welcome />}
      {turns.map((turn, index) => (
        <TurnView
          key={turn.key}
          turn={turn}
          plan={plans.get(turn.key) ?? noPlan}
          live={index === turns.length - 1 && running}
          waiting={index === turns.length - 1 && waiting.length > 0}
        />
      ))}
      {thread?.error && (
        <div className="thread-error">
          <strong>{thread.status === 'interrupted' ? tr("上次运行已中断") : tr("任务遇到问题")}</strong>
          <p>{localizeAppError(thread.error)}</p>
          <div className="row">
            {thread.status === 'interrupted' && (
              <button
                className="primary"
                onClick={() => void invoke({ op: 'thread.resume', id: thread.id }).catch(() => {})}
              >
                {tr("恢复会话")} </button>
            )}
            <button
              onClick={() => {
                const last = thread.items.filter((item) => item.role === 'user').at(-1);
                updateDraft(thread.id, draft => ({ ...draft, text: draft.text || last?.input?.text || last?.text || tr("请继续上次任务") }));
                composerRef.current?.focus();
              }}
            >
              {tr("继续 / 重试")} </button>
          </div>
        </div>
      )}
      {waiting.map((item) => (
        <ApprovalCard key={item.id} approval={item} />
      ))}
      {thread && running && (
        <div className="working">
          <span className="status-dot" />
          {thread.status === 'waiting' ? tr("等待你的确认") : tr("Pi 正在工作…")}
        </div>
      )}
      {!pinned && (
        <div className="jump">
          <button className="jump-latest" aria-label={tr("回到最新消息")} onClick={scrollToLatest}>
            <ArrowDown size={13} />
            {tr("回到最新消息")} </button>
        </div>
      )}
    </div>
  );
}
