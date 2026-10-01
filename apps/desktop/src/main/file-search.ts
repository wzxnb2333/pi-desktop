import { randomUUID } from 'node:crypto';
import { opendir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { FILE_SEARCH_PAGE_SIZE, type DesktopRequest, type FileSearchPage, type FileSearchProgress, type FileSearchResult } from '../shared/contracts.ts';
import { safeProjectPath } from './policy.ts';

type SearchRequest = Extract<DesktopRequest, { op: 'file.search' }>;
const EXCLUDED = new Set(['.git', 'node_modules', 'dist', 'build', '.cache', '.artifacts']);
const MAX_BYTES = 10 * 1024 * 1024;
const IDLE_MS = 5 * 60 * 1000;
interface SearchSession {
  cwd: string;
  request: SearchRequest;
  controller: AbortController;
  iterator: AsyncGenerator<FileSearchResult | undefined>;
  progress: FileSearchProgress;
  touched: number;
  cursor?: string;
  last?: { input?: string; page: FileSearchPage };
  pending?: { input?: string; promise: Promise<FileSearchPage> };
  failure?: unknown;
}

/** A yield is a bounded unit of work, including lines that do not match. */
async function* scan(cwd: string, query: string, content: boolean, progress: FileSearchProgress, signal: AbortSignal): AsyncGenerator<FileSearchResult | undefined> {
  const needle = query.toLocaleLowerCase();
  if (!needle.trim()) return;
  const directories = [''];
  while (directories.length) {
    signal.throwIfAborted();
    const directory = directories.shift()!;
    let handle;
    try { handle = await opendir(await safeProjectPath(cwd, directory)); }
    catch (error) {
      signal.throwIfAborted();
      if (!directory) throw error;
      progress.unreadable++;
      yield undefined;
      continue;
    }
    for await (const entry of handle) {
      signal.throwIfAborted();
      const path = join(directory, entry.name);
      // Directory links are never traversed. File links still pass the canonical path check below.
      if (entry.isDirectory()) {
        if (EXCLUDED.has(entry.name)) progress.excludedDirectories++;
        else directories.push(path);
        yield undefined;
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) { progress.unreadable++; yield undefined; continue; }
      progress.files++;
      if (!content) { yield path.toLocaleLowerCase().includes(needle) ? { path } : undefined; continue; }
      let bytes: Buffer;
      try {
        const absolute = await safeProjectPath(cwd, path);
        const metadata = await stat(absolute);
        if (!metadata.isFile()) { progress.unreadable++; yield undefined; continue; }
        if (metadata.size > MAX_BYTES) { progress.oversized++; yield undefined; continue; }
        bytes = await readFile(absolute, { signal });
      } catch {
        signal.throwIfAborted();
        progress.unreadable++;
        yield undefined;
        continue;
      }
      signal.throwIfAborted();
      if (bytes.length > MAX_BYTES) { progress.oversized++; yield undefined; continue; }
      if (bytes.includes(0)) { progress.binary++; yield undefined; continue; }
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { progress.encoding++; yield undefined; continue; }
      let start = 0;
      let line = 1;
      while (start < text.length) {
        signal.throwIfAborted();
        const end = text.indexOf('\n', start);
        const value = text.slice(start, end < 0 ? text.length : end).replace(/\r$/, '');
        progress.lines++;
        yield value.toLocaleLowerCase().includes(needle) ? { path, line, text: value.slice(0, 300) } : undefined;
        if (end < 0) break;
        start = end + 1;
        line++;
      }
      yield undefined;
    }
  }
}

export class FileSearchService {
  private readonly sessions = new Map<string, SearchSession>();
  private readonly cancelled = new Map<string, number>();
  private readonly timer = setInterval(() => this.expire(), 60_000).unref();

  private release(session: SearchSession): void {
    session.controller.abort(new Error('搜索已停止'));
    void session.iterator.return(undefined).catch(() => {});
  }
  private expire(): void {
    const before = Date.now() - IDLE_MS;
    for (const [id, session] of this.sessions) if (!session.pending && session.touched < before) {
      this.release(session);
      this.sessions.delete(id);
    }
    for (const [key, time] of this.cancelled) if (time < before) this.cancelled.delete(key);
  }
  cancel(threadId: string, requestId: string): void {
    this.cancelled.set(JSON.stringify([threadId, requestId]), Date.now());
    if (this.cancelled.size > 512) this.cancelled.delete(this.cancelled.keys().next().value!);
    const session = this.sessions.get(threadId);
    if (session?.request.requestId === requestId) { this.release(session); this.sessions.delete(threadId); }
  }
  closeThread(threadId: string): void {
    const session = this.sessions.get(threadId);
    if (session) this.cancel(threadId, session.request.requestId);
  }
  dispose(): void {
    clearInterval(this.timer);
    for (const session of this.sessions.values()) this.release(session);
    this.sessions.clear();
    this.cancelled.clear();
  }
  async search(cwd: string, request: SearchRequest): Promise<FileSearchPage> {
    this.expire();
    if (this.cancelled.has(JSON.stringify([request.threadId, request.requestId]))) throw new Error('搜索已停止');
    let session = this.sessions.get(request.threadId);
    if (!session || session.request.requestId !== request.requestId) {
      if (request.cursor) throw new Error('搜索已过期，请重新搜索');
      if (session) this.cancel(request.threadId, session.request.requestId);
      if (this.sessions.size >= 16) {
        const oldest = [...this.sessions.values()].filter(item => !item.pending).sort((a, b) => a.touched - b.touched)[0];
        if (!oldest) throw new Error('同时搜索的任务过多，请稍后重试');
        this.closeThread(oldest.request.threadId);
      }
      const progress: FileSearchProgress = { files: 0, lines: 0, excludedDirectories: 0, unreadable: 0, binary: 0, encoding: 0, oversized: 0 };
      const controller = new AbortController();
      session = { cwd, request, controller, progress, iterator: scan(cwd, request.query, request.content, progress, controller.signal), touched: Date.now() };
      this.sessions.set(request.threadId, session);
    }
    if (session.cwd !== cwd || session.request.query !== request.query || session.request.content !== request.content) throw new Error('搜索条件已改变，请重新搜索');
    session.touched = Date.now();
    if (session.failure) throw session.failure;
    if (session.last && session.last.input === request.cursor) return session.last.page;
    if (session.pending) {
      if (session.pending.input === request.cursor) return session.pending.promise;
      throw new Error('上一页仍在搜索，请稍后重试');
    }
    if (session.cursor !== request.cursor || session.last?.page.done) throw new Error('搜索页已失效，请重新搜索');
    const current = session;
    const promise = this.page(current).then(page => {
      current.last = { input: request.cursor, page };
      current.cursor = page.cursor;
      return page;
    }).catch(error => { current.failure = error; throw error; }).finally(() => { current.pending = undefined; current.touched = Date.now(); });
    current.pending = { input: request.cursor, promise };
    return promise;
  }
  private async page(session: SearchSession): Promise<FileSearchPage> {
    const matches: FileSearchResult[] = [];
    const started = performance.now();
    let done = false;
    for (let work = 0; work < 2000 && matches.length < FILE_SEARCH_PAGE_SIZE; work++) {
      session.controller.signal.throwIfAborted();
      const next = await session.iterator.next();
      session.controller.signal.throwIfAborted();
      if (next.done) { done = true; break; }
      if (next.value) matches.push(next.value);
      if (performance.now() - started >= 50) break;
    }
    return { threadId: session.request.threadId, requestId: session.request.requestId, matches, progress: { ...session.progress }, done, ...(done ? {} : { cursor: randomUUID() }) };
  }
}
