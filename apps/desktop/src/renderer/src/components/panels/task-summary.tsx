import { localizeAppError, tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { useMemo, useState } from 'react';
import { ChevronDown, GitBranch, Link, MoreHorizontal, Network, Plug } from 'lucide-react';
import { activeSubtask } from '../../../../shared/subtasks.ts';
import { useSubtaskNavigation } from '../../hooks/use-subtask-navigation.ts';
import type { GitStatus } from '../../../../shared/contracts.ts';
import { useTaskGit } from '../../hooks/use-task-git.ts';
import { useOpenLink } from '../../hooks/use-open-link.ts';
import { gitStatusLabel } from '../../lib/git-status.ts';
import { statusText } from '../../lib/labels.ts';
import { groupTurns } from '../../lib/timeline-groups.ts';
import { turnPlans } from '../../lib/turn-plans.ts';
import { useApp } from '../../state/app.tsx';
import { Menu } from '../primitives/menu.tsx';
import { GoalControl } from './goal-panel.tsx';

const stepStatus = { get pending() { return tr("待办"); }, get in_progress() { return tr("进行中"); }, get completed() { return tr("已完成"); } };

export function TaskSummaryCard() {
  useLocale();
  const { git, pending, error, reload } = useTaskGit();
  return <aside className="task-summary-rail" aria-label={tr("摘要卡片")}><TaskSummary git={git} pending={pending} error={error} refresh={reload} /></aside>;
}

export function TaskSummary({ git, pending, error, refresh }: { git: GitStatus; pending: boolean; error: string; refresh(): Promise<void> }) {
  useLocale();
  const { thread, project, data, activeId, running, approvals, focusTimeline, setSelectedPath, setReviewTab, setReviewOpen, patchUi, act } = useApp();
  const [expanded, setExpanded] = useState(false);
  const openLink = useOpenLink();
  const openSubtask = useSubtaskNavigation();
  const latestPlan = useMemo(() => thread ? [...turnPlans(thread, groupTurns(thread.items, running))].at(-1) : undefined, [thread?.items, thread?.plan, thread?.plans, running]);
  if (!thread) return null;
  const waiting = approvals.filter(item => item.threadId === activeId);
  const children = data.subtasks.filter(record => record.parentThreadId === activeId);
  const childApprovals = approvals.filter(approval => children.some(record => record.childThreadId === approval.threadId));
  const steps = latestPlan?.[1] ?? [];
  const gitError = error || git.error;
  const sources = [...new Set(thread.sources)];
  const connections = thread.mcp?.filter(server => server.state === 'connected') ?? [];
  const openChanges = (path?: string) => { if (path) setSelectedPath(path); setReviewTab('changes'); setReviewOpen(true); };
  return <div className="task-summary" role="region" aria-label={tr("任务摘要")} data-thread-id={activeId}>
    <header className="summary-heading"><h2 title={project?.name || thread.title}>{project?.name || thread.title}</h2><Menu kind="action" label={tr("摘要操作")} value="" align="end" className="summary-menu" placeholder={<MoreHorizontal size={18} />} options={[
      { value: 'refresh', label: tr("刷新 Git"), disabled: !project }, { value: 'project', label: tr("打开项目"), disabled: !project },
      { value: 'export', label: tr("导出会话") }, { value: 'hide', label: tr("隐藏摘要") },
    ]} onChange={value => {
      if (value === 'refresh') void refresh();
      if (value === 'project') act({ op: 'file.open', threadId: activeId, path: '' });
      if (value === 'export') act({ op: 'thread.export', id: activeId, format: 'markdown' });
      if (value === 'hide') patchUi({ summaryOpen: false });
    }} /></header>
    {git.available && <button type="button" className="summary-branch" onClick={() => openChanges()} aria-label={tr("查看项目变更：") + git.branch + '，' + git.files.length + tr(" 个文件")}><GitBranch size={16} aria-hidden="true" /><strong title={git.branch}>{git.branch}</strong>{git.stats && (git.stats.added > 0 || git.stats.removed > 0) ? <span className="summary-stats" title={tr("已跟踪文件的新增和删除行数")}><span className="added">+{git.stats.added.toLocaleString()}</span><span className="removed">−{git.stats.removed.toLocaleString()}</span></span> : <span className="summary-count">{git.files.length ? git.files.length + tr(" 个文件") : tr("无变更")}</span>}</button>}
    {expanded && <div className="summary-task"><h3>{thread.title}</h3><span className={'status ' + thread.status}>{statusText[thread.status]}</span></div>}
    {thread.error && <p role="alert">{localizeAppError(thread.error)}</p>}
    <GoalControl key={thread.id} summary />
    {!!children.length && <button type="button" className="summary-subagents" onClick={() => openSubtask()} aria-label={tr('查看子智能体')}><Network size={16} aria-hidden="true" /><span>{tr('子智能体')}</span><strong aria-live="polite">{children.filter(activeSubtask).length}</strong><small>{tr('活动中')}</small></button>}
    {!!childApprovals.length && <section aria-label={tr('子智能体待处理审批')}>{childApprovals.map(approval => <button type="button" key={approval.id} className="summary-approval" onClick={() => openSubtask(children.find(record => record.childThreadId === approval.threadId)?.id)}>{tr('等待确认')} · {approval.tool}</button>)}</section>}
    {waiting.length > 0 && <section aria-label={tr("待处理审批")}><h3>{tr("待处理 ·")} {waiting.length}</h3>{waiting.map(item => <button key={item.id} type="button" className="wide-button subtle summary-approval" onClick={() => focusTimeline({ kind: 'approval', id: item.id })}>
      <span>{item.tool}  {tr("· 需要确认")}</span><small>{item.description}</small>
    </button>)}</section>}
    {steps.length > 0 && latestPlan && <section aria-label={tr("任务计划")}><h3>{tr("计划 ·")} {steps.filter(step => step.status === 'completed').length}/{steps.length}</h3>{steps.map((step, index) => (expanded || index === steps.findIndex(item => item.status === 'in_progress')) && <button type="button" className={'summary-step ' + step.status} key={index} aria-label={tr("定位计划步骤 ") + (index + 1) + '：' + step.text + ' · ' + stepStatus[step.status]} onClick={() => focusTimeline({ kind: 'plan', turnKey: latestPlan[0], index, text: step.text })}>
      <span aria-hidden="true">{step.status === 'completed' ? '✓' : step.status === 'in_progress' ? '◉' : '○'}</span> {step.text}
    </button>)}</section>}
    {(pending || gitError || expanded && git.files.length > 0) && <section aria-label={tr("项目文件变更")} aria-busy={pending}>
      <h3>{tr("文件变更")}{git.available ? ' · ' + git.files.length : ''}</h3>
      {pending && <p className="hint" role="status">{tr("正在读取 Git 变更…")}</p>}
      {gitError && <div className="summary-error" role="alert"><p>{localizeAppError(gitError)}</p><button type="button" aria-disabled={pending} onClick={() => { if (!pending) void refresh(); }}>{tr("重试读取变更")}</button></div>}
      {expanded && git.files.slice(0, 5).map(file => <button type="button" className="summary-file" key={file.path} onClick={() => openChanges(file.path)}><span className="summary-file-status">{gitStatusLabel(file.status)}</span><span>{file.path}</span></button>)}
      {expanded && git.files.length > 5 && <button type="button" className="summary-more-files" onClick={() => openChanges()}>{tr("查看全部")} {git.files.length}  {tr("个变更文件")}</button>}
      {expanded && git.files.length > 0 && <p className="hint">{tr("当前项目的工作区变更，可能包含其他任务的修改。")}</p>}
    </section>}
    {expanded && thread.artifacts.length > 0 && <section aria-label={tr("任务产物")}><h3>{tr("产物 ·")} {thread.artifacts.length}</h3>{thread.artifacts.map(path => <button type="button" className="wide-button subtle" key={path} onClick={() => openLink(encodeURIComponent(path))}>{path}</button>)}</section>}
    <section aria-label={tr("任务来源")} className="summary-sources"><h3>{tr("来源")}</h3>{(expanded ? connections : connections.slice(0, 2)).map(server => <div className="summary-source" key={server.id} title={tr("已连接的工具服务")}><Plug size={16} aria-hidden="true" /><span>{data.settings.mcpServers.find(item => item.id === server.id)?.name || server.id}</span></div>)}{(expanded ? sources : sources.slice(0, 2)).map(url => <button type="button" className="summary-source" key={url} title={url} onClick={() => openLink(url)}><Link size={16} aria-hidden="true" /><span>{url}</span></button>)}{!connections.length && !sources.length && <p className="hint">{tr("暂无外部来源")}</p>}</section>
    <button type="button" className="summary-expand" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><ChevronDown size={16} aria-hidden="true" />{expanded ? tr("收起详情") : tr("查看全部")}</button>
    {git.files.length > 0 && thread.items.length > 0 && <div className="summary-suggestion"><button type="button" onClick={() => { setReviewTab('review'); setReviewOpen(true); }}>{tr("建议审查改动")}</button><small>{tr('选择范围并主动开始审查')}</small></div>}
  </div>;
}
