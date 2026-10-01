import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { targets } from './desktop-test-targets.mjs';

export const repository = fileURLToPath(new URL('../', import.meta.url));
export const desktop = join(repository, 'apps', 'desktop');
const require = createRequire(join(desktop, 'package.json'));
const levels = ['quick', 'unit', 'ui', 'native', 'all'];

export function parseArguments(args) {
  const options = { targets: [], files: [], level: 'quick', grep: undefined, list: false, dryRun: false, help: false };
  let explicitLevel = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (['--file', '--level', '--grep'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(arg + ' 缺少值');
      if (arg === '--file') options.files.push(value);
      if (arg === '--level') { options.level = value; explicitLevel = true; }
      if (arg === '--grep') { new RegExp(value); options.grep = value; }
    } else if (arg.startsWith('-')) throw new Error('未知参数：' + arg);
    else options.targets.push(arg);
  }
  if (!levels.includes(options.level)) throw new Error('层级必须是 ' + levels.join(' / '));
  if (options.targets.length && options.files.length) throw new Error('模块名称和 --file 不能混用');
  if (options.files.length && explicitLevel) throw new Error('--file 自动识别测试类型，不需要 --level');
  if (options.grep && options.files.length !== 1) throw new Error('--grep 请配合一个 --file，避免筛选无关测试');
  if (!options.help && !options.list && !options.targets.length && !options.files.length)
    throw new Error('请指定模块或 --file；不会默认运行全套测试。使用 --list 查看模块。');
  for (const name of options.targets) if (!Object.hasOwn(targets, name)) throw new Error('未知测试模块：' + name);
  return options;
}

function testFile(input) {
  const normalized = input.split(String.fromCharCode(92)).join('/');
  const file = isAbsolute(input) ? resolve(input) : resolve(normalized.startsWith('apps/desktop/') ? repository : desktop, normalized);
  const within = relative(join(desktop, 'test'), file);
  if (!within || within.startsWith('..') || isAbsolute(within) || ['*', '?', '[', ']', '{', '}'].some(mark => input.includes(mark)))
    throw new Error('请使用 apps/desktop/test 内的明确测试文件：' + input);
  const kind = /\.test\.(?:ts|mjs)$/.test(file) ? 'unit' : /\.spec\.ts$/.test(file) ? 'ui' : undefined;
  if (!kind || !statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error('测试文件不存在或格式不支持：' + input);
  return { file, kind };
}

export function buildPlan(options) {
  const units = new Set();
  const suites = new Map();
  const addSuite = (item, kind) => {
    const { file } = testFile('test/e2e/' + item.file);
    if (item.grep) new RegExp(item.grep);
    const previous = suites.get(file);
    suites.set(file, { file, kind, grep: previous ? (!previous.grep || !item.grep ? undefined : '(?:' + previous.grep + ')|(?:' + item.grep + ')') : item.grep });
  };
  for (const name of [...new Set(options.targets)]) {
    const target = targets[name];
    for (const kind of ['unit', 'ui', 'native']) {
      if (options.level !== 'all' && options.level !== kind && !(options.level === 'quick' && kind !== 'native')) continue;
      for (const item of target[kind] ?? []) {
        if (kind === 'unit') units.add(testFile('test/' + item).file);
        else addSuite(item, kind);
      }
    }
  }
  for (const input of options.files) {
    const { file, kind } = testFile(input);
    if (kind === 'unit') units.add(file);
    else suites.set(file, { file, kind: 'explicit', grep: options.grep });
  }
  const commands = [];
  if (units.size) commands.push({
    kind: 'unit', files: [...units], executable: process.execPath, cwd: desktop,
    args: ['--import', 'tsx', '--test', '--test-reporter=tap', ...(options.grep ? ['--test-name-pattern', options.grep] : []), ...units],
  });
  for (const suite of suites.values()) {
    // Playwright file arguments are regexes. Escape and anchor, so similarly named files cannot match.
    const boundary = '(?:^|[' + String.fromCharCode(92).repeat(2) + '/])';
    const filePattern = boundary + Array.from(basename(suite.file), char => '.+*?^$()[]{}|'.includes(char) ? String.fromCharCode(92) + char : char).join('') + '$';
    commands.push({ kind: suite.kind, files: [suite.file], executable: process.execPath, cwd: desktop,
      args: [require.resolve('@playwright/test/cli'), 'test', '-c', 'playwright.nonvisual.config.ts', filePattern,
        ...(suite.grep ? ['--grep', suite.grep] : []), '--workers=1', '--retries=0', '--max-failures=1', '--reporter=list',
        '--output=' + join(repository, '.artifacts', 'desktop-targeted', 'output')],
    });
  }
  if (!commands.length) throw new Error('所选模块没有该层级的测试；使用 --list 查看，或明确选择其他层级。');
  return { targets: options.targets, files: options.files, level: options.files.length ? 'file' : options.level, commands };
}

export function runCommand(command) {
  return new Promise((done, reject) => {
    const env = { ...process.env, PI_DESKTOP_CAPTURE: '0', PI_DESKTOP_VISUAL_EVIDENCE: '0', PI_OVERLAY_EVIDENCE: '0' };
    // The runner is itself tested with node:test; its children must start a fresh test context.
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'],
      env,
    });
    let buffer = '', passed = 0, failed = 0, emptyFiles = 0, interrupted = false;
    const fileNames = new Set((command.files ?? []).flatMap(file => [file, file.split(String.fromCharCode(92)).join(String.fromCharCode(92).repeat(2))]));
    const parseLines = chunk => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? '';
      for (const line of lines) {
        // Node reports an empty filtered file as a successful file wrapper, not an executed case.
        if (line.startsWith('# Subtest: ') && fileNames.has(line.slice(11))) emptyFiles++;
        const match = /^# (pass|fail) (\d+)\s*$/.exec(line);
        if (match?.[1] === 'pass') passed = Number(match[2]);
        if (match?.[1] === 'fail') failed = Number(match[2]);
      }
    };
    child.stdout.on('data', chunk => { process.stdout.write(chunk); if (command.kind === 'unit') parseLines(chunk.toString()); });
    const interrupt = () => { interrupted = true; child.kill('SIGINT'); };
    process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
    const clear = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); };
    child.once('error', error => { clear(); reject(error); });
    child.once('close', (code, signal) => {
      clear();
      if (command.kind === 'unit') parseLines('\n');
      passed = Math.max(0, passed - emptyFiles);
      let exitCode = interrupted || signal ? 130 : code ?? 1;
      if (!exitCode && command.kind === 'unit' && passed + failed === 0) {
        console.error('没有实际执行的单测；请检查文件和 --grep，不能将全部跳过记为通过。'); exitCode = 1;
      }
      done({ exitCode, signal, ...(command.kind === 'unit' ? { passed, failed } : {}) });
    });
  });
}

export async function runPlan(plan, execute = runCommand) {
  const result = { startedAt: new Date().toISOString(), targets: plan.targets, level: plan.level, planned: plan.commands.length, steps: [], exitCode: 0 };
  for (const command of plan.commands) {
    console.log('\n[' + command.kind + '] ' + command.files.map(file => relative(desktop, file)).join(', '));
    const start = Date.now();
    let outcome;
    try { outcome = await execute(command); }
    catch (error) { outcome = { exitCode: 1, error: String(error) }; console.error(String(error)); }
    result.steps.push({ ...command, ...outcome, durationMs: Date.now() - start });
    if (outcome.exitCode) { result.exitCode = outcome.exitCode; break; }
  }
  result.finishedAt = new Date().toISOString();
  return result;
}

const help = [
  '桌面定向测试（默认不运行 Electron 或完整测试集）',
  '  npm run desktop:test:target -- toolbar',
  '  npm run desktop:test:target -- browser --level native',
  "  npm run desktop:test:target -- --file test/e2e/browser.nonvisual.spec.ts --grep 'browser overflow'",
  "  npm run desktop:test:target -- --file test/layout.test.ts --grep 'summary and tools'",
  '  npm run desktop:test:target -- toolbar --dry-run',
  '  npm run desktop:test:list',
  '',
  '--level quick（默认）：选中模块的单测和浏览器 UI 测试',
  '--level unit / ui / native：仅所选层级',
  '--level all：所选模块的全部层级，仍不运行其他模块',
  '--file：明确文件，可重复；--grep：仅对一个明确文件筛选用例名称',
  '--dry-run：只显示实际执行计划；--list：模块与层级清单',
  '无参数、未知模块和无匹配测试均不会退回完整测试集。',
].join('\n');

export async function main(args) {
  let options;
  try { options = parseArguments(args); } catch (error) { console.error(String(error) + '\n\n' + help); return 2; }
  if (options.help) { console.log(help); return 0; }
  if (options.list) {
    for (const [name, target] of Object.entries(targets)) console.log(name.padEnd(18) + target.label + ' [' + ['unit', 'ui', 'native'].filter(kind => target[kind]?.length).join(', ') + ']');
    return 0;
  }
  let plan;
  try { plan = buildPlan(options); } catch (error) { console.error(String(error)); return 2; }
  if (options.dryRun) { console.log(JSON.stringify(plan, null, 2)); return 0; }
  const result = await runPlan(plan);
  const report = join(repository, '.artifacts', 'desktop-targeted', 'last-run.json');
  await mkdir(join(repository, '.artifacts', 'desktop-targeted'), { recursive: true });
  await writeFile(report, JSON.stringify(result, null, 2) + '\n');
  console.log('\n定向测试退出码：' + result.exitCode + '；记录：' + report);
  return result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(error); process.exitCode = 1; });
}
