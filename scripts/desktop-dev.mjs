/*
 * Launcher for `npm run desktop:dev`.
 *
 * Some host environments export `ELECTRON_RUN_AS_NODE=1` (the DSH harness on this machine does).
 * Electron then starts as plain Node, and the main bundle dies on its first import with
 * `SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'`.
 * The variable belongs to whatever embedded runtime the shell came from, never to the desktop app,
 * so this wrapper drops it for the dev server and every process the dev server spawns.
 */
import { spawn } from 'node:child_process';

if (process.env.ELECTRON_RUN_AS_NODE) {
  console.log('[desktop:dev] ignoring ELECTRON_RUN_AS_NODE so Electron starts as an app, not as Node');
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// `shell: true` keeps the Windows npm shim (`npm.cmd`) resolvable and stdio inherited, so the
// dev server's output, hot reload and Ctrl+C behave exactly as if it had been started directly.
const child = spawn('npm run dev --workspace=@pi-desktop/app', { stdio: 'inherit', env, shell: true });
child.on('error', (error) => {
  console.error('[desktop:dev] ' + error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
