import { tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { CircleAlert, ListChecks } from 'lucide-react';
import type { Thread } from '../../../../shared/contracts.ts';
import { activeSubtask, type Subtask } from '../../../../shared/subtasks.ts';
import { activitySummary, elapsed } from '../../lib/activity.ts';
import { conversationTarget } from '../../lib/conversation-search.ts';
import { type Turn, type TurnBlock, turnBlocks } from '../../lib/timeline-groups.ts';
import { TurnChanges } from './turn-changes.tsx';
import { ActivitySummary, Disclosure } from './disclosure.tsx';
import { Message, timeLabel } from './message.tsx';
import { useApp } from '../../state/app.tsx';
import { SubtaskLink } from '../panels/subtask-panel.tsx';
import { subtaskCreations } from '../../lib/subtask-creations.ts';

const planLabels: Record<string, string> = { get pending() { return tr("待办"); }, get in_progress() { return tr("进行中"); }, get completed() { return tr("已完成"); } };

function ProcessBlock({ block, live, creations }: { block: TurnBlock; live: boolean; creations?: ReadonlyMap<string, Subtask> }) {
  useLocale();
  if (block.kind === 'activity' && block.tools.some(item => creations?.has(item.id))) return <div className="turn-activities">
    {block.tools.map(item => {
      const record = creations?.get(item.id);
      return record ? <div key={item.id} className="turn-subagents" data-message-id={item.id}><SubtaskLink record={record} compact /></div> : <Message key={item.id} item={item} />;
    })}
  </div>;
  if (block.kind === 'activity') return <Disclosure foldKey={'group:' + block.key} summary={<ActivitySummary text={activitySummary(block.tools, live)} live={live} />} variant="group">
    {block.tools.map(item => <Message key={item.id} item={item} />)}
  </Disclosure>;
  if (block.kind === 'thinking') {
    const running = live && block.item.state === 'running' && block.completedAt === undefined;
    const duration = elapsed(block.startedAt, block.completedAt);
    return <Disclosure foldKey={'thinking:' + block.key} summary={running ? tr("正在思考") : duration ? tr("已思考 ") + duration : tr("思考过程")} variant="thinking" defaultOpen={running} busy={running}>
      <div className="thinking-preview" data-streaming={running} data-search-target={conversationTarget(block.key, 'thinking')} tabIndex={-1}>{block.text}</div>
    </Disclosure>;
  }
  return <div className={block.kind === 'notice' ? 'turn-notices' : block.kind === 'answer' ? 'turn-answer' : 'turn-prose'}>
    {block.items.map(item => <Message key={item.id} item={item} searchTarget={conversationTarget(block.key, 'text:' + item.id)} />)}
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
  const duration = elapsed(firstStart, end);
  const cancelled = entries.some(item => item.stopReason === 'aborted');
  const completed = !!turn.result && !live && !activeChildren && !waiting && !cancelled && turn.state !== 'error';
  const summary = waiting ? tr("等待确认") : cancelled ? tr("已停止的过程") : turn.state === 'error' ? tr("过程遇到错误") : completed ? tr("已完成过程") + (duration ? ' · ' + duration : '') : tr("处理过程");
  const showPlan = plan.length > 0;
  return <section className={'turn ' + turn.state} data-turn-key={turn.key}>
    {turn.user && <Message item={turn.user} searchTarget={conversationTarget(turn.user.id, 'text')} />}
    {(turn.entries.length > 0 || live) && <div className="turn-head"><span className="pi-mini">π</span><strong>Pi</strong>
      {live && <span className="turn-live"><span className="status-dot" />{tr("正在工作")}</span>}
      {turn.state === 'error' && <span className="turn-live error"><CircleAlert size={12} />{tr("出错")}</span>}
      <time>{timeLabel(turn.result?.timestamp ?? turn.startedAt)}</time>
    </div>}
    <div className="turn-body">
      {(process.length > 0 || delegated.length > 0) && <Disclosure foldKey={'process:' + turn.key} summary={summary} variant="process" defaultOpen={!completed} forceOpen={activeChildren || (live && delegated.length > 0) || waiting || cancelled || turn.state === 'error'} accessory={completed && tools.length ? <span className="process-count">{tools.length}  {tr("个操作")}</span> : undefined}>
        {process.map(block => <ProcessBlock key={block.key} block={block} live={live && block === process.at(-1)} creations={creations} />)}
        {!!unattached.length && <div className="turn-subagents" aria-label={tr('已创建的子智能体')}>{unattached.map(record => <SubtaskLink key={record.id} record={record} compact />)}</div>}
      </Disclosure>}
      {completedBlocks.map(block => <ProcessBlock key={block.key} block={block} live={false} />)}
      <TurnChanges turn={turn} />
      {showPlan && <Disclosure foldKey={'plan:' + turn.key} defaultOpen={false} icon={<ListChecks size={16} />} summary={<span>{tr("计划 ·")} {plan.filter(step => step.status === 'completed').length}/{plan.length} · {plan.find(step => step.status === 'in_progress')?.text ?? (plan.every(step => step.status === 'completed') ? tr("已完成") : tr("待执行"))}</span>} variant="plan"><ol className="turn-plan">
        {plan.map((step, index) => <li className={step.status} key={index + '-' + step.text} data-plan-step={index} data-plan-text={step.text} tabIndex={-1}><span>{index + 1}</span>{step.text}<em>{planLabels[step.status]}</em></li>)}
      </ol></Disclosure>}
    </div>
  </section>;
}
