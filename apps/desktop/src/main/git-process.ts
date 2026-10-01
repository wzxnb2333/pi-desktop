import { execFile, spawn } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { join, resolve as resolvePath } from 'node:path';
import type { GitProcessProblem } from '../shared/git-processes.ts';

interface GitProcessOptions { signal?: AbortSignal; env?: NodeJS.ProcessEnv; input?: string | Buffer; timeoutMs?: number; maxBuffer?: number; encoding?: 'buffer'; onSpawn?(pid: number): void; onSuccess?(): void; }
const cancellations = new WeakMap<AbortSignal, Set<() => Promise<void>>>();
const controllers = new WeakMap<AbortSignal, AbortController>();
const problems = new Map<string, { cwd: string; read(): GitProcessProblem | undefined; stop(): Promise<void>; closed: Promise<void> }>();
const problemListeners = new Set<(added: boolean) => void>();
const readScope = new AsyncLocalStorage<{ owner: GitReads; controller: AbortController; failure?: Error }>();
const pathKey = (cwd: string) => process.platform === 'win32' ? resolvePath(cwd).toLowerCase() : resolvePath(cwd);
const notifyProblems = (added = false) => { for (const listener of problemListeners) listener(added); };

export function ownGitController(controller: AbortController, parent?: AbortSignal): () => void {
  controllers.set(controller.signal, controller);
  const abort = () => controller.abort(parent?.reason);
  const cancel = () => { abort(); return cancelGitProcesses(controller.signal); };
  if (parent && parent !== controller.signal) {
    const active = cancellations.get(parent) ?? new Set<() => Promise<void>>();
    active.add(cancel); cancellations.set(parent, active);
    parent.addEventListener('abort', abort, { once: true }); if (parent.aborted) abort();
  }
  return () => {
    controllers.delete(controller.signal);
    if (parent && parent !== controller.signal) {
      parent.removeEventListener('abort', abort); const active = cancellations.get(parent); active?.delete(cancel);
      if (!active?.size) cancellations.delete(parent);
    }
  };
}
export function onGitProcessProblems(listener: (added: boolean) => void): () => void {
  problemListeners.add(listener);
  return () => { problemListeners.delete(listener); };
}
export function gitProcessProblems(cwd: string): GitProcessProblem[] {
  return [...problems.values()].flatMap(record => { const problem = record.cwd === pathKey(cwd) ? record.read() : undefined; return problem ? [problem] : []; });
}
export async function retryGitProcessStop(cwd: string, id: string): Promise<void> {
  const record = problems.get(id);
  if (!record) return;
  if (record.cwd !== pathKey(cwd) || !record.read()) throw new Error('Git 进程不属于此目录或无需恢复');
  await record.stop();
  await record.closed;
}

/** Background reads belong to the service, even when their IPC has no request ID. */
export class GitReads {
  private readonly active = new Set<AbortController>();
  private readonly pending = new Set<Promise<unknown>>();
  private closing = false;
  run<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const parent = readScope.getStore();
    if (parent?.owner === this) return run(parent.controller.signal);
    if (this.closing) return Promise.reject(new Error('应用正在关闭，请重启后再执行操作'));
    const controller = new AbortController(); const release = ownGitController(controller);
    const scope = { owner: this, controller, failure: undefined as Error | undefined };
    this.active.add(controller);
    const operation = readScope.run(scope, async () => {
      try {
        const result = await run(controller.signal);
        if (scope.failure) throw scope.failure;
        controller.signal.throwIfAborted(); return result;
      } finally { this.active.delete(controller); release(); }
    });
    this.pending.add(operation);
    const done = () => { this.pending.delete(operation); }; void operation.then(done, done);
    return operation;
  }
  async prepareShutdown(): Promise<void> {
    this.closing = true;
    const results = await Promise.allSettled([...this.active].map(controller => { controller.abort(); return cancelGitProcesses(controller.signal); }));
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') { this.resume(); throw failure.reason; }
  }
  resume(): void { this.closing = false; }
  async settled(): Promise<void> { while (this.pending.size) await Promise.allSettled([...this.pending]); }
}

/** A failed OS termination can be retried even though AbortSignal fires only once. */
export async function cancelGitProcesses(signal: AbortSignal): Promise<void> {
  const results = await Promise.allSettled([...(cancellations.get(signal) ?? [])].map(cancel => cancel()));
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

/** Keep callers locked until this invocation's process tree and stdio close. */
export function gitProcess(cwd: string, args: string[], options: GitProcessOptions & { encoding: 'buffer' }): Promise<Buffer>;
export function gitProcess(cwd: string, args: string[], options?: GitProcessOptions & { encoding?: undefined }): Promise<string>;
export function gitProcess(cwd: string, args: string[], options: GitProcessOptions = {}): Promise<string | Buffer> {
  const scope = readScope.getStore();
  if (scope?.failure) return Promise.reject(scope.failure);
  const ownedController = scope?.controller ?? (options.signal ? controllers.get(options.signal) : undefined);
  if (scope) options = { ...options, signal: options.signal && options.signal !== scope.controller.signal ? AbortSignal.any([options.signal, scope.controller.signal]) : scope.controller.signal };
  if (options.signal?.aborted) return Promise.reject(Object.assign(new Error('Git 操作已取消，请刷新仓库状态'), { code: 'ABORT_ERR' }));
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env: options.env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let outBytes = 0, errBytes = 0;
    let closed = false;
    let failure: Error | undefined;
    let termination: Promise<void> | undefined;
    let problem = false;
    const id = crypto.randomUUID();
    let finished: () => void = () => {};
    const finishedProcess = new Promise<void>(resolve => { finished = resolve; });
    const stop = (error: Error): Promise<void> => {
      failure ??= error;
      if (scope) scope.failure ??= failure;
      // A timeout must also stop the owning command chain after caught subcommand errors.
      if (ownedController && !ownedController.signal.aborted) queueMicrotask(() => ownedController.abort());
      if (!child.pid || closed) return Promise.resolve();
      if (termination) return termination;
      const pid = child.pid;
      const attempt = new Promise<void>((done, failed) => {
        if (process.platform === 'win32') {
          execFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/F', '/T', '/PID', String(pid)], { windowsHide: true }, error => error && !closed ? failed(error) : done());
        } else {
          try { process.kill(-pid, 'SIGKILL'); done(); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') done(); else failed(error); }
        }
      }).catch(cause => {
        // Report the stop failure without settling the still-running Git call.
        const added = !problem; problem = true; notifyProblems(added);
        throw Object.assign(new Error('无法结束 Git 进程，请检查进程状态', { cause }), { code: 'GIT_TERMINATION_FAILED', pid });
      });
      termination = attempt;
      if (problem) notifyProblems();
      void attempt.then(() => {}, () => { if (termination === attempt) { termination = undefined; if (problem) notifyProblems(); } });
      return attempt;
    };
    const cancel = () => stop(Object.assign(new Error('Git 操作已取消，请刷新仓库状态'), { code: 'ABORT_ERR' }));
    problems.set(id, { cwd: pathKey(cwd), read: () => problem && !closed && child.pid ? { id, pid: child.pid, reason: failure!.message, stopping: !!termination } : undefined, stop: cancel, closed: finishedProcess });
    const abort = () => { void cancel().catch(() => {}); };
    const signals = [...new Set([options.signal, ownedController?.signal].filter((signal): signal is AbortSignal => !!signal))];
    for (const signal of signals) {
      const active = cancellations.get(signal) ?? new Set<() => Promise<void>>();
      active.add(cancel); cancellations.set(signal, active);
    }
    const timer = setTimeout(() => { void stop(Object.assign(new Error('Git 操作超时，请检查仓库状态后重试'), { code: 'ETIMEDOUT' })).catch(() => {}); }, options.timeoutMs ?? 60000);
    const limit = options.maxBuffer ?? 20 * 1024 * 1024;
    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes <= limit) stdout.push(chunk);
      else if (!failure) void stop(Object.assign(new Error('Git 输出过大，请缩小操作范围'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })).catch(() => {});
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errBytes += chunk.length;
      if (errBytes <= limit) stderr.push(chunk);
      else if (!failure) void stop(Object.assign(new Error('Git 输出过大，请缩小操作范围'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })).catch(() => {});
    });
    child.on('error', error => { failure ??= error; });
    child.stdin.on('error', error => { if (!closed) void stop(error).catch(() => {}); });
    child.once('close', (code, signal) => {
      closed = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
      for (const signal of signals) {
        const active = cancellations.get(signal); active?.delete(cancel);
        if (!active?.size) cancellations.delete(signal);
      }
      void (async () => {
        await termination?.catch(() => {});
        problems.delete(id); finished(); if (problem) notifyProblems();
        const bytes = Buffer.concat(stdout), out = options.encoding === 'buffer' ? bytes : bytes.toString('utf8'), err = Buffer.concat(stderr).toString('utf8');
        if (!failure && code === 0) {
          try { options.onSuccess?.(); resolve(out); }
          catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
        } else reject(Object.assign(failure ?? new Error(err || 'Git 退出码 ' + code), { stdout: out, stderr: err, ...(!failure ? { code, signal } : {}) }));
      })();
    });
    options.signal?.addEventListener('abort', abort, { once: true });
    try { if (child.pid) options.onSpawn?.(child.pid); }
    catch (error) { void stop(error instanceof Error ? error : new Error(String(error))).catch(() => {}); }
    if (options.signal?.aborted) abort();
    child.stdin.end(options.input);
  });
}
