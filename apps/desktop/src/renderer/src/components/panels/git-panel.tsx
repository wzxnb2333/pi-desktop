import { localizeAppError, tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Columns2, FileDiff, FilePenLine, Files, GitBranch, RotateCcw, Search } from 'lucide-react';
import type { DesktopRequest, FileContent, GitInspection, GitStatus, Thread } from '../../../../shared/contracts.ts';
import { useGitQuery } from '../../hooks/use-git-query.ts';
import { gitStatusLabel } from '../../lib/git-status.ts';
import { useApp } from '../../state/app.tsx';
import { Diff } from './diff.tsx';
import type { GitRange, HunkRecoveryListing } from '../../../../shared/git-ranges.ts';
import { isGitCommitResult, type GitCommitResult } from '../../../../shared/git-results.ts';
import { diffHunks } from '../../../../shared/git-patches.ts';
import { PullRequestPanel } from './pull-requests.tsx';
import { WorktreeControls } from './worktree-controls.tsx';
import { GitProcessRecovery } from './git-process-recovery.tsx';
import { Menu } from '../primitives/menu.tsx';
export { diffHunks } from '../../../../shared/git-patches.ts';

type Action = Extract<DesktopRequest, { op: 'git.action' }>['action'];
type Commit = GitInspection['commits'][number];
interface Conflict { base: string; ours: string; theirs: string; }
interface GitJob { id: string; cancellable: boolean; preparing: boolean; cancelling?: boolean; }
interface GitControls {
  mode: 'all' | 'staged' | 'unstaged' | 'branch' | 'turn'; baseRef: string;
  message: string; commitPaths: string[]; target: string; remote: string; remoteRef: string; strategy: 'ff-only' | 'merge' | 'rebase';
  conflictPath: string; commit: Commit | null; hunk: number; hunkScope: string; filter: string; filesOpen: boolean; controlsOpen: boolean; recoveryOpen: boolean;
  comment?: { path: string; line: number; version: string; body: string };
  job?: GitJob; revision: number; feedback: { text: string; error: boolean; completed?: boolean; commit?: GitCommitResult };
}
const commitWarnings = {
  'index-changed': '提交已完成，但暂存区同时发生变化，已保留现状。请刷新核对后继续。',
  'head-changed': '提交已完成，但当前分支或 HEAD 已变化，未改动当前暂存区。请核对提交历史。',
  'index-failed': '提交已完成，但暂存区同步失败。请刷新核对，不要重复提交。',
  'cleanup-failed': '提交已完成，但部分临时文件未能清理。',
} as const;
const emptyControls: GitControls = { mode: 'all', baseRef: '', message: '', commitPaths: [], target: '', remote: 'origin', remoteRef: '', strategy: 'ff-only',
  conflictPath: '', commit: null, hunk: 0, hunkScope: '', filter: '', filesOpen: true, controlsOpen: false, recoveryOpen: false, revision: 0, feedback: { text: '', error: false } };
// Tool tabs unmount. Keep pending operations and drafts with their originating
// task/directory in this window, so hiding a panel cannot unlock another write.
const controls = new Map<string, GitControls>();
const listeners = new Set<() => void>();
const controlsFor = (id: string) => controls.get(id) ?? emptyControls;
function updateControls(id: string, patch: Partial<GitControls>): void {
  controls.set(id, { ...controlsFor(id), ...patch });
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }

function ReadState({ name, pending, error, retry }: { name: string; pending: boolean; error: string; retry(): Promise<void> }) {
  useLocale();
  if (error) return <div className="git-read-error" role="alert"><p>{name}{tr("读取失败：")}{localizeAppError(error)}</p><button onClick={() => void retry()}>{tr("重试")}{name}</button></div>;
  return pending ? <p className="git-read-status" role="status">{tr("正在读取")}{name}…</p> : null;
}

export function GitPanel({ status, refresh }: { status: GitStatus; refresh(): Promise<void> }) {
  useLocale();
  const { thread, activeId, directoryId, fileScopeId, act, selectedPath, setSelectedPath, openFileTab, setReviewTab, setText, text, diffSplit, setDiffSplit, setTerminalOpen, selectThread } = useApp();
  const { mode, baseRef, message, commitPaths, target, remote, remoteRef, strategy, job, feedback, conflictPath, commit, hunk, filter, filesOpen, controlsOpen, comment, recoveryOpen, revision } = useSyncExternalStore(subscribe, () => controlsFor(fileScopeId));
  const field = <K extends keyof GitControls>(key: K) => (value: GitControls[K] | ((previous: GitControls[K]) => GitControls[K])) => {
    updateControls(fileScopeId, { [key]: typeof value === 'function' ? value(controlsFor(fileScopeId)[key]) : value });
  };
  const setMode = field('mode'), setBaseRef = field('baseRef'), setMessage = field('message'), setCommitPaths = field('commitPaths');
  const setTarget = field('target'), setRemote = field('remote'), setRemoteRef = field('remoteRef'), setStrategy = field('strategy');
  const setFeedback = field('feedback'), setConflictPath = field('conflictPath'), setCommit = field('commit'), setHunk = field('hunk');
  const setFilter = field('filter'), setFilesOpen = field('filesOpen'), setControlsOpen = field('controlsOpen'), setComment = field('comment'), setRecoveryOpen = field('recoveryOpen');
  const busy = !!job;
  // Keep these errors in the originating panel instead of the global task notice.
  const invoke = (request: DesktopRequest) => window.desktop.invoke('threadId' in request && (request.op.startsWith('git.') || request.op === 'file.read' || request.op === 'comment.add')
    ? { ...request, directoryId: ('directoryId' in request ? request.directoryId : undefined) ?? directoryId } as DesktopRequest : request);
  const scope = useRef(fileScopeId); scope.current = fileScopeId;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const inspectionQuery = useGitQuery(status.available ? activeId : null, async () => await invoke({ op: 'git.inspect', threadId: activeId }) as GitInspection, status);
  const inspection = inspectionQuery.data;
  const comparison = mode === 'branch' || mode === 'turn';
  const rangeQuery = useGitQuery(status.available && comparison && (mode !== 'branch' || baseRef) ? JSON.stringify([activeId, mode, baseRef, selectedPath]) : null,
    async () => await invoke({ op: 'git.range', threadId: activeId, mode: mode === 'turn' ? 'turn' : 'branch', ref: baseRef, path: selectedPath }) as GitRange, status);
  const rangeFiles = comparison ? rangeQuery.data?.files ?? [] : status.files;
  const diffQuery = useGitQuery(status.available && selectedPath && !comparison ? JSON.stringify([activeId, selectedPath, mode]) : null, async () => await invoke({ op: 'git.diff', threadId: activeId, path: selectedPath, mode: mode === 'branch' || mode === 'turn' ? 'all' : mode }) as string, status);
  const conflictSelected = status.available && conflictPath === selectedPath && status.files.some(file => file.path === conflictPath && /U|AA|DD/.test(file.status));
  const conflictQuery = useGitQuery(conflictSelected ? JSON.stringify([activeId, conflictPath]) : null, async () => await invoke({ op: 'git.conflict', threadId: activeId, path: conflictPath }) as Conflict, status);
  const commitQuery = useGitQuery(status.available && commit ? JSON.stringify([activeId, commit.id]) : null, async () => await invoke({ op: 'git.show', threadId: activeId, ref: commit!.id }) as string);
  const diff = comparison ? rangeQuery.pending ? '' : rangeQuery.data?.diff ?? '' : diffQuery.pending ? '' : diffQuery.data ?? '';
  const hunks = diffHunks(diff);
  const currentHunk = Math.min(hunk, Math.max(0, hunks.length - 1));
  const selection = JSON.stringify([fileScopeId, selectedPath, mode, diff, currentHunk]);
  const currentSelection = useRef(selection); currentSelection.current = selection;
  const remoteBranches = inspection?.remoteBranches?.filter(branch => branch.remote === remote) ?? [];
  const selectedRemote = remoteBranches.find(branch => branch.ref === remoteRef);
  const trackingName = target.trim() || selectedRemote?.name || '';
  const hasConflicts = status.files.some(file => /U|AA|DD/.test(file.status));
  const directoryBusy = busy || thread?.status === 'running' || thread?.status === 'waiting';
  const visibleFiles = rangeFiles.filter(file => file.path.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));

  useEffect(() => { if (inspection) setRemote(current => inspection.remotes.includes(current) ? current : inspection.remotes[0] ?? ''); }, [inspection]);
  useEffect(() => {
    if (!inspection) return;
    const branches = inspection.remoteBranches?.filter(branch => branch.remote === remote) ?? [];
    setRemoteRef(current => branches.some(branch => branch.ref === current) ? current : branches.find(branch => branch.ref === inspection.upstream)?.ref ?? branches[0]?.ref ?? '');
  }, [inspection, remote]);
  useEffect(() => {
    const next = JSON.stringify([selectedPath, mode, baseRef]);
    if (controlsFor(fileScopeId).hunkScope !== next) updateControls(fileScopeId, { hunk: 0, hunkScope: next });
  }, [fileScopeId, selectedPath, mode, baseRef]);
  useEffect(() => { if (conflictPath !== selectedPath) setConflictPath(''); }, [conflictPath, selectedPath]);
  const recoveryQuery = useGitQuery(recoveryOpen ? fileScopeId : null, async () => await invoke({ op: 'git.recoveries', threadId: activeId }) as HunkRecoveryListing, revision);
  const recoveries = recoveryQuery.data?.records ?? [];
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  useEffect(() => { if (revision) void refreshRef.current().catch(error => setFeedback({ text: String(error), error: true })); }, [fileScopeId, revision]);

  const refreshAll = async () => {
    try { await refresh(); } catch (error) { if (mounted.current) setFeedback({ text: tr("刷新 Git 失败：") + String(error), error: true }); }
  };
  const perform = async (request: DesktopRequest, done?: (result: unknown) => void, prepare?: () => Promise<DesktopRequest | null>) => {
    if (controlsFor(fileScopeId).job) return;
    const job: GitJob = { id: request.op === 'git.action' ? request.requestId! : crypto.randomUUID(), cancellable: request.op === 'git.action', preparing: !!prepare };
    updateControls(fileScopeId, { job, feedback: { text: '', error: false } });
    const current = () => controlsFor(fileScopeId).job?.id === job.id;
    try {
      const prepared = prepare ? await prepare() : request;
      if (!prepared || !current()) return;
      updateControls(fileScopeId, { job: { ...job, preparing: false } });
      const result = await invoke(prepared);
      if (current()) { done?.(result); setFeedback(isGitCommitResult(result)
        ? { text: result.output, commit: result, error: false, completed: true }
        : { text: typeof result === 'string' && result.trim() ? result : '', error: false, completed: true }); }
    } catch (error) {
      if (current()) setFeedback({ text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      if (current()) updateControls(fileScopeId, { job: undefined, revision: controlsFor(fileScopeId).revision + 1 });
    }
  };
  const cancel = async () => {
    const current = controlsFor(fileScopeId).job;
    if (!current || current.cancelling) return;
    if (current.preparing) { updateControls(fileScopeId, { job: undefined }); return; }
    if (!current.cancellable) return;
    updateControls(fileScopeId, { job: { ...current, cancelling: true }, feedback: { text: '', error: false } });
    try { await invoke({ op: 'git.cancel', threadId: activeId, requestId: current.id }); }
    catch (error) {
      if (controlsFor(fileScopeId).job?.id === current.id) updateControls(fileScopeId, { job: { ...current, cancelling: false }, feedback: { text: String(error), error: true } });
    }
  };
  const run = (action: Action, paths: string[] = [], value = target, patch?: string, startPoint?: string) => perform(
    { op: 'git.action', threadId: activeId, requestId: crypto.randomUUID(), action, paths, value, remote, strategy, patch, startPoint },
    () => {
      if (action === 'stage') setCommitPaths(previous => [...new Set([...previous, ...paths])]);
      if (action === 'commitStaged') { setCommitPaths(previous => previous.filter(path => !paths.includes(path))); if (controlsFor(fileScopeId).message === value) setMessage(''); }
      if (action === 'resolved' || action === 'abort' || action === 'continue') setConflictPath('');
    },
  );

  const activity = <>
    {busy && <p className="git-read-status" role="status">{tr('正在执行')}…</p>}
    {job && (job.cancellable || job.preparing) && <button disabled={job.cancelling} onClick={() => void cancel()}>{tr("取消 Git 操作")}</button>}
    {(feedback.text || feedback.completed) && <div className={'git-feedback' + (feedback.error ? ' error' : '')} role={feedback.error ? 'alert' : 'status'}>
      {feedback.commit && <><p>{feedback.commit.interrupted ? tr('提交已完成；后续步骤已中断。') : tr('提交已完成。')}</p><code>{feedback.commit.id}</code>
        {feedback.commit.warnings.map((warning, index) => <div className="git-read-error" role="alert" key={index}><p>{tr(commitWarnings[warning.code])}</p>{warning.detail && <pre>{warning.detail}</pre>}</div>)}</>}
      {(feedback.text || !feedback.commit) && <pre>{feedback.text ? feedback.error ? localizeAppError(feedback.text) : feedback.text : tr('操作完成')}</pre>}
      {(feedback.error || !!feedback.commit?.warnings.length) && <button onClick={() => void refreshAll()}>{tr("刷新状态")}</button>}{feedback.error && /authentication|permission denied|credential|could not read username|认证|身份验证/i.test(feedback.text) && <p>{tr("可在项目终端处理认证，再重试原操作。")}<button onClick={() => setTerminalOpen(true)}>{tr("打开项目终端")}</button></p>}</div>}
  </>;
  if (!thread) return null;
  return <><GitProcessRecovery key={fileScopeId} />
    {!status.available ? <div className="panel-empty"><p>{status.error ? localizeAppError(status.error) : tr("此项目尚未初始化 Git")}</p><button onClick={() => void refreshAll()}>{tr("重试 Git 状态")}</button>{activity}</div> : <section className="git-workbench" aria-label={tr("Git 工作台")}>
    <header className="git-review-header">
      <div className="git-review-header-row branch-row"><GitBranch size={16} aria-hidden="true" /><strong title={status.branch}>{status.branch}</strong><span className="git-upstream" title={inspection?.upstream}>{inspection ? inspection.upstream || tr("未设置上游") : ''}</span><button className="git-controls-toggle" aria-expanded={controlsOpen} aria-controls="git-controls git-more-controls" onClick={() => setControlsOpen(!controlsOpen)}>{tr("Git 操作")}</button></div>
      <div className="git-review-header-row"><Menu label={tr("差异范围")} value={mode} size="sm" align="start" className="git-range-menu"
        options={[{ value: 'all', label: tr('全部改动') }, { value: 'unstaged', label: tr('未暂存') }, { value: 'staged', label: tr('已暂存') }, { value: 'branch', label: tr('分支差异') }, { value: 'turn', label: tr('最近一轮') }]}
        onChange={value => setMode(value as typeof mode)} /><span className="git-file-count">{rangeFiles.length}  {tr("个文件")}</span><div className="git-review-view-actions"><button aria-label={diffSplit ? tr("统一视图") : tr("并排视图")} title={diffSplit ? tr("统一视图") : tr("并排视图")} onClick={() => setDiffSplit(!diffSplit)}><Columns2 size={16} aria-hidden="true" /></button><button aria-label={filesOpen ? tr("隐藏文件列表") : tr("显示文件列表")} title={filesOpen ? tr("隐藏文件列表") : tr("显示文件列表")} aria-expanded={filesOpen} aria-controls="git-review-files" onClick={() => setFilesOpen(!filesOpen)}><Files size={16} aria-hidden="true" /></button></div></div>
      {mode === 'branch' && <label className="git-field">{tr('基准分支')}<Menu label={tr('基准分支')} value={baseRef} matchTriggerWidth
        options={[
          { value: '', label: tr('选择基准分支') },
          ...(inspection?.branches ?? []).map(branch => ({ value: branch, label: branch })),
          ...(inspection?.remoteBranches ?? []).map(branch => ({ value: branch.ref, label: branch.ref })),
        ]}
        onChange={setBaseRef} /></label>}
      {mode === 'turn' && <p className="hint">{tr('本次运行开始至结束的工作区快照，包含追加消息及可能的外部修改，不代表 Pi 独占改动。')}</p>}
    </header>
    {comparison && <ReadState name={tr('范围差异')} pending={rangeQuery.pending} error={rangeQuery.error} retry={rangeQuery.reload} />}
    <ReadState name={tr("仓库信息")} pending={inspectionQuery.pending} error={inspectionQuery.error} retry={inspectionQuery.reload} />
    <div className="git-review-body">
    <div className="git-review-primary">
    <div id="git-controls" className="git-controls" hidden={!controlsOpen}>
    {controlsOpen && <PullRequestPanel key={activeId + '/' + directoryId} />}
    {controlsOpen && <WorktreeControls key={'worktree:' + activeId + '/' + directoryId} inspection={inspection ?? undefined} />}
    <details className="workbench-section"><summary>{tr("分支与远端")}</summary>
      <label className="git-field">{tr("本地分支名称或合并目标")}<span className="git-input-with-menu"><input aria-label={tr("分支名称")} value={target} onChange={event => setTarget(event.target.value)} placeholder={tr("输入分支名称")} /><Menu label={tr('分支建议')} placeholder={tr('选择')} kind="action" size="sm" value=""
        options={[
          ...(inspection?.branches ?? []).map(branch => ({ value: branch, label: branch })),
          ...(inspection?.remoteBranches ?? []).map(branch => ({ value: branch.ref, label: branch.ref })),
        ]}
        onChange={setTarget} /></span></label>
      
      <div className="workbench-actions">{([['branchCreate',tr("创建并切换")],['branchSwitch',tr("切换")],['branchDelete',tr("删除已合并分支")],['merge',tr("合并")],['rebase',tr("变基")]] as const).map(([action, label]) => <button key={action} disabled={directoryBusy || !!inspection?.operation || !target.trim()} onClick={() => void run(action)}>{label}</button>)}</div>
      <label className="git-field">{tr("远端")}<Menu label={tr('Git 远端')} value={remote} matchTriggerWidth
        options={inspection?.remotes.length ? inspection.remotes.map(name => ({ value: name, label: name })) : [{ value: '', label: tr('没有已配置的远端') }]}
        onChange={setRemote} /></label>
      <label className="git-field">{tr("远端分支")}<Menu label={tr('远端分支')} value={remoteRef} matchTriggerWidth
        options={remoteBranches.length ? remoteBranches.map(branch => ({ value: branch.ref, label: branch.ref })) : [{ value: '', label: tr('尚无远端分支，请先获取') }]}
        onChange={setRemoteRef} /></label>
      <div className="workbench-actions"><button disabled={directoryBusy || !!inspection?.operation || !selectedRemote || !trackingName} onClick={() => void run('branchTrack', [], trackingName, undefined, remoteRef)}>{tr("从远端创建跟踪分支")}</button><button disabled={directoryBusy || !selectedRemote} onClick={() => void run('upstream', [], remoteRef)}>{tr("设置上游")}</button></div>
      {selectedRemote && <p className="hint">{tr("创建并切换至")} {trackingName}{tr("，跟踪")} {remoteRef}{tr("；设置上游仅修改当前分支的跟踪关系。")}</p>}
      <label className="git-field">{tr("拉取策略")}<Menu label={tr('拉取策略')} value={strategy} matchTriggerWidth
        options={[{ value: 'ff-only', label: tr('仅快进') }, { value: 'merge', label: tr('合并') }, { value: 'rebase', label: tr('变基') }]}
        onChange={value => setStrategy(value as typeof strategy)} /></label>
      <div className="workbench-actions">{([['fetch',tr("获取")],['pull',tr("拉取")],['push',tr("推送")]] as const).map(([action,label]) => <button key={action} disabled={(action === 'fetch' ? busy : directoryBusy) || !remote || (action === 'pull' && !!inspection?.operation)} onClick={() => void run(action)}>{label}</button>)}<button onClick={() => setTerminalOpen(true)}>{tr("打开终端处理认证")}</button></div>
    </details>
    <div className="workbench-section"><textarea aria-label={tr("提交信息")} placeholder={tr("提交信息")} value={message} onChange={event => setMessage(event.target.value)} />
      <fieldset><legend>{tr("本次提交范围")}</legend>{status.files.filter(file => file.staged).map(file => <label className="commit-file" key={file.path}><input type="checkbox" aria-label={tr("提交 ") + file.path} checked={commitPaths.includes(file.path)} onChange={event => setCommitPaths(previous => event.target.checked ? [...previous, file.path] : previous.filter(path => path !== file.path))} />{file.path}</label>)}</fieldset>
      <button disabled={directoryBusy || hasConflicts || inspectionQuery.pending || !!inspectionQuery.error || !!inspection?.operation || !message.trim() || !status.files.some(file => file.staged && commitPaths.includes(file.path))} onClick={() => void run('commitStaged', status.files.filter(file => file.staged && commitPaths.includes(file.path)).map(file => file.path), message)}>{tr("提交所选暂存文件")}</button></div>
    </div>
    {inspection?.operation && <div className="git-operation-status"><strong>{inspection.operation === 'merge' ? tr("正在合并") : tr("正在变基")}</strong><button disabled={directoryBusy || hasConflicts} onClick={() => void run('continue')}>{tr("继续")}</button><button disabled={directoryBusy} onClick={() => void run('abort')}>{tr("中止")}</button></div>}
    {hasConflicts && <p className="browser-error" role="status">{tr("请先解决冲突并标记已解决，再继续或提交。")}</p>}
    {!rangeFiles.length && !rangeQuery.pending && !rangeQuery.error && <div className="git-review-empty"><FileDiff size={32} aria-hidden="true" /><p>{comparison ? tr('当前范围没有文本差异。') : tr("工作区是干净的。")}</p></div>}
    {!!rangeFiles.length && !selectedPath && <div className="git-review-empty"><FileDiff size={32} aria-hidden="true" /><p>{tr("选择要查看的文件")}</p></div>}
    {selectedPath && <><div className="file-toolbar"><span title={selectedPath}><bdi>{selectedPath}</bdi></span><button aria-label={tr("编辑文件")} title={tr("编辑文件")} onClick={() => openFileTab(selectedPath)}><FilePenLine size={14} aria-hidden="true" /></button><button aria-label={tr("恢复")} title={tr("恢复")} disabled={directoryBusy || comparison} onClick={() => void perform({ op: 'git.revert', threadId: activeId, path: selectedPath })}><RotateCcw size={14} aria-hidden="true" /></button></div>
      <div className="workbench-actions"><button disabled={!diff.trim()} onClick={() => setText(text + tr("\n请检查以下差异：\n") + (hunks[currentHunk] ?? diff))}>{tr("加入任务输入")}</button></div>
      <ReadState name={tr("文件差异")} pending={diffQuery.pending} error={diffQuery.error} retry={diffQuery.reload} />
      {!!hunks.length && <div className="workbench-actions"><button disabled={currentHunk === 0} onClick={() => setHunk(currentHunk - 1)}>{tr("上一块")}</button><span>{currentHunk + 1}/{hunks.length}</span><button disabled={currentHunk >= hunks.length - 1} onClick={() => setHunk(currentHunk + 1)}>{tr("下一块")}</button><button disabled={busy || mode === 'all' || comparison || hasConflicts} onClick={() => void run(mode === 'staged' ? 'unstageHunk' : 'stageHunk', [], '', hunks[currentHunk])}>{mode === 'staged' ? tr("取消暂存此块") : tr("暂存此块")}</button></div>}
      {conflictSelected && <section className="workbench-section git-conflict" aria-label={tr("冲突版本 ") + conflictPath}><strong>{conflictPath}</strong><ReadState name={tr("冲突版本")} pending={conflictQuery.pending} error={conflictQuery.error} retry={conflictQuery.reload} />{!conflictQuery.pending && conflictQuery.data && <>{(['base', 'ours', 'theirs'] as const).map((key, index) => <details key={key}><summary>{[tr("基准"), tr("当前版本"), tr("传入版本")][index]}</summary><pre>{conflictQuery.data![key] || tr("此版本不存在或为空")}</pre></details>)}<button onClick={() => openFileTab(selectedPath)}>{tr("编辑解决结果")}</button><button disabled={directoryBusy} onClick={() => void run('resolved', [conflictPath])}>{tr("标记已解决")}</button></>}</section>}
      {!!hunks.length && !comparison && mode !== 'staged' && <button disabled={directoryBusy || hasConflicts} title={tr('撤销前校验文件版本并保存恢复副本，不改变暂存区。')} onClick={() => {
        const request: DesktopRequest = { op: 'git.hunkRevert', threadId: activeId, path: selectedPath, patch: hunks[currentHunk], version: '', mode: mode === 'unstaged' ? 'unstaged' : 'all' };
        void perform(request, () => { setControlsOpen(true); setRecoveryOpen(true); }, async () => {
          const version = await invoke({ op: 'git.hunkVersion', threadId: activeId, path: selectedPath });
          return mounted.current && scope.current === fileScopeId && currentSelection.current === selection ? { ...request, version: version as string } : null;
        });
      }}>{tr('撤销此差异块')}</button>}
      {diff && <Diff text={hunks[currentHunk] ?? diff} split={diffSplit} onLine={busy || mode === 'staged' || comparison ? undefined : (path, line, text) => {
        void perform({ op: 'file.read', threadId: activeId, path }, result => {
          if (!mounted.current || scope.current !== fileScopeId || currentSelection.current !== selection) return;
          const file = result as FileContent;
          if (!file.version || file.content.split(/\r?\n/)[line - 1] !== text) throw new Error(tr('文件已变化，请刷新差异后添加评论'));
          setComment({ path, line, version: file.version, body: '' });
        });
      }} />}
      {comment && <form className="workbench-section" onSubmit={event => { event.preventDefault(); const submitted = comment; void perform({ op: 'comment.add', threadId: activeId, directoryId, ...submitted, endLine: submitted.line }, () => { if (controlsFor(fileScopeId).comment === submitted) setComment(undefined); }); }}>
        <label>{tr('行评论')} · {comment.path}:{comment.line}<textarea value={comment.body} maxLength={10000} required onChange={event => setComment({ ...comment, body: event.target.value })} /></label>
        <button type="submit" disabled={busy || !comment.body.trim()}>{tr('保存评论')}</button><button type="button" onClick={() => setComment(undefined)}>{tr('取消')}</button><button type="button" onClick={() => setReviewTab('review')}>{tr('查看审查与评论')}</button>
      </form>}
      {!diffQuery.pending && !diffQuery.error && !diff && <p className="git-read-status">{tr("当前范围没有文本差异。")}</p>}
    </>}
    <div id="git-more-controls" className="git-controls" hidden={!controlsOpen}>
    <details className="workbench-section" open={recoveryOpen} onToggle={event => setRecoveryOpen(event.currentTarget.open)}><summary>{tr('差异块恢复记录')}</summary>
      <ReadState name={tr('差异块恢复记录')} pending={recoveryQuery.pending} error={recoveryQuery.error} retry={recoveryQuery.reload} />
      {!recoveryQuery.pending && !recoveryQuery.error && <>
        {!!recoveryQuery.data?.errors.length && <div className="git-read-error" role="alert"><p>{tr('部分恢复记录无法读取')}</p>{recoveryQuery.data.errors.map(error => <details key={error.id}><summary>{error.id}</summary><pre>{localizeAppError(error.message)}</pre></details>)}</div>}
        {recoveries.map(record => <div key={record.id}><p>{record.path} · {new Date(record.createdAt).toLocaleString()}</p>
          {record.error && <p className="git-read-error" role="alert">{localizeAppError(record.error)}</p>}
          {record.receiptPending && <p className="hint">{tr('文件已恢复，仅需重新保存记录状态。')}</p>}
          <button disabled={directoryBusy || !!record.error || (record.state === 'restored' && !record.receiptPending) || record.state === 'unapplied'} onClick={() => void perform({ op: 'git.hunkRestore', threadId: activeId, recoveryId: record.id })}>{record.receiptPending ? tr('完成恢复记录') : record.state === 'restored' ? tr('已恢复') : record.state === 'unapplied' ? tr('未执行撤销') : tr('恢复撤销前版本')}</button>
        </div>)}
        <button disabled={busy} onClick={() => void recoveryQuery.reload()}>{tr('刷新恢复记录')}</button>
      </>}
    </details>
    <details className="workbench-section"><summary>{tr("提交历史")}</summary>{inspection?.commits.map(item => <button className="file-tree-row git-commit-row" key={item.id} data-commit-id={item.id} aria-pressed={commit?.id === item.id} onClick={() => setCommit(item)}><span>{item.id.slice(0, 8)} {item.subject}</span><small>{item.author} · {item.date}</small></button>)}
      {!inspectionQuery.pending && !inspectionQuery.error && !inspection?.commits.length && <p className="hint">{tr("尚无提交记录。")}</p>}
      {commit && <section className="git-commit-detail" aria-label={tr("提交差异 ") + commit.subject}><strong>{commit.subject}</strong><p>{commit.id}</p><p className="hint">{tr("合并提交显示相对第一父提交的改动。")}</p><button onClick={() => { const id = commit.id; setCommit(null); document.querySelector<HTMLButtonElement>('[data-commit-id="' + id + '"]')?.focus(); }}>{tr("关闭提交差异")}</button><ReadState name={tr("提交差异")} pending={commitQuery.pending} error={commitQuery.error} retry={commitQuery.reload} />{!commitQuery.pending && commitQuery.data && <Diff text={commitQuery.data} split={diffSplit} />}{!commitQuery.pending && !commitQuery.error && !commitQuery.data && <p className="hint">{tr("此提交没有文本差异。")}</p>}</section>}
    </details>
    <details className="workbench-section"><summary>Worktrees</summary>{inspection?.worktrees.map(worktree => <div key={worktree.path}><p>{worktree.branch} · {worktree.path}</p><button onClick={() => act({ op: 'thread.inWorktree', projectId: thread.projectId, directoryId, path: worktree.path, reveal: true })}>{tr("打开目录")}</button><button disabled={busy} onClick={() => void perform({ op: 'thread.inWorktree', projectId: thread.projectId, directoryId, path: worktree.path, reveal: false }, result => { if (mounted.current && scope.current === fileScopeId) selectThread(result as Thread); })}>{tr("在此创建任务")}</button><button onClick={() => { void navigator.clipboard.writeText(worktree.path).catch(error => setFeedback({ text: String(error), error: true })); }}>{tr("复制路径")}</button><button disabled={directoryBusy || worktree.path.replace(/\\/g, '/').toLowerCase() === thread.cwd.replace(/\\/g, '/').toLowerCase()} onClick={() => void run('worktreeRemove', [], worktree.path)}>{tr("清理")}</button></div>)}<button disabled={directoryBusy} onClick={() => void perform({ op: 'thread.create', projectId: thread.projectId, directoryId, worktree: true })}>{tr("新建 Worktree 任务")}</button>{thread.worktreeBranch && <button disabled={directoryBusy} onClick={() => void perform({ op: 'git.apply', threadId: activeId })}>{tr("应用 Worktree 改动")}</button>}</details>
    </div>
    {activity}
    </div>
    {filesOpen && <aside id="git-review-files" className="git-review-files" aria-label={tr("变更文件")}>
      <div className="git-review-filter"><label><Search size={16} aria-hidden="true" /><input type="search" aria-label={tr("筛选变更文件")} placeholder={tr("筛选文件")} value={filter} onChange={event => setFilter(event.target.value)} /></label></div>
      <div className="changed-files">{visibleFiles.map(file => <div className="git-file-row" key={file.path}><button title={gitStatusLabel(file.status) + ' · ' + file.path} className={selectedPath === file.path ? 'selected' : ''} aria-pressed={selectedPath === file.path} onClick={() => { setSelectedPath(file.path); setConflictPath(''); }}>{gitStatusLabel(file.status)} {file.path}</button><button disabled={busy || comparison} aria-label={tr("暂存 ") + file.path} onClick={() => void run('stage', [file.path])}>+</button><button disabled={busy || comparison || !file.staged} aria-label={tr("取消暂存 ") + file.path} onClick={() => void run('unstage', [file.path])}>−</button>{/U|AA|DD/.test(file.status) && <button aria-label={tr("查看冲突 ") + file.path} onClick={() => { setSelectedPath(file.path); setConflictPath(file.path); }}>{tr("冲突")}</button>}</div>)}{!visibleFiles.length && <p className="hint">{status.files.length ? tr("没有匹配的文件") : tr("没有改动的文件")}</p>}</div>
    </aside>}
    </div>
  </section>}</>;
}

