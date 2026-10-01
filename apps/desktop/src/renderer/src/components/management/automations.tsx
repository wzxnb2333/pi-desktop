import { localizeAppError, tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { useEffect, useRef, useState } from 'react';
import { Clock3, Plus } from 'lucide-react';
import type { Automation, AutomationRun, DesktopRequest, Thread } from '../../../../shared/contracts.ts';
import { projectDirectories } from '../../../../shared/project-directories.ts';
import { automationConfigurationKey } from '../../../../shared/automation-configuration.ts';
import { useApp } from '../../state/app.tsx';
import { Button } from '../primitives/button.tsx';
import { FieldRow } from '../primitives/field-row.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';
import { UnsavedNavigation } from '../primitives/unsaved-navigation.tsx';
import { statusText, policyLabels, permissionModes, thinkingLabels } from '../../lib/labels.ts';
import { ManagementEmpty, ManagementFilters, ManagementSearch } from './chrome.tsx';

type Draft = { id: string; base?: Automation; name: string; prompt: string; projectId: string; intervalMinutes: number;
  mode: 'interval' | 'daily' | 'weekly' | 'monthly'; time: string; timezone: string; weekday: number; monthday: number;
  destination: 'new' | 'thread'; targetThreadId: string; providerId: string; thinking: Thread['thinking'] | ''; policy: Thread['policy'] | ''; directoryId: string; environment: 'local' | 'worktree'; startPoint: string };
const initial: Draft = { id: '', name: '', prompt: '', projectId: '', intervalMinutes: 60, mode: 'interval',
  time: '09:00', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, weekday: 1, monthday: 1,
  destination: 'new', targetThreadId: '', providerId: '', thinking: '', policy: '', directoryId: '', environment: 'local', startPoint: 'HEAD' };
const runStatuses = { queued: '等待聊天空闲', preparing: '准备环境', running: '运行中', succeeded: '运行成功', failed: '运行失败', interrupted: '运行已中断', cancelled: '运行已取消' } as const;
function automationDraft(job: Automation): Draft {
  return { ...initial, id: job.id, base: structuredClone(job), name: job.name, prompt: job.prompt, projectId: job.projectId,
    intervalMinutes: job.intervalMinutes, mode: job.schedule?.kind ?? 'interval',
    destination: job.targetThreadId ? 'thread' : 'new', targetThreadId: job.targetThreadId ?? '', providerId: job.execution?.providerId ?? '', thinking: job.execution?.thinking ?? '', policy: job.execution?.policy ?? '', directoryId: job.execution?.directoryId ?? '', environment: job.execution?.environment ?? 'local', startPoint: job.execution?.startPoint ?? 'HEAD',
    ...(job.schedule ? { time: job.schedule.time, timezone: job.schedule.timezone, weekday: job.schedule.weekday, monthday: job.schedule.monthday } : {}) };
}
export function AutomationsPage() {
  useLocale();
  const { data, project, invoke, selectThread, registerViewGuard } = useApp();
  const [draft, setDraft] = useState(initial);
  const [editorOpen, setEditorOpen] = useState(false);
  const baseline = useRef(initial);
  const [replacement, setReplacement] = useState<Draft>();
  const [reloadDraft, setReloadDraft] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'enabled' | 'paused'>('all');
  const [history, setHistory] = useState('');
  const [feedback, setFeedback] = useState('');
  const [failed, setFailed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const pending = useRef(false);
  const [removing, setRemoving] = useState<Automation>();
  const nameInput = useRef<HTMLInputElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const focusName = useRef(false);
  const latest = data.automations.find(job => job.id === draft.id);
  const conflict = !!draft.base && (!latest || automationConfigurationKey(latest) !== automationConfigurationKey(draft.base));
  useEffect(() => {
    if (!busy && focusName.current) { focusName.current = false; (editorOpen ? nameInput.current : createButton.current)?.focus(); }
  }, [busy, feedback, editorOpen, draft]);
  const patch = (value: Partial<Draft>) => setDraft(previous => ({ ...previous, ...value }));
  const openEditor = (next: Draft) => {
    if (pending.current) return;
    if (editorOpen && draft.id === next.id) { nameInput.current?.focus(); return; }
    if (editorOpen && JSON.stringify(draft) !== JSON.stringify(baseline.current)) {
      setReplacement(next); return;
    }
    replaceEditor(next);
  };
  const replaceEditor = (next: Draft) => {
    baseline.current = next;
    setErrors({}); setFeedback(''); setFailed(false);
    setEditorOpen(true); setDraft(next); focusName.current = true;
  };
  const save = async () => {
    if (pending.current) return;
    if (conflict) { setFeedback(tr('自动化已被修改或删除，请加载最新版本后重试')); setFailed(true); return; }
    const validation: Record<string, string> = {};
    const target = data.threads.find(item => item.id === draft.targetThreadId && !item.subtaskId && !item.deletedAt && !item.archived && !item.review && !item.sidechat?.temporary);
    const projectId = draft.destination === 'thread' ? target?.projectId ?? '' : draft.projectId || project?.id || '';
    if (!draft.name.trim()) validation.name = tr("请填写名称");
    if (draft.destination === 'new' && !data.projects.some(item => item.id === projectId)) validation.project = tr("请选择有效项目");
    if (draft.destination === 'thread' && !target) validation.target = tr('请选择聊天');
    if (!draft.prompt.trim()) validation.prompt = tr("请填写任务描述");
    if (draft.mode === 'interval') {
      if (!Number.isInteger(draft.intervalMinutes) || draft.intervalMinutes < 1 || draft.intervalMinutes > 525600) validation.interval = tr("间隔必须为 1–525600 的整数分钟");
    } else {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) validation.time = tr("请选择有效时间");
      try { new Intl.DateTimeFormat('en', { timeZone: draft.timezone }).format(); } catch { validation.timezone = tr("请输入有效时区，例如 Asia/Shanghai"); }
      if (!draft.timezone.trim()) validation.timezone = tr("请填写时区");
      if (draft.mode === 'monthly' && (!Number.isInteger(draft.monthday) || draft.monthday < 1 || draft.monthday > 31)) validation.monthday = tr("日期必须为 1–31 的整数");
    }
    setErrors(validation); setFeedback(''); setFailed(false);
    if (Object.keys(validation).length) { document.getElementById('automation-' + Object.keys(validation)[0])?.focus(); return; }
    pending.current = true; setBusy('save');
    try {
      const previous = data.automations.find(job => job.id === draft.id);
      await invoke({ op: 'automation.save', base: draft.base ?? null, automation: {
        id: draft.id || crypto.randomUUID(), name: draft.name.trim(), prompt: draft.prompt,
        projectId, intervalMinutes: draft.mode === 'interval' ? draft.intervalMinutes : previous?.intervalMinutes ?? 60,
        enabled: previous?.enabled ?? true, nextRunAt: previous?.nextRunAt ?? Date.now(),
        targetThreadId: draft.destination === 'thread' ? draft.targetThreadId : undefined,
        execution: { providerId: draft.providerId || undefined, thinking: draft.thinking || undefined, policy: draft.policy || undefined, environment: draft.destination === 'new' ? draft.environment : 'local', directoryId: draft.destination === 'new' ? draft.directoryId || undefined : undefined, startPoint: draft.startPoint || 'HEAD' },
        schedule: draft.mode === 'interval' ? undefined : { kind: draft.mode, time: draft.time, timezone: draft.timezone, weekday: draft.weekday, monthday: draft.monthday },
      } });
      setFeedback((draft.id ? tr("已保存 ") : tr("已创建 ")) + draft.name);
      setDraft(initial);
      setEditorOpen(false);
      focusName.current = true;
    } catch (error) { setFeedback(localizeAppError(error instanceof Error ? error.message : String(error))); setFailed(true); }
    finally { pending.current = false; setBusy(''); }
  };
  const action = async (job: Automation, request: DesktopRequest, label: string) => {
    if (pending.current) return;
    pending.current = true; setBusy(job.id); setFeedback(''); setFailed(false);
    try {
      await invoke(request);
      setFeedback(`${job.name} · ${label}`);
      if (request.op === 'automation.save' && draft.id === job.id && draft.base && automationConfigurationKey(draft.base) === automationConfigurationKey(job)) {
        const base = structuredClone(request.automation);
        setDraft(previous => ({ ...previous, base })); baseline.current = { ...baseline.current, base };
      }
      if (request.op === 'automation.remove') {
        if (draft.id === job.id) { setDraft(initial); setErrors({}); setEditorOpen(false); }
        setHistory(previous => previous === job.id ? '' : previous);
        focusName.current = true;
      }
    } catch (error) { setFeedback(localizeAppError(error instanceof Error ? error.message : String(error))); setFailed(true); }
    finally { pending.current = false; setBusy(''); }
  };
  const field = (name: string) => ({ 'aria-invalid': errors[name] ? true : undefined, 'aria-describedby': errors[name] ? 'automation-error-' + name : undefined });
  const create = () => openEditor({ ...initial, projectId: project?.id ?? '' });
  const query = search.trim().toLocaleLowerCase();
  const visible = data.automations.filter(job => (filter === 'all' || filter === 'enabled' && job.enabled || filter === 'paused' && !job.enabled) && [job.name, job.prompt, data.projects.find(project => project.id === job.projectId)?.name ?? ''].join(' ').toLocaleLowerCase().includes(query));
  const selectedProject = data.projects.find(item => item.id === (draft.projectId || project?.id));
  const historyRows = (runs: AutomationRun[]) => [...runs].reverse().map(run => {
    const thread = data.threads.find(item => item.id === run.threadId && !item.deletedAt);
    return <div className="automation-run" key={run.id}><div className="row"><time>{new Date(run.createdAt).toLocaleString()}</time><strong>{tr(runStatuses[run.status])}</strong>
      {thread && <Button size="sm" onClick={() => selectThread(thread)}>{tr('打开运行聊天')}</Button>}
      {['queued', 'preparing', 'running'].includes(run.status) && <Button size="sm" disabled={!!busy} onClick={() => void action(run.configuration, { op: 'automation.cancel', runId: run.id }, tr('已取消此次运行'))}>{tr('取消此次运行')}</Button>}</div>
      <small>{run.configuration.name} · {run.configuration.execution?.providerId || tr('沿用聊天或默认设置')}{run.merged > 0 && ' · ' + tr('合并触发') + ' ' + run.merged}</small>
      {run.error && <p role="status">{localizeAppError(run.error)}</p>}</div>;
  });
  return <section className="management-page automations-page">
    <UnsavedNavigation register={registerViewGuard} busy={busy === 'save'} dirty={editorOpen && JSON.stringify(draft) !== JSON.stringify(baseline.current)} />
    <header className="page-heading"><h1>{tr("自动化")}</h1><p>{tr("本地计划、运行历史与任务结果。")}</p></header>
    <ManagementSearch label={tr("搜索自动化")} placeholder={tr("搜索名称、任务描述或项目")} value={search} onChange={setSearch} />
    <ManagementFilters<typeof filter> label={tr("自动化状态")} value={filter} onChange={setFilter} options={[{ value: 'all', label: tr("全部") }, { value: 'enabled', label: tr("已启用") }, { value: 'paused', label: tr("已暂停") }]} />
    <div className="automation-page-actions"><Button ref={createButton} size="sm" disabled={!!busy} aria-expanded={editorOpen} aria-controls="automation-editor" onClick={create}><Plus size={15} aria-hidden="true" />{tr("新建自动化")}</Button></div>
    {editorOpen && <form id="automation-editor" className="config-card" noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset className="automation-editor-fields" disabled={!!busy}>
      <h2>{draft.id ? tr("编辑自动化") : tr("新建自动化")}</h2>
      {conflict && <div className="form-feedback" data-error><p role="alert">{tr('此自动化已在其他窗口修改或删除；当前草稿已保留。')}</p><div className="row">
        {latest && <Button size="sm" onClick={() => setReloadDraft(true)}>{tr('加载最新自动化')}</Button>}
        <Button size="sm" onClick={() => { replaceEditor({ ...draft, id: '', base: undefined }); baseline.current = { ...initial, projectId: draft.projectId }; }}>{tr('另存为新自动化')}</Button>
      </div></div>}
      <FieldRow label={tr("名称")} htmlFor="automation-name"><input ref={nameInput} id="automation-name" {...field('name')} value={draft.name} onChange={event => patch({ name: event.target.value })} /></FieldRow>
      <FieldRow label={tr('执行位置')} htmlFor="automation-destination"><select id="automation-destination" value={draft.destination} onChange={event => patch({ destination: event.target.value as Draft['destination'], environment: 'local', directoryId: '' })}><option value="new">{tr('每次创建新任务')}</option><option value="thread">{tr('继续已有聊天')}</option></select></FieldRow>
      {draft.destination === 'thread' ? <FieldRow label={tr('目标聊天')} htmlFor="automation-target" description={tr('已有聊天会等待当前轮次结束，保留草稿和配置；自动化不能扩大该聊天的权限。')}><select id="automation-target" {...field('target')} value={draft.targetThreadId} onChange={event => patch({ targetThreadId: event.target.value })}><option value="">{tr('请选择聊天')}</option>{data.threads.filter(item => !item.subtaskId && !item.deletedAt && !item.archived && !item.review && !item.sidechat?.temporary).map(item => <option key={item.id} value={item.id}>{item.title} · {data.projects.find(project => project.id === item.projectId)?.name ?? tr('独立聊天')}</option>)}</select></FieldRow> : <FieldRow label={tr("项目")} htmlFor="automation-project"><select id="automation-project" {...field('project')} value={draft.projectId || project?.id || ''} onChange={event => patch({ projectId: event.target.value, directoryId: '' })}>
        {!data.projects.length && <option value="">{tr("请先添加项目")}</option>}
        {data.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></FieldRow>}
      <FieldRow label={tr('运行模型')} htmlFor="automation-provider"><select id="automation-provider" value={draft.providerId} onChange={event => patch({ providerId: event.target.value })}><option value="">{tr('沿用聊天或默认设置')}</option>{data.settings.providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FieldRow>
      <FieldRow label={tr('运行权限')} htmlFor="automation-policy"><select id="automation-policy" value={draft.policy} onChange={event => patch({ policy: event.target.value as Draft['policy'] })}><option value="">{tr('沿用聊天或默认设置')}</option>{draft.policy === 'deny' && <option value="deny" hidden>{policyLabels.deny}</option>}{permissionModes.map(value => <option key={value} value={value}>{policyLabels[value]}</option>)}</select></FieldRow>
      <FieldRow label={tr('自动化思考程度')} htmlFor="automation-thinking"><select id="automation-thinking" value={draft.thinking} onChange={event => patch({ thinking: event.target.value as Draft['thinking'] })}><option value="">{tr('沿用聊天或默认设置')}</option>{(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const).map(level => <option value={level} key={level}>{thinkingLabels[level]}</option>)}</select></FieldRow>
      {draft.destination === 'new' && <><FieldRow label={tr('运行目录')} htmlFor="automation-directory"><select id="automation-directory" value={draft.directoryId} onChange={event => patch({ directoryId: event.target.value })}><option value="">{tr('项目主目录')}</option>{selectedProject && projectDirectories(selectedProject).map(item => <option value={item.id} key={item.id}>{item.name} · {item.path}</option>)}</select></FieldRow>
      <FieldRow label={tr('运行环境')} htmlFor="automation-environment"><select id="automation-environment" value={draft.environment} onChange={event => patch({ environment: event.target.value as Draft['environment'] })}><option value="local">{tr('本地')}</option><option value="worktree">{tr('独立 Worktree')}</option></select></FieldRow>
      {draft.environment === 'worktree' && <FieldRow label={tr('起始分支或提交')} htmlFor="automation-start"><input id="automation-start" value={draft.startPoint} onChange={event => patch({ startPoint: event.target.value })} /></FieldRow>}</>}
      <label className="field-block" htmlFor="automation-prompt">{tr("任务描述")}<textarea id="automation-prompt" aria-label={tr('任务描述')} {...field('prompt')} rows={3} value={draft.prompt} onChange={event => patch({ prompt: event.target.value })} /></label>
      <FieldRow label={tr("计划类型")} htmlFor="automation-mode"><select id="automation-mode" value={draft.mode} onChange={event => patch({ mode: event.target.value as Draft['mode'] })}>
        <option value="interval">{tr("固定间隔")}</option><option value="daily">{tr("每天")}</option><option value="weekly">{tr("每周")}</option><option value="monthly">{tr("每月")}</option>
      </select></FieldRow>
      {draft.mode === 'interval' ? <FieldRow label={tr("间隔（分钟）")} htmlFor="automation-interval"><input id="automation-interval" {...field('interval')} type="number" min={1} max={525600} step={1} value={draft.intervalMinutes} onChange={event => patch({ intervalMinutes: Number(event.target.value) })} /></FieldRow> : <>
        <FieldRow label={tr("时间")} htmlFor="automation-time"><input id="automation-time" {...field('time')} type="time" value={draft.time} onChange={event => patch({ time: event.target.value })} /></FieldRow>
        <FieldRow label={tr("时区")} htmlFor="automation-timezone" description={tr("例如 Asia/Shanghai 或 America/New_York")}><input id="automation-timezone" {...field('timezone')} value={draft.timezone} onChange={event => patch({ timezone: event.target.value })} /></FieldRow>
        {draft.mode === 'weekly' && <FieldRow label={tr("星期")} htmlFor="automation-weekday"><select id="automation-weekday" value={draft.weekday} onChange={event => patch({ weekday: Number(event.target.value) })}>{[tr("日"),tr("一"),tr("二"),tr("三"),tr("四"),tr("五"),tr("六")].map((day,index) => <option key={day} value={index}>{tr("星期")}{day}</option>)}</select></FieldRow>}
        {draft.mode === 'monthly' && <FieldRow label={tr("日期")} htmlFor="automation-monthday"><input id="automation-monthday" {...field('monthday')} type="number" min={1} max={31} step={1} value={draft.monthday} onChange={event => patch({ monthday: Number(event.target.value) })} /></FieldRow>}
      </>}
      <div className="row"><Button type="submit" variant="primary" size="sm" disabled={conflict}>{busy === 'save' ? tr("正在保存…") : draft.id ? tr("保存自动化") : tr("创建自动化")}</Button><Button size="sm" onClick={() => { setDraft(initial); setErrors({}); setEditorOpen(false); createButton.current?.focus(); }}>{draft.id ? tr("取消编辑") : tr("取消创建")}</Button></div>
      </fieldset>
      {Object.keys(errors).length > 0 && <ul className="form-feedback" data-error="true" role="alert">{Object.entries(errors).map(([name, text]) => <li id={'automation-error-' + name} key={name}>{text}</li>)}</ul>}
      <p className="hint">{tr("应用运行或托盘中执行；离线错过的运行合并为一次。夏令时重复时间只运行一次，跳过的时间顺延至首个有效分钟；不存在的月度日期使用月末。")}</p>
      <p className="hint">{tr('修改仅用于后续触发；已经排队的运行保留触发时的配置。')}</p>
    </form>}
    <p className="form-feedback" data-error={failed || undefined} role="status">{feedback}</p>
    <div className="field-stack">{visible.map(job => {
      const threads = data.threads.filter(thread => thread.automationId === job.id && !thread.automationRunId && !thread.deletedAt).sort((a, b) => b.createdAt - a.createdAt);
      const runs = data.automationRuns.filter(run => run.automationId === job.id);
      const running = runs.some(run => ['queued', 'preparing', 'running'].includes(run.status)) || threads.some(thread => ['running', 'waiting'].includes(thread.status));
      return <div key={job.id} className="automation-entry" aria-busy={busy === job.id}>
      <FieldRow label={job.name} description={(job.schedule ? ({ daily: tr("每天"), weekly: tr("每周"), monthly: tr("每月") }[job.schedule.kind]) + ' ' + job.schedule.time + ' · ' + job.schedule.timezone : tr("每 ") + job.intervalMinutes + tr(" 分钟")) + ' · ' + (job.enabled ? tr("下次 ") + new Date(job.nextRunAt).toLocaleString() : tr("已暂停"))}>
        <Button size="sm" disabled={!!busy} onClick={() => openEditor(automationDraft(job))}>{tr("编辑")}</Button>
        <Button size="sm" aria-expanded={history === job.id} aria-controls={'automation-history-' + job.id} onClick={() => setHistory(history === job.id ? '' : job.id)}>{tr("运行历史")}</Button>
        <Button size="sm" disabled={!!busy || running} onClick={() => void action(job, { op: 'automation.run', id: job.id }, tr("已请求运行"))}>{running ? tr("运行中") : tr("运行")}</Button>
        <Button size="sm" disabled={!!busy} onClick={() => void action(job, { op: 'automation.save', base: job, automation: { ...job, enabled: !job.enabled } }, job.enabled ? tr("已暂停计划；已开始的任务继续运行") : tr("已启用计划"))}>{job.enabled ? tr("暂停") : tr("启用")}</Button>
        <Button size="sm" disabled={!!busy} variant="danger" aria-label={tr("删除 ") + job.name} onClick={() => setRemoving(job)}>{tr("删除")}</Button>
      </FieldRow>
      {history === job.id && <div className="automation-history" id={'automation-history-' + job.id} role="region" aria-label={job.name + tr("运行历史")}>{!threads.length && !runs.length && <p className="hint">{tr("尚无运行记录")}</p>}{historyRows(runs)}{threads.map(thread => <div key={thread.id} className="row"><Button size="sm" onClick={() => selectThread(thread)}>{new Date(thread.createdAt).toLocaleString()} · {statusText[thread.status]}</Button>{thread.status === 'error' && <Button size="sm" disabled={!!busy || running} onClick={() => void action(job, { op: 'automation.run', id: job.id }, tr("已请求重新运行；原结果保留"))}>{tr("重试")}</Button>}</div>)}</div>}
    </div>; })}</div>
    {data.automationRuns.some(run => !data.automations.some(job => job.id === run.automationId)) && <details className="automation-history"><summary>{tr('已删除计划的运行记录')}</summary>{historyRows(data.automationRuns.filter(run => !data.automations.some(job => job.id === run.automationId)))}</details>}
    {!visible.length && !editorOpen && <ManagementEmpty icon={<Clock3 size={32} aria-hidden="true" />} title={query || filter !== 'all' ? tr("没有匹配的自动化") : tr("没有计划任务")} description={query || filter !== 'all' ? tr("试试其他关键词或状态。") : tr("创建计划，在指定时间检查项目并收集结果。")}>{!data.automations.length && <Button size="sm" onClick={create}>{tr("创建第一个自动化")}</Button>}</ManagementEmpty>}
    {removing && <ConfirmDialog title={tr("删除自动化“") + removing.name + '”？'} description={tr("删除后不再按计划执行；已开始的任务继续运行，已有结果仍保留在待审阅中。")} confirmLabel={tr("删除自动化")} danger onCancel={() => setRemoving(undefined)} onConfirm={() => { const job = removing; setRemoving(undefined); void action(job, { op: 'automation.remove', id: job.id, base: job }, tr("已删除计划，历史结果保留")); }} />}
    {reloadDraft && <ConfirmDialog title={tr('加载最新自动化？')} description={tr('当前未保存的草稿会被最新自动化配置替换。')} confirmLabel={tr('加载最新自动化')} cancelLabel={tr('继续编辑')} initialFocus="cancel" onCancel={() => setReloadDraft(false)} onConfirm={() => { if (latest) replaceEditor(automationDraft(latest)); setReloadDraft(false); }} />}
    {replacement && <ConfirmDialog title={tr("放弃未保存的自动化修改？")} description={tr("当前表单尚未保存。切换后这些修改会丢失。")} confirmLabel={tr("放弃修改")} cancelLabel={tr("继续编辑")} initialFocus="cancel" danger onCancel={() => setReplacement(undefined)} onConfirm={() => { replaceEditor(replacement); setReplacement(undefined); }} />}
  </section>;
}
