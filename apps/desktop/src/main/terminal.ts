import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type IPty, spawn } from 'node-pty';
import type { DesktopEvent, Settings, TerminalInfo } from '../shared/contracts.ts';
import { appendTerminalOutput, terminalOutputEnd } from '../shared/terminal-output.ts';
import { actionArguments } from './action-shell.ts';

export function findShell(kind: Settings['terminal']): { file: string; args: string[] } {
  if (kind === 'cmd') return { file: process.env.ComSpec || 'cmd.exe', args: [] };
  if (kind === 'git-bash') {
    const git = execFileSync('where.exe', ['git'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0];
    const file = join(dirname(dirname(git)), 'bin', 'bash.exe');
    if (!existsSync(file)) throw new Error('未找到 Git Bash，请先安装 Git for Windows');
    return { file, args: ['--login', '-i'] };
  }
  try {
    return {
      file: execFileSync('where.exe', ['pwsh.exe'], { encoding: 'utf8', windowsHide: true }).split(
        /\r?\n/,
      )[0],
      args: ['-NoLogo'],
    };
  } catch {
    return { file: 'powershell.exe', args: ['-NoLogo'] };
  }
}
export class TerminalService {
  private sessions = new Map<string, { pty: IPty; info: TerminalInfo }>();
  private readonly listeners = new Set<(id: string) => void>();
  constructor(private readonly emit: (event: DesktopEvent) => void) {}
  subscribe(listener: (id: string) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private notify(id: string): void { for (const listener of [...this.listeners]) listener(id); }
  list(): TerminalInfo[] {
    return [...this.sessions.values()].map((value) => value.info);
  }
  open(threadId: string, cwd: string, kind: Settings['terminal']): TerminalInfo {
    const shell = findShell(kind);
    return this.start(threadId, cwd, shell, kind === 'powershell' ? 'PowerShell' : kind === 'cmd' ? '命令提示符' : 'Git Bash');
  }
  run(threadId: string, cwd: string, kind: Settings['terminal'], command: string, title: string, operationId: string, signal: AbortSignal): { info: TerminalInfo; done: Promise<number> } {
    signal.throwIfAborted();
    const shell = findShell(kind);
    let exited: (code: number) => void = () => {};
    const done = new Promise<number>(resolve => { exited = resolve; });
    const info = this.start(threadId, cwd, { file: shell.file, args: actionArguments(kind, command) }, title, exited, operationId);
    const cancel = () => this.sessions.get(info.id)?.pty.kill();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    return { info, done: done.finally(() => signal.removeEventListener('abort', cancel)) };
  }
  private start(threadId: string, cwd: string, shell: { file: string; args: string[] }, title: string, onExit?: (code: number) => void, operationId?: string): TerminalInfo {
    const id = crypto.randomUUID();
    const pty = spawn(shell.file, shell.args, {
      cwd,
      cols: 100,
      rows: 24,
      name: 'xterm-256color',
      env: process.env as Record<string, string>,
    });
    const info: TerminalInfo = {
      id,
      threadId,
      title,
      operationId,
      exited: false,
      output: '',
      outputOffset: 0,
    };
    this.sessions.set(id, { pty, info });
    this.emit({ type: 'terminal.created', terminal: info });
    this.notify(id);
    pty.onData((data) => {
      const offset = terminalOutputEnd(info);
      Object.assign(info, appendTerminalOutput(info, data, offset));
      this.emit({ type: 'terminal', id, threadId, data, offset });
      this.notify(id);
    });
    pty.onExit(({ exitCode }) => {
      info.exited = true;
      info.exitCode = exitCode;
      const data = '\r\n[进程已退出：' + exitCode + ']\r\n';
      const offset = terminalOutputEnd(info);
      Object.assign(info, appendTerminalOutput(info, data, offset));
      this.emit({ type: 'terminal', id, threadId, data, offset, exited: true });
      this.notify(id);
      onExit?.(exitCode);
    });
    return info;
  }
  input(id: string, data: string): void {
    const value = this.sessions.get(id);
    if (!value || value.info.exited) throw new Error('终端已关闭');
    value.pty.write(data);
  }
  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.pty.resize(cols, rows);
  }
  close(id: string): void {
    this.sessions.get(id)?.pty.kill();
    this.sessions.delete(id);
    this.notify(id);
  }
  rename(id: string, title: string): TerminalInfo {
    const session = this.sessions.get(id);
    if (!session) throw new Error('终端不存在');
    session.info.title = title;
    this.notify(id);
    return session.info;
  }
  dispose(): void {
    for (const id of this.sessions.keys()) this.close(id);
  }
}
