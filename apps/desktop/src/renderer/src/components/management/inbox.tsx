import { tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { useContentMotion } from '../../hooks/use-content-motion.ts';
import { Inbox } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { statusText } from '../../lib/labels.ts';
import { useApp } from '../../state/app.tsx';
import { Button } from '../primitives/button.tsx';
import { FieldRow } from '../primitives/field-row.tsx';
import { ManagementEmpty, ManagementFilters, ManagementSearch } from './chrome.tsx';

const emptyLabels = { get pending() { return tr("没有待审阅的任务"); }, get reviewed() { return tr("没有已审阅的任务"); }, get error() { return tr("没有失败的任务"); }, get running() { return tr("没有运行中的任务"); }, get all() { return tr("没有自动化结果"); } };
type Filter = keyof typeof emptyLabels;
type Failure = { id: string; title: string; message: string };

export function InboxPage() {
  useLocale();
  const { data, selectThread, setReviewOpen, invoke } = useApp();
  const [filter, setFilter] = useState<Filter>('pending');
  const results = useRef<HTMLDivElement>(null);
  useContentMotion(results, filter);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [feedback, setFeedback] = useState('');
  const [failures, setFailures] = useState<Failure[]>([]);
  const query = search.trim().toLocaleLowerCase();
  const visible = data.threads.filter(thread => thread.automationId && !thread.deletedAt && thread.title.toLocaleLowerCase().includes(query) &&
    (filter === 'all' || filter === 'pending' && !thread.reviewed || filter === 'reviewed' && thread.reviewed ||
      filter === 'error' && thread.status === 'error' || filter === 'running' && ['running', 'waiting'].includes(thread.status)))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const eligible = visible.filter(thread => !thread.reviewed && !['running', 'waiting'].includes(thread.status));
  const selectedIds = selected.filter(id => eligible.some(thread => thread.id === id));
  useEffect(() => {
    setSelected(previous => {
      const next = previous.filter(id => eligible.some(thread => thread.id === id));
      return next.length === previous.length ? previous : next;
    });
  }, [eligible]);

  const review = async (ids: string[]) => {
    if (pending.current) return;
    const targets = eligible.filter(thread => ids.includes(thread.id));
    if (!targets.length) return;
    pending.current = true; setBusy(true); setFailures([]); setFeedback(tr("正在标记审阅结果…"));
    try {
      const results = await Promise.allSettled(targets.map(thread => invoke({ op: 'thread.update', id: thread.id, reviewed: true })));
      const failed: Failure[] = [];
      results.forEach((result, index) => {
        if (result.status === 'rejected') failed.push({ id: targets[index].id, title: targets[index].title,
          message: result.reason instanceof Error ? result.reason.message : String(result.reason) });
      });
      setFailures(failed);
      setSelected(failed.map(item => item.id));
      setFeedback(tr("已标记 {p0} 个任务{p1}", { p0: targets.length - failed.length, p1: failed.length ? tr("，{p0} 个未完成", { p0: failed.length }) : '' }));
    } finally { pending.current = false; setBusy(false); }
  };
  const retry = async (id: string, automationId: string, title: string) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setFailures([]); setFeedback(tr("正在重新运行…"));
    try {
      await invoke({ op: 'automation.run', id: automationId });
      setFeedback(tr("已请求重新运行；原任务结果保留，可在自动化运行历史查看新结果"));
    } catch (error) {
      setFeedback(tr("重新运行失败"));
      setFailures([{ id, title, message: error instanceof Error ? error.message : String(error) }]);
    } finally { pending.current = false; setBusy(false); }
  };

  return <section className="management-page inbox-page" aria-label={tr("待审阅任务")}>
    <header className="page-heading">
      <h1>{tr("待审阅")}</h1><p>{tr("检查自动化任务的结果和文件变更。")}</p>
    </header>
    <ManagementSearch label={tr("搜索待审阅任务")} placeholder={tr("搜索任务名称")} value={search} onChange={setSearch} />
    <ManagementFilters label={tr("审阅状态筛选")} value={filter} disabled={busy} onChange={value => { setFilter(value); setSelected([]); setFeedback(''); setFailures([]); }} options={[{ value: 'pending', label: tr("待审阅") }, { value: 'reviewed', label: tr("已审阅") }, { value: 'error', label: tr("失败") }, { value: 'running', label: tr("运行中") }, { value: 'all', label: tr("全部") }]} />
      <div className="management-list-actions">
        <Button size="sm" disabled={busy || !eligible.length} onClick={() => setSelected(selectedIds.length === eligible.length ? [] : eligible.map(thread => thread.id))}>{eligible.length > 0 && selectedIds.length === eligible.length ? tr("取消全选") : tr("全选可审阅任务")}</Button>
        <Button size="sm" disabled={busy || !selectedIds.length} onClick={() => void review(selectedIds)}>{tr("批量标记已审阅")}</Button>
        <span className="hint">{visible.length}  {tr("个任务 · 已选择")} {selectedIds.length}  {tr("个")}</span>
      </div>
    <div className="form-feedback" role="status" aria-live="polite">{feedback}</div>
    {failures.length > 0 && <div className="form-feedback" data-error="true" role="alert">
      <ul>{failures.map(item => <li key={item.id}>{item.title}：{item.message}</li>)}</ul>
    </div>}
    <div ref={results} className="field-stack" aria-busy={busy}>{visible.map(thread => {
      const canReview = eligible.some(item => item.id === thread.id);
      const job = data.automations.find(item => item.id === thread.automationId);
      const retryDisabled = !job || data.threads.some(item => item.automationId === job.id && ['running', 'waiting'].includes(item.status));
      return <FieldRow key={thread.id} label={thread.title} description={`${statusText[thread.status]} · ${new Date(thread.updatedAt).toLocaleString()}`}>
        <input type="checkbox" aria-label={tr("选择 ") + thread.title} checked={selectedIds.includes(thread.id)} disabled={busy || !canReview} onChange={event => setSelected(previous => event.target.checked ? [...previous, thread.id] : previous.filter(id => id !== thread.id))} />
        {thread.status === 'error' && thread.automationId && <Button size="sm" disabled={busy || retryDisabled} title={!job ? tr("该自动化已删除，仍可查看原结果") : retryDisabled ? tr("此自动化正在运行，请等待结束") : undefined} onClick={() => void retry(thread.id, thread.automationId!, thread.title)}>{tr("失败重试")}</Button>}
        <Button size="sm" variant="primary" onClick={() => { selectThread(thread); setReviewOpen(true); }}>{tr("查看结果")}</Button>
        <Button size="sm" disabled={busy || !canReview} onClick={() => void review([thread.id])}>{thread.reviewed ? tr("已审阅") : tr("标记已审阅")}</Button>
      </FieldRow>;
    })}</div>
    {!visible.length && <ManagementEmpty icon={<Inbox size={32} aria-hidden="true" />} title={query ? tr("没有匹配的任务") : emptyLabels[filter]} description={query ? tr("试试其他任务名称或审阅状态。") : tr("自动化结果会汇集到这里。")} />}
  </section>;
}
