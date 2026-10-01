import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const processAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Only used under an owned temporary repository; never installs hooks in user projects. */
export async function slowGitFixture(root: string, output = 0) {
  const directory = join(root, 'slow-git'); await mkdir(directory);
  const script = join(directory, 'wait.mjs');
  await writeFile(script, [
    "import { spawn } from 'node:child_process';",
    "import { writeFileSync } from 'node:fs';",
    "import { fileURLToPath } from 'node:url';",
    "import { dirname, join } from 'node:path';",
    "const script = fileURLToPath(import.meta.url); const root = dirname(script);",
    "if (process.argv[2] !== 'leaf') spawn(process.execPath, [script, 'leaf'], { stdio: 'inherit' }).on('error', () => process.exit(2));",
    "writeFileSync(join(root, process.argv[2] === 'leaf' ? 'leaf.json' : 'parent.json'), JSON.stringify({ pid: process.pid, index: process.env.GIT_INDEX_FILE }));",
    "if (process.argv[2] === 'leaf') process.stdout.write('x'.repeat(" + output + "));",
    "setInterval(() => {}, 1000);",
  ].join('\n'));
  const executable = process.execPath.replaceAll('\\', '/');
  const command = "'" + executable.replaceAll("'", "'\"'\"'") + "' '" + script.replaceAll('\\', '/').replaceAll("'", "'\"'\"'") + "'";
  const known = new Set<number>();
  const pids = async () => {
    const ids: number[] = [];
    for (const name of ['parent.json', 'leaf.json']) {
      const text = await readFile(join(directory, name), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
      if (!text) continue;
      const pid: unknown = JSON.parse(text).pid;
      if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) throw new Error('Invalid test process ID');
      known.add(pid); ids.push(pid);
    }
    return ids;
  };
  return {
    command,
    pids,
    async indexPath(): Promise<string> { return JSON.parse(await readFile(join(directory, 'parent.json'), 'utf8')).index; },
    async ready() {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) { const ids = await pids(); if (ids.length === 2 && ids.every(processAlive)) return ids; await delay(25); }
      throw new Error('Test Git descendants did not start');
    },
    async cleanup() {
      await pids();
      for (const pid of [...known].reverse()) {
        if (!processAlive(pid)) continue;
        if (process.platform === 'win32') await exec(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/F', '/T', '/PID', String(pid)], { windowsHide: true }).catch(error => { if (processAlive(pid)) throw error; });
        else process.kill(pid, 'SIGKILL');
      }
      const deadline = Date.now() + 5000;
      while ([...known].some(processAlive) && Date.now() < deadline) await delay(25);
      if ([...known].some(processAlive)) throw new Error('Test Git process cleanup failed');
    },
  };
}
