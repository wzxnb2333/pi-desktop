import { useEffect, useState } from 'react';
import { pullRequestSchema, type GhStatus, type OperationRecord } from '../../../../shared/operations.ts';
import { localizeAppError, localizeLabel, tr } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { useApp } from '../../state/app.tsx';

export function PullRequestPanel() {
  useLocale();
  const { data, activeId, directoryId, invoke, act, setTerminalOpen } = useApp();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<GhStatus>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selector, setSelector] = useState('');
  const [title, setTitle] = useState('');
  const [base, setBase] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(true);
  const records = data.operations.filter(item => item.threadId === activeId && item.directoryId === directoryId && item.kind.startsWith('pr.'));
  const latest = records.at(-1);
  const pending = loading || records.some(item => item.status === 'running');
  const read = pullRequestSchema.safeParse([...records].reverse().find(item => item.kind === 'pr.view' && item.status === 'succeeded')?.result);
  const created = [...records].reverse().find(item => item.kind === 'pr.create' && item.status === 'succeeded')?.result;
  const createdUrl = created && typeof created === 'object' && !Array.isArray(created) && typeof created.url === 'string' ? created.url : '';
  useEffect(() => { setStatus(undefined); setError(''); setSelector(''); setTitle(''); setBase(''); setBody(''); }, [activeId, directoryId]);
  const check = async () => {
    setLoading(true); setError('');
    try { setStatus(await invoke({ op: 'pr.status', threadId: activeId, directoryId }) as GhStatus); }
    catch (error) { setError(String(error)); }
    finally { setLoading(false); }
  };
  const start = async (action: 'view' | 'create') => {
    setLoading(true); setError('');
    try { await invoke({ op: 'pr.start', threadId: activeId, directoryId, requestId: crypto.randomUUID(), action, selector, title, base, body, draft }) as OperationRecord; }
    catch (error) { setError(String(error)); }
    finally { setLoading(false); }
  };
  return <details className="workbench-section pr-panel" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{tr('拉取请求')}</summary>
    {open && <>
      <p className="hint">{tr('使用 GitHub CLI。提交和推送分别由 Git 操作触发，创建 PR 仅使用已推送分支。')}</p>
      <div className="workbench-actions"><button disabled={pending} onClick={() => void check()}>{tr('检查 GitHub CLI')}</button><button onClick={() => setTerminalOpen(true)}>{tr('打开项目终端')}</button></div>
      {status && <p role="status">{status.authenticated ? tr('GitHub CLI 已就绪') : localizeAppError(status.message.replace(/^Error: /, ''))}</p>}
      <p className="hint">{tr('缺少工具时安装 GitHub CLI；需要登录时在项目终端运行：')} <code>gh auth login</code></p>
      <form onSubmit={event => { event.preventDefault(); void start('view'); }}>
        <label className="git-field">{tr('PR 编号、链接或分支')}<input value={selector} onChange={event => setSelector(event.target.value)} placeholder={tr('留空查看当前分支')} /></label>
        <button disabled={pending}>{tr('读取 PR 上下文')}</button>
      </form>
      <details><summary>{tr('创建 PR')}</summary><form onSubmit={event => { event.preventDefault(); void start('create'); }}>
        <label className="git-field">{tr('PR 标题')}<input maxLength={1000} required value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label className="git-field">{tr('PR 基准分支')}<input required value={base} onChange={event => setBase(event.target.value)} /></label>
        <label className="git-field">{tr('PR 说明')}<textarea maxLength={50000} value={body} onChange={event => setBody(event.target.value)} /></label>
        <label><input type="checkbox" checked={draft} onChange={event => setDraft(event.target.checked)} />{tr('草稿 PR')}</label>
        <button disabled={pending || !title.trim() || !base.trim()}>{draft ? tr('创建草稿 PR') : tr('创建普通 PR')}</button>
      </form></details>
      {error && <p role="alert">{error}</p>}
      {latest && <div className="pr-operation" role={latest.status === 'failed' ? 'alert' : 'status'}>
        <p>{localizeLabel(latest.stage)} · {localizeLabel(({ running: '正在运行', succeeded: '操作完成', failed: '操作失败', cancelled: '操作已取消', interrupted: '操作已中断' } as const)[latest.status])}</p>
        {latest.error && <p>{localizeAppError(latest.error)}</p>}
        {latest.status === 'running' && <button onClick={() => act({ op: 'operation.cancel', threadId: activeId, requestId: latest.id })}>{tr('取消 PR 操作')}</button>}
      </div>}
      {createdUrl && <button onClick={() => act({ op: 'external.open', url: createdUrl })}>{tr('打开已创建的 PR')}</button>}
      {read.success && <article aria-label={tr('PR 上下文')}>
        <h3>#{read.data.number} {read.data.title}</h3>
        <p>{read.data.headRefName} → {read.data.baseRefName} · {read.data.state}{read.data.isDraft ? ' · ' + tr('草稿 PR') : ''}</p>
        <button onClick={() => act({ op: 'external.open', url: read.data.url })}>{tr('在浏览器打开 PR')}</button>
        <pre className="pr-body">{read.data.body}</pre>
        <h4>{tr('PR 评论与审查')}</h4>
        {[...read.data.comments, ...read.data.reviews].map((comment, index) => <blockquote key={index}><strong>{comment.author?.login ?? tr('未知用户')}</strong>{'state' in comment && <span> · {comment.state}</span>}<pre className="pr-body">{comment.body}</pre></blockquote>)}
        {!read.data.comments.length && !read.data.reviews.length && <p className="hint">{tr('暂无 PR 评论')}</p>}
      </article>}
    </>}
  </details>;
}
