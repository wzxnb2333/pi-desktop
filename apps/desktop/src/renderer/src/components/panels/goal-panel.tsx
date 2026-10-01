import { useEffect, useRef, useState } from 'react';
import { Target, X } from 'lucide-react';
import type { Goal, GoalDefinition } from '../../../../shared/goals.ts';
import { goalDefinitionSchema } from '../../../../shared/goals.ts';
import { localizeAppError, tr } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { useApp } from '../../state/app.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';
import { IconButton } from '../primitives/icon-button.tsx';

const statuses = { active: '自动继续', paused: '目标已暂停', blocked: '目标受阻', completed: '目标已完成' } as const;
const rounds = { running: '进行中', succeeded: '已完成', failed: '失败', interrupted: '已中断' } as const;
type Confirmation = { kind: 'clear'; goalId: string; revision: number } | { kind: 'discard' | 'reload' };

export function GoalControl({ summary = false }: { summary?: boolean }) {
  useLocale(); const { thread } = useApp(); const [open, setOpen] = useState(false);
  if (!thread || thread.review || thread.sidechat?.temporary) return null;
  const goal = thread.goal;
  return <>
    {summary ? goal && <button type="button" className={'goal-summary ' + goal.status} onClick={() => setOpen(true)}>
      <Target size={16} aria-hidden="true" /><span><strong>{tr('持续目标')} · {goal.criteria.filter(item => item.completed).length}/{goal.criteria.length}</strong><small>{tr(statuses[goal.status])}</small></span>
    </button> : <IconButton label={goal ? tr('查看持续目标') : tr('设置持续目标')} active={goal?.status === 'active'} onClick={() => setOpen(true)}><Target size={17} /></IconButton>}
    {open && <GoalPanel key={thread.id} close={() => setOpen(false)} />}
  </>;
}

export function GoalPanel({ close }: { close(): void }) {
  const { thread } = useApp();
  return thread ? <GoalPanelContent key={thread.id} close={close} /> : null;
}

function GoalPanelContent({ close }: { close(): void }) {
  useLocale(); const { thread, invoke, running } = useApp(); const goal = thread?.goal;
  const [editing, setEditing] = useState(!goal), [base, setBase] = useState<Goal | undefined>(goal);
  const [draft, setDraft] = useState<GoalDefinition>(() => goal ? { objective: goal.objective, criteria: goal.criteria.map(({ id, text }) => ({ id, text })) } : { objective: '', criteria: [{ id: crypto.randomUUID(), text: '' }] });
  const [initial, setInitial] = useState(JSON.stringify(draft)), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const pending = useRef(false), current = useRef(true);
  useEffect(() => { current.current = true; return () => { current.current = false; }; }, []);
  if (!thread) return null;
  const dirty = (editing || !goal) && JSON.stringify(draft) !== initial;
  const clearStale = confirm?.kind === 'clear' && (confirm.goalId !== goal?.id || confirm.revision !== goal?.revision);
  const reload = () => { const next = goal ? { objective: goal.objective, criteria: goal.criteria.map(({ id, text }) => ({ id, text })) } : { objective: '', criteria: [{ id: crypto.randomUUID(), text: '' }] }; setDraft(next); setInitial(JSON.stringify(next)); setBase(goal); setError(''); setEditing(true); };
  const save = async (start: boolean) => {
    if (pending.current) return;
    const parsed = goalDefinitionSchema.safeParse(draft);
    if (!parsed.success) { setError('请输入目标与至少一条验收条件'); return; }
    pending.current = true; setBusy(true); setError('');
    try { await invoke({ op: 'goal.save', threadId: thread.id, definition: parsed.data, start, expectedId: base?.id, expectedRevision: base?.revision }); if (current.current) { setInitial(JSON.stringify(draft)); setEditing(false); } }
    catch (reason) { if (current.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (current.current) { pending.current = false; setBusy(false); } }
  };
  const control = async (action: 'pause' | 'resume' | 'clear', target = goal && { id: goal.id, revision: goal.revision }) => {
    if (!target || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await invoke({ op: 'goal.control', threadId: thread.id, goalId: target.id, revision: target.revision, action }); if (current.current && action === 'clear') { setConfirm(null); close(); } }
    catch (reason) { if (current.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (current.current) { pending.current = false; setBusy(false); } }
  };
  const dismiss = () => { if (pending.current) return; if (dirty) setConfirm({ kind: 'discard' }); else close(); };
  return <>
    <ConfirmDialog title={tr('持续目标')} presentation="panel" pending={busy} confirmLabel="" onConfirm={() => {}} onCancel={dismiss} description={<section className="goal-panel" aria-label={tr('持续目标')}>
      <header><h2>{tr('持续目标')}</h2><IconButton label={tr('关闭')} size="sm" disabled={busy} onClick={dismiss}><X size={16} /></IconButton></header>
      <p className="hint">{tr('目标会在本轮结束后自动继续，直至验收完成或需要处理。不会扩大任务权限。')}</p>
      {error && confirm?.kind !== 'clear' && <p role="alert">{localizeAppError(error)}</p>}
      {editing || !goal ? <div className="goal-editor">
        <label>{tr('目标说明')}<textarea aria-label={tr('目标说明')} data-dialog-autofocus rows={3} maxLength={12000} value={draft.objective} disabled={busy} onChange={event => setDraft({ ...draft, objective: event.target.value })} /></label>
        <fieldset disabled={busy}><legend>{tr('验收条件')}</legend>{draft.criteria.map((item, index) => <div className="goal-criterion-edit" key={item.id}>
          <label><span>{index + 1}.</span><textarea aria-label={tr('验收条件') + ' ' + (index + 1)} rows={2} maxLength={2000} value={item.text} onChange={event => setDraft({ ...draft, criteria: draft.criteria.map(row => row.id === item.id ? { ...row, text: event.target.value } : row) })} /></label>
          <IconButton label={tr('删除验收条件') + ' ' + (index + 1)} size="sm" disabled={draft.criteria.length === 1} onClick={() => setDraft({ ...draft, criteria: draft.criteria.filter(row => row.id !== item.id) })}><X size={16} /></IconButton>
        </div>)}<button type="button" disabled={draft.criteria.length >= 40} onClick={() => setDraft({ ...draft, criteria: [...draft.criteria, { id: crypto.randomUUID(), text: '' }] })}>{tr('添加验收条件')}</button></fieldset>
        <p className="hint">{tr('验收条件与计划步骤分别保存。完成标记由智能体提交证据，本轮成功结束后才完成目标。')}</p>
        <footer><button type="button" disabled={busy} onClick={() => void save(false)}>{tr('保存为暂停')}</button><button type="button" className="primary" disabled={busy} onClick={() => void save(true)}>{tr('保存并开始')}</button>
          {(goal || base) && <button type="button" disabled={busy} onClick={() => dirty ? setConfirm({ kind: 'reload' }) : reload()}>{tr('重新载入目标')}</button>}</footer>
      </div> : goal && <>
        <div className="goal-heading"><strong>{tr(statuses[goal.status])}</strong><span>{tr('目标轮次')} · {goal.rounds}</span></div>
        <p className="goal-objective">{goal.objective}</p>
        {goal.reason && <p role={goal.status === 'blocked' ? 'alert' : 'status'}>{localizeAppError(goal.reason)}</p>}
        {goal.pendingRunId ? <p className="hint">{tr('当前轮次仍在执行')}</p> : running && goal.status === 'active' && <p className="hint">{tr('等待当前任务结束后继续')}</p>}
        <ol className="goal-criteria">{goal.criteria.map(item => <li key={item.id}><span>{item.completed ? '✓ ' : '○ '}{item.text}</span><small>{item.evidence || tr('尚未验证')}</small></li>)}</ol>
        <footer><button type="button" disabled={busy} onClick={reload}>{tr('修改目标')}</button>{goal.status !== 'completed' && <button type="button" disabled={busy} onClick={() => void control(goal.status === 'active' ? 'pause' : 'resume')}>{goal.status === 'active' ? tr('暂停目标') : tr('恢复目标')}</button>}<button type="button" disabled={busy} onClick={() => { setError(''); setConfirm({ kind: 'clear', goalId: goal.id, revision: goal.revision }); }}>{tr('清除目标')}</button></footer>
        {!!goal.history.length && <details><summary>{tr('目标执行记录')}</summary><ol className="goal-history">{[...goal.history].reverse().map(item => <li key={item.id}><time>{new Date(item.startedAt).toLocaleString()}</time><span>{tr(rounds[item.status])}</span>{item.summary && <p>{localizeAppError(item.summary)}</p>}</li>)}</ol></details>}
      </>}
      <p className="hint">{tr('暂停目标只停止自动续轮；停止任务会同时暂停目标。关闭窗口不会停止任务。')}</p>
      <p className="hint">{tr('连续三轮失败或没有完成新的验收项时等待处理；连续二十轮后需要主动恢复。')}</p>
    </section>} />
    {confirm && <ConfirmDialog title={confirm.kind === 'clear' ? tr('清除持续目标？') : tr('放弃未保存的目标修改？')}
      description={<>{confirm.kind === 'clear' ? tr('清除后停止自动续轮并移除目标和验收记录。会话历史与当前任务保留。') : tr('目标修改尚未保存。')}
        {confirm.kind === 'clear' && (clearStale || error) && <><br /><span role="alert">{clearStale ? tr('目标已更新，请重新读取后再操作') : localizeAppError(error)}</span></>}
      </>} danger pending={busy} confirmDisabled={clearStale} confirmLabel={confirm.kind === 'clear' ? tr('清除目标') : tr('放弃修改')}
      onCancel={() => { if (!pending.current) { setConfirm(null); setError(''); } }} onConfirm={() => {
        if (pending.current) return;
        if (confirm.kind === 'clear') { if (!clearStale) void control('clear', { id: confirm.goalId, revision: confirm.revision }); }
        else { setConfirm(null); if (confirm.kind === 'reload') reload(); else close(); }
      }} />}
  </>;
}
