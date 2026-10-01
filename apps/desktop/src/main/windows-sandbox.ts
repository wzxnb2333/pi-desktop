import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PowerShellOperations } from '@earendil-works/pi-coding-agent';

const source = fileURLToPath(new URL('../../resources/sandbox/launcher.cs', import.meta.url));
// Pin the reviewed broker: a task editing the application checkout must not compile arbitrary host code.
const sourceIntegrity = '7afd553d615498a2754f4d26485ae53a8e7ed19d78bc11b1f9f51f1842b7bc34';
const builds = new Map<string, Promise<string>>();
const inside = (root: string, target: string) => { const path = relative(root, target); return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path); };

async function launcher(storage: string): Promise<string> {
  const cached = builds.get(storage); if (cached) return cached;
  const build = (async () => {
    if (process.platform !== 'win32') throw new Error('当前系统没有可用的 Windows 沙箱；未执行命令');
    const content = (await readFile(source, 'utf8')).replaceAll('\r\n', '\n');
    const digest = createHash('sha256').update(content).digest('hex');
    if (digest !== sourceIntegrity) throw new Error('沙箱启动器校验失败，未执行命令；请使用完整的应用版本');
    const directory = join(storage, 'sandbox-runtime'); await mkdir(directory, { recursive: true });
    const target = join(directory, 'launcher-' + digest.slice(0, 20) + '.exe');
    if (await access(target).then(() => true, () => false)) return target;
    const compiler = join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    const staging = await mkdtemp(join(directory, 'build-'));
    try {
      const input = join(staging, 'launcher.cs'), output = join(staging, 'launcher.exe'); await writeFile(input, content);
      await new Promise<void>((done, reject) => {
        const child = spawn(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+', '/r:System.Web.Extensions.dll', '/out:' + output, input], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let log = ''; child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
        child.once('error', reject); child.once('close', code => code === 0 ? done() : reject(new Error('沙箱初始化失败，未执行命令：' + log)));
      });
      await rename(output, target).catch(async error => { if (!await access(target).then(() => true, () => false)) throw error; });
      return target;
    } finally { await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  })();
  builds.set(storage, build); build.catch(() => { builds.delete(storage); }); return build;
}

/** Recover only persisted native leases. A live broker holds an exclusive lock and is skipped. */
export async function recoverSandboxRuns(storage: string): Promise<void> {
  if (process.platform !== 'win32') return;
  const directory = join(storage, 'sandbox-leases');
  const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  if (!files.some(file => file.endsWith('.json'))) return;
  const executable = await launcher(storage);
  await new Promise<void>((done, reject) => {
    const child = spawn(executable, ['--recover', directory], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', data => { errors = (errors + data).slice(-12000); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? done() : reject(new Error('沙箱恢复失败，恢复记录已保留；未执行新命令：' + errors)));
  });
}

/** No command parsing or allowlist substitutes for the Windows process boundary. */
export function sandboxPowerShell(storage: string): PowerShellOperations {
  return { exec: async (command, cwd, { onData, signal, timeout }) => {
    signal?.throwIfAborted();
    const root = await realpath(cwd), data = resolve(storage), windows = resolve(process.env.SystemRoot ?? 'C:\\Windows');
    if (root === parse(root).root || inside(root, windows) || inside(root, homedir()) || inside(root, data))
      throw new Error('沙箱工作目录过宽，请选择具体项目目录');
    await mkdir(data, { recursive: true });
    const canonicalData = await realpath(data);
    if (inside(root, canonicalData)) throw new Error('沙箱工作目录过宽，请选择具体项目目录');
    await recoverSandboxRuns(canonicalData);
    const executable = await launcher(canonicalData); signal?.throwIfAborted();
    const parent = join(canonicalData, 'sandbox-runs'); await mkdir(parent, { recursive: true });
    const temp = await mkdtemp(join(parent, 'run-'));
    try {
      return await new Promise<{ exitCode: number }>((done, reject) => {
        const child = spawn(executable, [], { windowsHide: true, cwd: dirname(executable), stdio: ['pipe', 'pipe', 'pipe'] });
        let errors = '';
        child.stdout.on('data', onData); child.stderr.on('data', buffer => { errors = (errors + buffer).slice(-12000); onData(buffer); });
        const cancel = () => { child.stdin.write('cancel\n'); };
        child.stdin.on('error', () => {});
        child.stdin.write(JSON.stringify({ cwd: root, temp, command, timeoutMs: Math.min((timeout ?? 120) * 1000, 2147483647) }) + '\n');
        signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
        child.once('error', error => { signal?.removeEventListener('abort', cancel); reject(error); });
        child.once('close', code => {
          signal?.removeEventListener('abort', cancel); child.stdin.destroy();
          if (signal?.aborted) reject(new Error('沙箱命令已取消'));
          else if (code === 125 || code === null) reject(new Error('沙箱执行失败，未退回完全访问：' + errors));
          else done({ exitCode: code });
        });
      });
    } finally { await rm(temp, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 }); }
  } };
}
