import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { appErrorPatterns, appErrors } from '../src/shared/app-errors.ts';
import { localizeAppError, setLocale } from '../src/shared/localization.ts';
import { messages } from '../src/shared/messages.ts';

/**
 * Every static error the main process or the worker throws ends up in the information stream, and
 * `localizeAppError` can only translate what the catalogs know. A missing entry is Chinese text in an
 * English interface, which is exactly what this test refuses to let back in.
 *
 * Messages that interpolate a value (`new Error(\`Pi 中未找到 ${'$'}{id}\`)`) cannot be keyed and are skipped here;
 * they need to be composed from `translate(...)` in the source instead.
 */
const sources = ['main', 'worker'].map(dir => join(import.meta.dirname, '..', 'src', dir));
/** Walks the desktop sources, including nested directories such as `worker/` subfolders. */
function walkTree(dir: string, visit: (path: string) => void): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkTree(path, visit);
    else if (name.endsWith('.ts')) visit(path);
  }
}

const catalog = new Set([...Object.keys(appErrors), ...Object.keys(messages)]);
const missing: string[] = [];
const interpolated: string[] = [];
for (const dir of sources) walkTree(dir, path => {
  const text = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  for (const match of text.matchAll(/new Error\((["'`])([^"'`\n]*[\u4e00-\u9fff][^"'`\n]*)\1/g)) {
    // The catalog keys hold the runtime text, so escape sequences in the source literal are unescaped first.
    const literal = match[2].replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    if (literal.includes('${')) {
      // Interpolated: swap each value for a placeholder and require a pattern that rebuilds the sentence.
      const sample = literal.replace(/\$\{[^}]*\}/g, 'VALUE');
      if (!appErrorPatterns.some(entry => entry.pattern.test(sample))) interpolated.push(literal);
      continue;
    }
    // A prefix that the source concatenates with values is covered when a pattern starts with it.
    if (appErrorPatterns.some(entry => entry.pattern.source.includes(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) || entry.pattern.source.includes(literal))) continue;
    if (catalog.has(literal)) continue;
    missing.push(path.slice(join(import.meta.dirname, '..').length + 1).replaceAll('\\', '/') + ': ' + literal.slice(0, 60));
  }
});

test('the scan finds the desktop error surface', () => {
  assert(catalog.size > 200, 'the catalogs should be loaded, found ' + catalog.size + ' keys');
  assert.equal(interpolated.length, 0, 'interpolated messages must match a pattern: ' + interpolated.join(' | '));
});

test('localizeAppError rebuilds interpolated messages instead of leaking Chinese', () => {
  setLocale('en-US');
  assert.equal(localizeAppError('Pi 进程退出（5），会话已保留'), 'The Pi process exited (5). The session was kept');
  assert.equal(localizeAppError('Pi 中未找到 openai/gpt-4，请检查模型 ID 或改用自定义提供商'), 'Pi could not find openai/gpt-4. Check the model id or use a custom provider');
  assert.equal(localizeAppError('本地 MCP 缺少启动命令'), '本地 MCP has no launch command');
  assert.match(localizeAppError('迁移已停止，外部修改已保留；恢复记录 abc，需检查：a、b'), /Recovery record abc, check: a、b$/);
  assert.equal(localizeAppError('会话已删除'), 'This session was deleted');
  setLocale('zh-CN');
});

test('every static thrown error has an English entry', () => {
  assert.deepEqual(missing, [], 'untranslated error texts: ' + missing.join(' | '));
});
