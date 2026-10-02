import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Play } from 'lucide-react';
import { localizeAppError, localizeLabel, tr } from '../../../../shared/localization.ts';
import { projectEnvironmentSchema, type ProjectEnvironment } from '../../../../shared/project-environment.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { useApp } from '../../state/app.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';
import { Menu } from '../primitives/menu.tsx';

interface EditorState { base: ProjectEnvironment; form: ProjectEnvironment; pending: boolean; saved: boolean; error: string; }
interface RequestState { pending: boolean; cancelling: string[]; error: string; }
const emptyEnvironment = projectEnvironmentSchema.parse({});
const emptyEditor: EditorState = { base: emptyEnvironment, form: emptyEnvironment, pending: false, saved: false, error: '' };
const emptyRequest: RequestState = { pending: false, cancelling: [], error: '' };
// Project drafts and pending saves survive task navigation within this window.
const editors = new Map<string, EditorState>();
const requests = new Map<string, RequestState>();
const listeners = new Set<() => void>();
const editorFor = (id: string) => editors.get(id) ?? emptyEditor;
const requestFor = (id: string) => requests.get(id) ?? emptyRequest;
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function updateEditor(id: string, patch: Partial<EditorState>) {
  editors.set(id, { ...editorFor(id), ...patch }); for (const listener of listeners) listener();
}
function updateRequest(id: string, patch: Partial<RequestState>) {
  requests.set(id, { ...requestFor(id), ...patch }); for (const listener of listeners) listener();
}

export function ProjectActions() {
  useLocale();
  const { project, thread, directory, directoryId, fileScopeId, data, setTerminalOpen } = useApp();
  const [open, setOpen] = useState(false);
  const [reload, setReload] = useState(false);
  const projectId = project?.id ?? '';
  const { base, form, pending: saving, saved, error } = useSyncExternalStore(subscribe, () => editorFor(projectId));
  const actionState = useSyncExternalStore(subscribe, () => requestFor(fileScopeId));
  const scope = useRef(fileScopeId); scope.current = fileScopeId;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const previous = requestFor(fileScopeId).cancelling;
    const remaining = previous.filter(id => data.operations.some(item => item.id === id && item.status === 'running'));
    if (remaining.length !== previous.length) updateRequest(fileScopeId, { cancelling: remaining });
  }, [fileScopeId, data.operations]);
  if (!project || !thread) return null;
  const current = projectEnvironmentSchema.parse(project.environment ?? {});
  const related = data.operations.filter(item => item.threadId === thread.id && item.directoryId === directoryId && item.kind.startsWith('environment.'));
  const operations = related.filter((item, index) => item.status === 'running' || index >= related.length - 10).reverse();
  const dirty = JSON.stringify(base) !== JSON.stringify(form);
  const stale = JSON.stringify(base) !== JSON.stringify(current);
  const edit = (next: ProjectEnvironment) => { updateEditor(projectId, { form: next, saved: false }); setReload(false); };
  const show = () => {
    const editor = editorFor(projectId);
    if (!editor.pending && JSON.stringify(editor.base) === JSON.stringify(editor.form)) updateEditor(projectId, { base: current, form: current, error: '', saved: false });
    setOpen(true); setReload(false);
  };
  const loadLatest = () => { updateEditor(projectId, { base: current, form: current, error: '', saved: false }); setReload(false); };
  const running = (kind: string) => related.some(item => item.kind === 'environment.' + kind && item.status === 'running');
  const run = async (kind: 'initialization' | 'cleanup' | 'action', actionId = '') => {
    if (requestFor(fileScopeId).pending || running(kind + (actionId ? '.' + actionId : ''))) return;
    updateRequest(fileScopeId, { pending: true, error: '' });
    try {
      await window.desktop.invoke({ op: 'project.action', threadId: thread.id, directoryId, requestId: crypto.randomUUID(), kind, actionId });
      if (mounted.current && scope.current === fileScopeId) setTerminalOpen(true);
    } catch (error) {
      updateRequest(fileScopeId, { error: String(error) });
      if (mounted.current && scope.current === fileScopeId) show();
    } finally { updateRequest(fileScopeId, { pending: false }); }
  };
  const save = async () => {
    const editor = editorFor(projectId); if (editor.pending) return;
    setReload(false);
    const parsed = projectEnvironmentSchema.safeParse(editor.form);
    if (!parsed.success) { updateEditor(projectId, { error: '请填写有效且不重复的项目动作' }); return; }
    updateEditor(projectId, { pending: true, error: '', saved: false });
    try {
      await window.desktop.invoke({ op: 'project.environment', projectId, environment: parsed.data, base: editor.base });
      const form = editorFor(projectId).form === editor.form ? parsed.data : editorFor(projectId).form;
      updateEditor(projectId, { base: parsed.data, form, saved: JSON.stringify(form) === JSON.stringify(parsed.data) });
    } catch (error) { updateEditor(projectId, { error: String(error) }); }
    finally { updateEditor(projectId, { pending: false }); }
  };
  const cancel = async (id: string) => {
    if (requestFor(fileScopeId).cancelling.includes(id)) return;
    updateRequest(fileScopeId, { cancelling: [...requestFor(fileScopeId).cancelling, id], error: '' });
    try { await window.desktop.invoke({ op: 'operation.cancel', threadId: thread.id, requestId: id }); }
    catch (error) { updateRequest(fileScopeId, { error: String(error), cancelling: requestFor(fileScopeId).cancelling.filter(item => item !== id) }); }
  };
  return <>
    <Menu label={tr('项目动作')} className="project-action-trigger" placeholder={<><Play className="project-action-icon" size={16} aria-hidden="true" /><span className="project-action-label">{tr('项目动作')}</span></>} value="" kind="action" disabled={actionState.pending} options={[
      ...current.actions.map(action => ({ value: 'action:' + action.id, label: action.name, disabled: running('action.' + action.id) })),
      { value: 'initialization', label: tr('初始化环境'), disabled: !current.initialization.trim() || running('initialization') },
      { value: 'cleanup', label: tr('清理环境'), disabled: !current.cleanup.trim() || running('cleanup') },
      { value: 'manage', label: tr('配置环境与动作') },
    ]} onChange={value => { if (value === 'manage') show(); else if (value === 'initialization' || value === 'cleanup') void run(value); else void run('action', value.slice(7)); }} />
    {open && <ConfirmDialog title={tr('项目环境与动作')} presentation="panel" pending={saving} confirmLabel={tr('关闭')} onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} description={
      <div className="project-actions-editor command-content">
        <p>{project.name}</p><p className="hint">{tr('命令使用所选目录，配置更改只用于后续运行。初始化用于新建 Worktree，清理不会自动执行。')}</p><p className="hint">{directory?.path}</p>
        <label>{tr('命令解释器')}<Menu label={tr('命令解释器')} value={form.shell} matchTriggerWidth
          options={[{ value: 'powershell', label: 'PowerShell' }, { value: 'cmd', label: 'cmd' }, { value: 'git-bash', label: 'Git Bash' }]}
          onChange={value => edit({ ...form, shell: value as ProjectEnvironment['shell'] })} /></label>
        <label>{tr('初始化命令')}<textarea value={form.initialization} maxLength={8000} onChange={event => edit({ ...form, initialization: event.target.value })} /></label>
        <label>{tr('清理命令')}<textarea value={form.cleanup} maxLength={8000} onChange={event => edit({ ...form, cleanup: event.target.value })} /></label>
        {form.actions.map((action, index) => <fieldset key={action.id}>
          <legend>{tr('常用动作 {p0}', { p0: index + 1 })}</legend>
          <label>{tr('动作名称 {p0}', { p0: index + 1 })}<input value={action.name} maxLength={100} onChange={event => edit({ ...form, actions: form.actions.map(item => item.id === action.id ? { ...item, name: event.target.value } : item) })} /></label>
          <label>{tr('动作命令 {p0}', { p0: index + 1 })}<textarea value={action.command} maxLength={8000} onChange={event => edit({ ...form, actions: form.actions.map(item => item.id === action.id ? { ...item, command: event.target.value } : item) })} /></label>
          <button onClick={() => edit({ ...form, actions: form.actions.filter(item => item.id !== action.id) })}>{tr('删除动作')}</button>
        </fieldset>)}
        <div className="workbench-actions"><button disabled={form.actions.length >= 30} onClick={() => edit({ ...form, actions: [...form.actions, { id: crypto.randomUUID(), name: '', command: '' }] })}>{tr('添加常用动作')}</button><button disabled={saving} onClick={() => void save()}>{saving ? tr('正在保存…') : tr('保存项目环境')}</button><button disabled={saving} onClick={() => setOpen(false)}>{tr('关闭')}</button></div>
        {dirty && <p className="hint">{tr('未保存的项目配置会保留到窗口关闭。')}</p>}
        {stale && !saving && <div className="form-feedback"><p>{tr('项目环境已更新，当前草稿尚未替换。')}</p><button onClick={() => dirty ? setReload(true) : loadLatest()}>{tr('加载最新项目配置')}</button></div>}
        {reload && <div role="alert"><p>{tr('加载最新配置会替换当前草稿。')}</p><button onClick={() => setReload(false)}>{tr('继续编辑')}</button><button onClick={loadLatest}>{tr('替换草稿')}</button></div>}
        {saved && <p role="status">{tr('项目环境已保存')}</p>}{error && <p role="alert">{localizeAppError(error)}</p>}
        {actionState.error && <p role="alert">{localizeAppError(actionState.error)}</p>}
        {!!operations.length && <section aria-label={tr('项目动作记录')}><h3>{tr('项目动作记录')}</h3>{operations.map(operation => <article key={operation.id}>
          <p>{localizeLabel(operation.stage)} · {localizeLabel(({ running: '正在运行', succeeded: '操作完成', failed: '操作失败', cancelled: '操作已取消', interrupted: '操作已中断' } as const)[operation.status])}</p>
          {operation.error && <p role="alert">{localizeAppError(operation.error)}</p>}
          {operation.status === 'running' && <button disabled={actionState.cancelling.includes(operation.id)} onClick={() => void cancel(operation.id)}>{actionState.cancelling.includes(operation.id) ? tr('正在取消操作') : tr('停止项目动作')}</button>}
          {operation.result && typeof operation.result === 'object' && !Array.isArray(operation.result) && typeof operation.result.output === 'string' && <details><summary>{tr('动作输出')}</summary><pre>{operation.result.output}</pre></details>}
        </article>)}</section>}
      </div>
    } />}
  </>;
}
