import { tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { ListChecks } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Thread } from '../../../../shared/contracts.ts';
import { activeSubtask, type Subtask } from '../../../../shared/subtasks.ts';
import { activitySummary, elapsed } from '../../lib/activity.ts';
import { conversationTarget } from '../../lib/conversation-search.ts';
import { type Turn, type TurnBlock, turnBlocks } from '../../lib/timeline-groups.ts';
import { TurnChanges } from './turn-changes.tsx';
import { ActivitySummary, Disclosure } from './disclosure.tsx';
import { Message } from './message.tsx';
import { useApp } from '../../state/app.tsx';
import { SubtaskLink } from '../panels/subtask-panel.tsx';
import { subtaskCreations } from '../../lib/subtask-creations.ts';

const planLabels: Record<string, string> = { get pending() { return tr("待办"); }, get in_progress() { return tr("进行中"); }, get completed() { return tr("已完成"); } };

/**
 * Further than this from the bottom counts as the reader having taken over the preview. The range is
 * wider than one streamed paragraph: a reader who lands at the bottom right as a delta arrives must
 * still count as following, even though its scroll event has not been processed yet.
 */
const THINKING_FOLLOW_RANGE = 64;

/** Ticks once a second while the turn is still running, then freezes at its recorded duration. */
function useDuration(start?: number, end?: number): string {
  const [now, setNow] = useState(() => Date.now());
  const live = start !== undefined && end === undefined;
  useEffect(() => {
    if (!live) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [live]);
  return elapsed(start, end ?? now);
}

/**
 * The streaming preview is its own scroll box. It tracks the newest line while the model thinks,
 * keeps whatever position the reader scrolls to, and re-attaches once they return to the bottom.
 */
function ThinkingPreview({ text, running, searchTarget }: { text: string; running: boolean; searchTarget?: string }) {
  const element = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  /** Last observed position: growth is not a reader scroll, a moved position is. */
  const previous = useRef(-1);
  const interacting = useRef(false);
  const gesture = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useLayoutEffect(() => {
    const node = element.current;
    if (!node || !running) return;
    // Content can outgrow one frame of corrections; re-pin unless a live gesture owns the position.
    if (following.current && !interacting.current) node.scrollTop = node.scrollHeight;
    previous.current = node.scrollTop;
  }, [text, running]);

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const begin = () => {
      interacting.current = true;
      clearTimeout(gesture.current);
      gesture.current = setTimeout(() => { interacting.current = false; }, 250);
    };
    for (const type of ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'] as const) node.addEventListener(type, begin, { passive: true });
    return () => {
      clearTimeout(gesture.current);
      interacting.current = false;
      for (const type of ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'] as const) node.removeEventListener(type, begin);
    };
  }, []);

  return <div ref={element} className="thinking-preview" data-streaming={running} data-search-target={searchTarget} tabIndex={-1}
    onScroll={event => {
      const node = event.currentTarget;
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      const moved = previous.current >= 0 && node.scrollTop !== previous.current;
      // Landing at the bottom also ends the gesture: following resumes from there.
      if (distance < THINKING_FOLLOW_RANGE) { following.current = true; interacting.current = false; clearTimeout(gesture.current); }
      else if (moved) following.current = false;
      previous.current = node.scrollTop;
    }}>{text}</div>;
}

/**
 * `actions` stays off for process narration: copy/edit/regenerate belong to the turn's answer, and
 * showing them on an interim explanation makes a still-running turn read as if it had finished.
 */
function ProcessBlock({ block, live, creations, actions = false }: { block: TurnBlock; live: boolean; creations?: ReadonlyMap<string, Subtask>; actions?: boolean }) {
  useLocale();
  if (block.kind === 'activity' && block.tools.some(item => creations?.has(item.id))) return <div className="turn-activities">
    {block.tools.map(item => {
      const record = creations?.get(item.id);
      return record ? <div key={item.id} className="turn-subagents" data-message-id={item.id}><SubtaskLink record={record} compact /></div> : <Message key={item.id} item={item} actions={actions} />;
    })}
  </div>;
  if (block.kind === 'activity') return <Disclosure foldKey={'group:' + block.key} summary={<ActivitySummary text={activitySummary(block.tools, live)} live={live} />} variant="group">
    {block.tools.map(item => <Message key={item.id} item={item} />)}
  </Disclosure>;
  if (block.kind === 'thinking') {
    const running = live && block.item.state === 'running' && block.completedAt === undefined;
    const duration = elapsed(block.startedAt, block.completedAt);
    return <Disclosure foldKey={'thinking:' + block.key} summary={running ? tr("正在思考") : duration ? tr("已思考 ") + duration : tr("思考过程")} variant="thinking" defaultOpen={running} busy={running}>
      <ThinkingPreview text={block.text} running={running} searchTarget={conversationTarget(block.key, 'thinking')} />
    </Disclosure>;
  }
  return <div className={block.kind === 'notice' ? 'turn-notices' : block.kind === 'answer' ? 'turn-answer' : 'turn-prose'}>
    {block.items.map(item => <Message key={item.id} item={item} actions={actions} searchTarget={conversationTarget(block.key, 'text:' + item.id)} />)}
  </div>;
}

export function TurnView({ turn, plan, live, waiting = false }: { turn: Turn; plan: Thread['plan']; live: boolean; waiting?: boolean }) {
  useLocale();
  const { thread, data } = useApp();
  const delegated = data.subtasks.filter(record => {
    if (record.parentThreadId !== thread?.id) return false;
    const anchor = record.parentItemId ?? thread.items.findLast(item => item.role === 'user' && item.timestamp <= record.createdAt)?.id;
    return anchor ? turn.user?.id === anchor : turn.key === 'prologue';
  });
  const blocks = turnBlocks(turn);
  const answerIndex = blocks.findIndex(block => block.kind === 'answer');
  const process = answerIndex < 0 ? blocks : blocks.slice(0, answerIndex);
  const completedBlocks = answerIndex < 0 ? [] : blocks.slice(answerIndex);
  const entries = turn.entries.flatMap(entry => entry.items);
  const tools = entries.filter(item => item.role === 'tool');
  const creations = subtaskCreations(tools, delegated);
  const attached = new Set([...creations.values()].map(record => record.id));
  const unattached = delegated.filter(record => !attached.has(record.id));
  const activeChildren = delegated.some(activeSubtask);
  const firstStart = entries.find(item => item.startedAt !== undefined)?.startedAt;
  const completedTimes = process.flatMap(block => block.kind === 'thinking' ? [block.completedAt] :
    (block.kind === 'activity' ? block.tools : block.items).filter(item => item.id !== turn.result?.id).map(item => item.completedAt))
    .filter((value): value is number => value !== undefined);
  if (turn.result?.startedAt !== undefined && turn.result.startedAt !== firstStart) completedTimes.push(turn.result.startedAt);
  const end = completedTimes.length ? Math.max(...completedTimes) : undefined;
  const duration = useDuration(firstStart, end);
  const cancelled = entries.some(item => item.stopReason === 'aborted');
  const completed = !!turn.result && !live && !activeChildren && !waiting && !cancelled && turn.state !== 'error';
  // The disclosure is the task's timer: it counts while the turn runs and freezes at its duration.
  const summary = waiting ? tr("等待确认") : cancelled ? tr("已停止的过程") : turn.state === 'error' ? tr("过程遇到错误")
    : duration ? tr("耗时 {p0}", { p0: duration }) : tr("处理过程");
  const showPlan = plan.length > 0;
  return <section className={'turn ' + turn.state} data-turn-key={turn.key}>
    {turn.user && <Message item={turn.user} searchTarget={conversationTarget(turn.user.id, 'text')} />}
    {/* Failures surface as the red notice in the process line; a separate headline row only repeated it. */}
    <div className="turn-body">
      {(process.length > 0 || delegated.length > 0) && <Disclosure foldKey={'process:' + turn.key} summary={summary} variant="process" defaultOpen={!completed} forceOpen={activeChildren || (live && delegated.length > 0) || waiting || cancelled || turn.state === 'error'} accessory={completed && tools.length ? <span className="process-count">{tools.length}  {tr("个操作")}</span> : undefined}>
        {process.map(block => <ProcessBlock key={block.key} block={block} live={live && block === process.at(-1)} creations={creations} />)}
        {!!unattached.length && <div className="turn-subagents" aria-label={tr('已创建的子智能体')}>{unattached.map(record => <SubtaskLink key={record.id} record={record} compact />)}</div>}
      </Disclosure>}
      {completedBlocks.map(block => <ProcessBlock key={block.key} block={block} live={false} actions />)}
      {/* The edit preview appears once the turn stops writing; a running turn would only show a stutter. */}
      {!live && <TurnChanges turn={turn} />}
      {showPlan && <Disclosure foldKey={'plan:' + turn.key} defaultOpen={false} icon={<ListChecks size={16} />} summary={<span>{tr("计划 ·")} {plan.filter(step => step.status === 'completed').length}/{plan.length} · {plan.find(step => step.status === 'in_progress')?.text ?? (plan.every(step => step.status === 'completed') ? tr("已完成") : tr("待执行"))}</span>} variant="plan"><ol className="turn-plan">
        {plan.map((step, index) => <li className={step.status} key={index + '-' + step.text} data-plan-step={index} data-plan-text={step.text} tabIndex={-1}><span>{index + 1}</span>{step.text}<em>{planLabels[step.status]}</em></li>)}
      </ol></Disclosure>}
    </div>
  </section>;
}
