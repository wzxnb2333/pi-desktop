import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Missing value: ' + name);
  return args[index + 1];
}
const root = resolve(option('--root', tmpdir()));
const age = Number(option('--minimum-age-minutes', '60'));
if (!Number.isFinite(age) || age < 0) throw new Error('Invalid minimum age');
const rootInfo = await lstat(root);
if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || (await realpath(root)).toLowerCase() !== root.toLowerCase()) {
  throw new Error('Temp root must be a real, unlinked directory');
}
function inside(parent, path) {
  const rel = relative(parent, resolve(path));
  return rel !== '' && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../') && !isAbsolute(rel);
}
const reportOption = option('--report', '');
const report = reportOption ? resolve(reportOption) : '';
if (report && (report.toLowerCase() === root.toLowerCase() || inside(root, report))) throw new Error('Report must be outside the temp root');
if (apply && process.platform === 'win32') {
  const active = execFileSync('pwsh', ['-NoProfile', '-Command', "@(Get-Process -Name electron,'Pi Desktop' -ErrorAction SilentlyContinue).Count"], { encoding: 'utf8', windowsHide: true });
  if (Number(active.trim()) > 0) throw new Error('Stop Electron/desktop tests before cleanup');
}

// Read the exact prefixes used by this checkout; a generic pi-* name is not ownership proof.
const testRoot = fileURLToPath(new URL('../test/', import.meta.url));
const knownPrefixes = new Set();
for (const file of await readdir(testRoot, { recursive: true })) {
  if (!file.endsWith('.ts')) continue;
  const source = await readFile(join(testRoot, file), 'utf8');
  for (const match of source.matchAll(/mkdtemp\(join\(tmpdir\(\),\s*['"]([^'"]+)['"]\)\)/g)) knownPrefixes.add(match[1]);
}

async function scan(path, base = path) {
  const result = { files: [], links: [] };
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    const info = await lstat(full);
    const item = { path: full, relative: relative(base, full).replaceAll('\\', '/'), bytes: info.size };
    if (info.isSymbolicLink()) result.links.push(item);
    else if (info.isDirectory()) {
      const nested = await scan(full, base);
      result.files.push(...nested.files); result.links.push(...nested.links);
    } else if (info.isFile()) result.files.push(item);
    else throw new Error('Unsupported filesystem entry: ' + full);
  }
  return result;
}

const gitIdentities = /^(?:author|committer) (?:Acceptance Test|Desktop Test|Visual Fixture|Test|Workbench test|Scope test|Workflow test|Peer|Peer Test) <(?:test|fixture|scope|workflow|peer)@example\.invalid> [0-9]+ [+-][0-9]{4}$/gm;
// v3 split the flat model list into providers and models; a legacy document only carries `providers`.
const KNOWN_DATA_VERSIONS = [1, 2, 3];
const modelsEmpty = state => (state.settings?.providers?.length ?? 0) === 0
  && (state.settings?.modelProviders?.length ?? 0) === 0 && (state.settings?.models?.length ?? 0) === 0;
async function gitRemnants(files) {
  let commits = 0;
  for (const file of files) {
    const match = file.relative.match(/(?:^|\/)(?:\.git|remote\.git)\/objects\/([a-f0-9]{2})\/([a-f0-9]{38})$/);
    if (!match || file.bytes > 1024 * 1024) return false;
    const data = inflateSync(await readFile(file.path), { maxOutputLength: 1024 * 1024 });
    if (createHash('sha1').update(data).digest('hex') !== match[1] + match[2]) return false;
    const zero = data.indexOf(0);
    const header = data.subarray(0, zero).toString().match(/^(blob|tree|commit) ([0-9]+)$/);
    if (!header || data.length - zero - 1 !== Number(header[2])) return false;
    if (header[1] === 'commit') {
      if ([...data.subarray(zero + 1).toString().matchAll(gitIdentities)].length !== 2) return false;
      commits++;
    }
  }
  return commits > 0;
}

async function identify(path, prefix, contents) {
  const { files, links } = contents;
  const paths = files.map(file => file.relative);
  if (prefix === 'pi-desktop-tests-') {
    const marker = files.find(file => file.relative === '.pi-test-owner.json');
    if (!marker) throw new Error('Missing test owner marker');
    const owner = JSON.parse(await readFile(marker.path, 'utf8'));
    if (owner.kind !== 'pi-desktop-test' || owner.version !== 1 || resolve(owner.root) !== path || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error('Invalid owner marker');
    try { process.kill(owner.pid, 0); throw new Error('Owner process is running'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    return 'Inactive owned test worker';
  }
  if (!files.length && !links.length) return 'Empty temporary tree';
  if (!knownPrefixes.has(prefix)) throw new Error('Prefix not declared by desktop tests');
  if (!files.length) return 'Empty test tree with links (targets preserved)';
  if (/^pi-(?:acceptance|desktop-e2e|desktop-first|desktop-visual)-$/.test(prefix) && paths.includes('desktop.json')) {
    const state = JSON.parse(await readFile(join(path, 'desktop.json'), 'utf8'));
    if (!KNOWN_DATA_VERSIONS.includes(state.version)) throw new Error('Unknown desktop profile version');
    if (prefix === 'pi-desktop-first-' && state.projects?.length === 0 && state.threads?.length === 0 && modelsEmpty(state)) {
      const project = await lstat(join(path, '新项目'));
      if (project.isDirectory() && !project.isSymbolicLink()) return 'Empty first-run test profile';
    }
    const expectedProject = prefix === 'pi-acceptance-' ? 'project' : prefix === 'pi-desktop-first-' ? '新项目' : 'demo-project';
    if (!Array.isArray(state.projects) || !state.projects.length || !state.projects.every(project => resolve(project.path) === join(path, expectedProject))) throw new Error('Profile references a foreign project');
    if (!Array.isArray(state.threads) || !state.threads.every(thread => inside(path, thread.cwd))) throw new Error('Profile references a foreign session');
    return 'Local desktop fixture profile';
  }
  if (/^pi-(?:composer|settings|sidebar|primitives|panels)-$/.test(prefix) && paths.every(file => ['harness.js', 'harness.css', 'index.html'].includes(file)) && paths.includes('harness.js')) {
    const bundle = await readFile(join(path, 'harness.js'), 'utf8');
    if (bundle.includes('src/renderer/src/') && bundle.includes('react')) return 'Compiled desktop UI test harness';
  }
  const repoPath = prefix === 'pi-workflow-' ? join(path, 'local') : path;
  const repoPrefixes = ['pi diff ', 'pi git 中文 ', 'pi-workflow-', 'pi-commit-scope-', 'pi-git-rebase-'];
  if (repoPrefixes.includes(prefix) && paths.includes(relative(path, join(repoPath, '.git/config')).replaceAll('\\', '/'))) {
    const config = await readFile(join(repoPath, '.git/config'), 'utf8');
    if (/^\s*name\s*=\s*(Test|Workbench test|Scope test|Workflow test)\s*$/m.test(config) && /^\s*email\s*=\s*(test|scope|workflow)@example\.invalid\s*$/m.test(config)) return 'Fixture Git repository';
  }
  if (await gitRemnants(files)) return 'Verified fixture Git objects';
  const literals = {
    'pi-path-': { '文档.txt': 'hello' },
    'pi-skill-': { 'SKILL.md': 'skill content' },
    'pi-purge-': { 'agent/sessions/original/fork.jsonl': 'KEEP_OR_DELETE', 'attachments/original/picked/shared.txt': 'KEEP_OR_DELETE' },
    'pi-purge-boundary-': { 'project.jsonl': 'EXTERNAL' },
    'pi-purge-project-': { 'important.txt': 'PROJECT' },
    'pi-files-': { '中文.txt': 'external\n', 'binary.dat': Buffer.from([0, 1, 2]), 'legacy.txt': Buffer.from([255, 254, 1]) },
  };
  if (literals[prefix]) {
    for (const file of files) {
      const value = literals[prefix][file.relative];
      if (value === undefined || !(await readFile(file.path)).equals(Buffer.from(value))) throw new Error('Unexpected test file content');
    }
    return 'Exact unit test data';
  }
  if (prefix === 'pi-recovery-' && paths.every(file => /^recovery\/[0-9]+-[a-f0-9-]+\/文件 hello\.txt$/.test(file))) {
    if ((await Promise.all(files.map(file => readFile(file.path, 'utf8')))).every(text => text === 'modified\n')) return 'Fixture rollback copy';
  }
  if (prefix === 'pi-store-' && paths.every(file => /^desktop\.json(?:\.bak|\.corrupt-[0-9]+)?$/.test(file))) {
    for (const file of files) {
      const text = await readFile(file.path, 'utf8');
      if (text === '{broken') continue;
      const state = JSON.parse(text);
      if (!KNOWN_DATA_VERSIONS.includes(state.version) || state.projects?.length !== 0 || state.threads?.length !== 0 || !modelsEmpty(state)) throw new Error('Nonempty metadata store');
    }
    return 'Empty unit test metadata store';
  }
  if (prefix === 'pi-vault-' && paths.length === 1 && paths[0] === 'secrets.json') {
    const text = await readFile(files[0].path, 'utf8');
    if (text.includes(Buffer.from('yek-etavirp-ks').toString('base64'))) return 'Known fake encryption fixture';
  }
  if (['pi-desktop-runtime-', 'pi-denial-', 'pi-protocol-'].includes(prefix)) {
    let sessions = 0;
    for (const file of files) {
      const text = await readFile(file.path, 'utf8');
      if (file.relative === 'created.txt' && text === 'approved file') continue;
      if (/^\.?agent\/auth\.json$/.test(file.relative)) {
        const auth = JSON.parse(text);
        if (!Object.values(auth).every(entry => entry.type === 'api_key' && ['fake', 'fake-key', 'protocol-test-key'].includes(entry.key))) throw new Error('Unknown authentication fixture');
      } else if (/^\.?agent\/sessions\/[^/]+\/[^/]+\.jsonl$/.test(file.relative)) {
        const header = JSON.parse(text.split('\n')[0]);
        if (header.type !== 'session' || resolve(header.cwd) !== path || !/"provider"\s*:\s*"(?:desktop-test|fake-(?:reject|deny|plan)|test-[^"]+)"/.test(text)) throw new Error('Unknown session fixture');
        sessions++;
      } else throw new Error('Unexpected fixture file');
    }
    if (sessions) return 'Local faux-provider session';
  }
  throw new Error('No verified desktop fixture signature');
}

const results = [];
const legacyEmptyNames = new Set(['pi-composer-final', 'pi-composer-probe']);
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!/^(?:pi-[\w-]+-|pi diff |pi git 中文 )[A-Za-z0-9]{6}$/.test(entry.name) && !legacyEmptyNames.has(entry.name)) continue;
  const path = resolve(root, entry.name);
  const item = { path, status: 'skipped', bytes: 0, links: 0, reason: '' };
  try {
    const info = await lstat(path);
    if (dirname(path) !== root || !info.isDirectory() || info.isSymbolicLink()) throw new Error('Not an unlinked immediate child directory');
    if (Date.now() - info.mtimeMs < age * 60000) throw new Error('Recent directory');
    const contents = await scan(path);
    item.bytes = contents.files.reduce((total, file) => total + file.bytes, 0);
    item.links = contents.links.length;
    item.reason = await identify(path, entry.name.slice(0, -6), contents);
    item.status = 'eligible';
    if (apply) {
      const current = await lstat(path);
      if (!current.isDirectory() || current.isSymbolicLink() || current.ino !== info.ino || (await realpath(path)).toLowerCase() !== path.toLowerCase()) throw new Error('Target changed after inspection');
      // Node removes junction/symlink entries themselves; scan never traverses their targets.
      await rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
      item.status = 'removed';
    }
  } catch (error) { item.status = 'skipped'; item.reason = error.message; }
  results.push(item);
}
const summary = { root, applied: apply, scanned: results.length, removed: 0, eligible: 0, skipped: 0, removedBytes: 0, eligibleBytes: 0 };
for (const item of results) {
  summary[item.status]++;
  if (item.status === 'removed') summary.removedBytes += item.bytes;
  if (item.status === 'eligible') summary.eligibleBytes += item.bytes;
}
if (report) {
  await mkdir(dirname(report), { recursive: true });
  await writeFile(report, JSON.stringify({ summary, directories: results }, null, 2));
}
console.log(JSON.stringify(summary));
