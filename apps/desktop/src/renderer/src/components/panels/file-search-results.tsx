import { tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { useEffect, useRef, useState } from 'react';
import { FILE_SEARCH_PAGE_SIZE, fileSearchPageSchema, type FileSearchProgress, type FileSearchResult } from '../../../../shared/contracts.ts';

interface SearchState {
  directoryId?: string;
  key: string;
  threadId: string;
  requestId: string;
  query: string;
  content: boolean;
  results: FileSearchResult[];
  progress?: FileSearchProgress;
  cursor?: string;
  page: number;
  busy: boolean;
  done: boolean;
  stopped: boolean;
  error?: string;
}

export function FileSearchResults({ threadId, directoryId, query, content, composing, revision, onRetry, onOpen }: {
  directoryId?: string;
  threadId: string; query: string; content: boolean; composing: boolean; revision: number;
  onRetry(): void; onOpen(path: string, line?: number): void;
}) {
  useLocale();
  const key = JSON.stringify([threadId, directoryId, query.trim(), content, composing, revision]);
  const [state, setState] = useState<SearchState>();
  const session = useRef<SearchState | undefined>(undefined);
  const pageHeading = useRef<HTMLParagraphElement>(null);
  const isCurrent = (current: SearchState) => session.current === current;
  const publish = (current: SearchState) => { if (isCurrent(current)) setState({ ...current }); };
  const cancel = (current: SearchState) => {
    void window.desktop.invoke({ op: 'file.search.cancel', threadId: current.threadId, directoryId: current.directoryId, requestId: current.requestId }).catch(() => {});
  };
  const load = async (current: SearchState, page: number) => {
    if (!isCurrent(current) || current.busy || current.stopped) return;
    current.busy = true; current.error = undefined; publish(current);
    try {
      const target = (page + 1) * FILE_SEARCH_PAGE_SIZE;
      while (!current.done && current.results.length < target) {
        const response = fileSearchPageSchema.parse(await window.desktop.invoke({
          op: 'file.search', threadId: current.threadId, requestId: current.requestId,
          directoryId: current.directoryId,
          query: current.query, content: current.content, cursor: current.cursor,
        }));
        if (!isCurrent(current) || current.stopped) return;
        if (response.threadId !== current.threadId || response.requestId !== current.requestId) throw new Error(tr("搜索响应与当前任务不一致，请重试"));
        if (!response.done && response.cursor === current.cursor) throw new Error(tr("搜索游标未前进，请重试"));
        current.results = [...current.results, ...response.matches];
        current.progress = response.progress; current.cursor = response.cursor; current.done = response.done;
        publish(current);
        // Yield between IPC chunks so cancellation, IME and other panels remain responsive.
        if (!current.done && current.results.length < target) await new Promise(resolve => setTimeout(resolve, 0));
        if (!isCurrent(current) || current.stopped) return;
      }
      if (current.results.length > page * FILE_SEARCH_PAGE_SIZE) current.page = page;
    } catch (reason) {
      if (isCurrent(current) && !current.stopped) current.error = String(reason);
    } finally {
      current.busy = false; publish(current);
    }
  };
  useEffect(() => {
    if (composing || !query.trim()) { session.current = undefined; setState(undefined); return; }
    const current: SearchState = { key, threadId, directoryId, requestId: crypto.randomUUID(), query: query.trim(), content, results: [], page: 0, busy: false, done: false, stopped: false };
    session.current = current;
    setState({ ...current, busy: true });
    const timer = setTimeout(() => { void load(current, 0); }, 200);
    return () => {
      clearTimeout(timer);
      if (isCurrent(current)) session.current = undefined;
      cancel(current);
    };
  }, [key]);
  const view = state?.key === key ? state : undefined;
  const page = view?.page ?? 0;
  useEffect(() => { pageHeading.current?.scrollIntoView({ block: 'nearest' }); }, [page]);
  const results = view?.results.slice(page * FILE_SEARCH_PAGE_SIZE, (page + 1) * FILE_SEARCH_PAGE_SIZE) ?? [];
  const total = view?.results.length ?? 0;
  const progress = view?.progress;
  const skipped = progress ? progress.unreadable + progress.binary + progress.encoding + progress.oversized : 0;
  const busy = !composing && (!view || view.busy);
  const nextUnavailable = busy || ((page + 1) * FILE_SEARCH_PAGE_SIZE >= total && (!!view?.stopped || !!view?.error || !!view?.done));
  const status = composing ? tr("输入完成后搜索") : view?.error ? tr("搜索失败，已找到的结果仍可查看") : view?.stopped ? tr("搜索已停止，已找到 ") + total + tr(" 条结果") : busy ? tr("正在搜索…已找到 ") + total + tr(" 条结果") : view?.done ? total ? tr("找到 ") + total + tr(" 条结果") : tr("没有找到匹配的文件或内容") : tr("已找到 ") + total + tr(" 条结果，可继续搜索");

  return <div role="region" aria-label={tr("文件搜索结果")} aria-busy={busy}>
    <p className="hint" role="status">{status}</p>
    {progress && <p className="hint file-search-progress">{tr("已检查")} {progress.files}  {tr("个文件")}{content ? '、' + progress.lines + tr(" 行") : ''}{progress.excludedDirectories ? tr("；已排除 ") + progress.excludedDirectories + tr(" 个依赖或生成目录") : ''}</p>}
    {!!skipped && <p className="hint file-search-coverage">{tr("未检索内容：")}{[
      progress?.binary ? tr("二进制 ") + progress.binary : '', progress?.encoding ? tr("非 UTF-8 ") + progress.encoding : '',
      progress?.oversized ? tr("超过 10 MB ") + progress.oversized : '', progress?.unreadable ? tr("链接或无法读取 ") + progress.unreadable : '',
    ].filter(Boolean).join('、')}{tr("。结果未覆盖这些项目。")}</p>}
    {(busy || view?.stopped) && <button className="file-search-stop" onClick={() => {
      if (view?.stopped) { onRetry(); return; }
      const current = session.current;
      if (!current || current.key !== key) return;
      current.stopped = true; current.busy = false; cancel(current); publish(current);
    }}>{view?.stopped ? tr("重新搜索") : tr("停止搜索")}</button>}
    {view?.error && <div className="file-navigation-error" role="alert"><p>{tr("搜索失败：")}{view.error}</p><button onClick={onRetry}>{tr("重试搜索")}</button></div>}
    {(total >= FILE_SEARCH_PAGE_SIZE || (!busy && !view?.done && !view?.stopped && !view?.error && total > 0)) && <nav className="file-search-pagination" aria-label={tr("搜索结果分页")}>
      <button aria-disabled={busy || page === 0} onClick={() => { const current = session.current; if (!busy && current && !current.busy && current.page > 0) { current.page--; publish(current); } }}>{tr("上一页")}</button>
      <p ref={pageHeading} className="hint">{tr("第")} {page + 1}  {tr("页 ·")} {page * FILE_SEARCH_PAGE_SIZE + 1}–{page * FILE_SEARCH_PAGE_SIZE + results.length}</p>
      <button aria-disabled={nextUnavailable} onClick={() => {
        const current = session.current;
        if (nextUnavailable || !current || current.busy) return;
        if ((page + 1) * FILE_SEARCH_PAGE_SIZE < current.results.length) { current.page++; publish(current); }
        else void load(current, page + 1);
      }}>{tr("下一页")}</button>
    </nav>}
    {results.map((result, index) => <button key={result.path + ':' + result.line + ':' + index} className="file-search-result" onClick={() => onOpen(result.path.replaceAll('\\', '/'), result.line ?? 1)}>{result.path}{result.line ? ':' + result.line : ''}{result.text && <small>{result.text}</small>}</button>)}
  </div>;
}
