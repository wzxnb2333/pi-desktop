#!/usr/bin/env node
// 从已安装的 Codex Windows 应用 app.asar 中抽取“UI 还原证据”，写入 gitignored 的 .artifacts 目录。
//
//   node apps/desktop/scripts/codex-reference.mjs [--archive <path>] [--out <dir>]
//
// 设计约束（都是踩过的坑，改动前请先读 docs/desktop/reference-extraction.md）：
//   1. 参考安装不一定存在。找不到 app.asar 时打印说明并 exit 0，绝不允许 build/check 依赖它。
//   2. asar.listPackage() 在 Windows 上返回“带前导反斜杠、反斜杠分隔”的路径，而
//      asar.extractFile()/statFile() 只接受“无前导分隔符、反斜杠分隔”的路径；
//      正斜杠路径会静默抛 "… was not found in this archive"。
//      因此：内部一律用 normalizedPath（正斜杠、无前导斜杠）做存储/展示，
//      调用 extractFile 前用 toAsarPath() 转回反斜杠。
//   3. 保留全部前端 JS 依赖、CSS、SVG 和字体；仅美化入口与相关桌面模块。
//   4. 任一分类抽到 0 个文件即 exit 1：静默的空抽取会伪造保真度证据。
//   5. 不抽取的厂商代码必须在 manifest.omitted 里写明原因，保持沉默不可接受。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import asar from '@electron/asar';
import { readArchiveHeaderSync } from '@electron/asar/lib/disk.js';
import { transformSync } from 'esbuild';

/** 反斜杠。用字面量拼接是为了在任何 shell/heredoc 传参下都不被吃掉。 */
const BS = String.fromCharCode(92);

/** 本机参考安装（MSIX 包目录）。WindowsApps 根目录禁止列目录，但已知完整路径可以直接穿透读取。 */
const REFERENCE_MSIX = '26.917.9434.0';
const REFERENCE_APP = '26.917.71314';

function installedArchive() {
  if (process.platform !== 'win32') return undefined;
  try {
    const location = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-AppxPackage 'OpenAI.Codex' | Where-Object { $_.Version -eq '${REFERENCE_MSIX}' } | Select-Object -First 1 -ExpandProperty InstallLocation`,
      ],
      { encoding: 'utf8', windowsHide: true },
    ).trim();
    return location ? path.join(location, 'app', 'resources', 'app.asar') : undefined;
  } catch {
    return undefined;
  }
}

const SCRIPT_DIR = import.meta.dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');

function parseArgs(argv) {
  const out = { archive: undefined, out: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--archive' || arg === '--out') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) fail(`${arg} 缺少值`);
      out[arg.slice(2)] = value;
    } else if (arg === '--help' || arg === '-h') out.help = true;
    else fail(`未知参数：${arg}`);
  }
  return out;
}

function fail(message) {
  console.error(`[codex-reference] 失败：${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------- 路径规范化

/** asar 内部原始路径（反斜杠、可能有前导分隔符）→ 展示/存储用路径。 */
function fromAsarPath(raw) {
  return raw.split(BS).join('/').replace(/^\/+/, '');
}

/** 展示用路径 → extractFile()/statFile() 需要的路径（反斜杠、无前导分隔符）。 */
function toAsarPath(normalized) {
  return normalized.split('/').join(BS);
}

// ---------------------------------------------------------------- 白名单定义

const ASSET_DIR = 'webview/assets';

/** 桌面分支判定：webview/assets 下文件名以 local- 开头或含 .electron 的 chunk。 */
const DESKTOP_PATTERNS = ['local-*.js', '*.electron*.js'];

/** 按名字匹配的交互证据 chunk（.js）。对应的 .css 由全量 CSS 分类覆盖。 */
const NAMED_JS_PATTERNS = [
  'app-initial-*.js',
  'app-primary-*.js',
  'app-shared-*.js',
  'thread-scroll-layout-*.js',
  'pane-layout-*.js',
  'page-layout-*.js',
  'composer*.js',
  'composer-state*.js',
  'composer-utility-bar*.js',
  'composer-action-bar-*.js',
  'conversation-blocks*.js',
  'local-conversation-*.js',
  'diff*.js',
  'file-diff*.js',
  'code-diff*.js',
  'ansi-block*.js',
  'xterm-window-zoom*.js',
  'background-terminal*.js',
  '*settings*.js',
  'automation*.js',
  'agent-menu*.js',
  'split-items-into-render-groups*.js',
  'timestamps*.js',
  'command-menu-dialog*.js',
  'global-command-menu-dialog*.js',
  'sidebar*.js',
  'placement*.js',
  'button*.js',
  'controls*.js',
  'layout*.js',
  'tab-content*.js',
  'profile*.js',
  // 本任务补充：命令注册表（capability-matrix 的命令面板一行要靠它取证）
  'command-messages-*.js',
];

/** Electron 主进程/preload 侧证据。main-*.js 与 worker.js 太大，只登记不抽取。 */
const VITE_PATTERNS = [
  'preload.js',
  'sandbox-preload.js',
  'service-*.js',
  'desktop-open-path-queue-*.js',
  'windows-file-copy-*.js',
  'logger-*.js',
  'capture-*.js',
  'early-bootstrap.js',
  'electron-resources-path-*.js',
  'bootstrap-*.js',
  'core-*.js',
];
const VITE_SKIP = ['main-*.js', 'worker.js'];

const OTHER_WHITELIST = ['webview/index.html', 'package.json'];

/** 不进入前端证据目录的后台代码、位图和音频。 */
const OMITTED = [
  {
    pattern: '.vite/build/main-*.js',
    reason:
      '多 MB 主进程 bundle，含全部厂商代码，阅读成本远高于收益；主进程能力面已由 contracts.ts 的封闭 IPC op 联合类型界定。',
  },
  { pattern: '.vite/build/worker.js', reason: '多 MB 后台 worker bundle，同上。' },
  {
    pattern: '.vite/build/browser-page-preload.js',
    reason: 'Codex 内置浏览器页内注入（含元素选择/devtools）；Pi preview.* 只有 open/bounds/close/refresh。',
  },
  {
    pattern: '.vite/build/src-*.js, dist-*.js, rolldown-runtime-*.js, upload-*.js',
    reason: '厂商打包产物，无 UI 语义。',
  },
  { pattern: 'node_modules/**', reason: '后台依赖不作为前端 UI 证据。' },
  { pattern: 'native-menu-locales/**', reason: 'Pi 原生菜单继续由已有 Electron 模板提供。' },
  {
    pattern: 'webview/assets/*.webp|*.png|*.ogg|*.wav|*.wasm',
    reason: '本轮只分析代码、CSS、SVG 路径和字体，不使用位图、音频或执行 WASM。',
  },
];

function globToRegExp(glob) {
  return new RegExp(
    '^' +
      glob
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      '$',
  );
}

function matchCount(pattern, pool) {
  const rx = globToRegExp(pattern);
  return pool.filter((p) => rx.test(path.posix.basename(p))).length;
}

// ---------------------------------------------------------------- 工具

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function sha256File(file, label) {
  const hash = crypto.createHash('sha256');
  const size = fs.statSync(file).size;
  let done = 0;
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file, { highWaterMark: 16 * 1024 * 1024 });
    stream.on('data', (chunk) => {
      hash.update(chunk);
      done += chunk.length;
      if (done % (128 * 1024 * 1024) < 16 * 1024 * 1024)
        process.stdout.write(
          `\r[codex-reference] ${label} SHA-256 ${(done / 1048576).toFixed(0)} / ${(size / 1048576).toFixed(0)} MB`,
        );
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  process.stdout.write('\n');
  return hash.digest('hex');
}

function prettyPrint(buffer, loader, sourceName) {
  const result = transformSync(buffer.toString('utf8'), {
    loader,
    minify: false,
    charset: 'utf8',
    sourcefile: sourceName,
    logOverride: { default: 'silent' },
  });
  return Buffer.from(result.code, 'utf8');
}

// ---------------------------------------------------------------- 主流程

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('用法：node apps/desktop/scripts/codex-reference.mjs [--archive <app.asar>] [--out <dir>]');
    return 0;
  }
  const located = args.archive ?? installedArchive();
  if (!located) {
    console.log(
      `[codex-reference] 未找到固定参考 ${REFERENCE_MSIX}；可用 --archive 指定归档。正常构建不依赖参考安装。`,
    );
    return 0;
  }
  const archive = path.resolve(located);
  if (!fs.existsSync(archive)) {
    console.log(
      `[codex-reference] 跳过：未找到 Codex 参考安装\n  查找路径：${archive}\n  本脚本不参与构建校验，缺少参考安装时按 exit 0 处理。\n  需要证据时安装 OpenAI.Codex MSIX 或用 --archive 指到 app.asar。`,
    );
    return 0;
  }

  const archiveBytes = fs.statSync(archive).size;
  console.log(`[codex-reference] 归档 ${archive} (${archiveBytes} bytes)`);

  // 1) 重新列包（不复用旧缓存：缓存用正斜杠写出，无法回喂 extractFile）
  const rawList = asar.listPackage(archive);
  const header = readArchiveHeaderSync(archive).header;
  /** @type {{path:string, bytes:number, type:'file'|'dir'}[]} */
  const walked = [];
  (function walk(node, prefix) {
    for (const [name, child] of Object.entries(node.files || {})) {
      const p = prefix ? `${prefix}/${name}` : name;
      if (child.files) {
        walked.push({ path: p, bytes: 0, type: 'dir' });
        walk(child, p);
      } else walked.push({ path: p, bytes: child.size, type: 'file' });
    }
  })(header, '');
  // listPackage 同时返回目录项，因此两数必须相等；不等说明 asar 语义变了。
  if (walked.length !== rawList.length)
    fail(`头部遍历 ${walked.length} 项 != listPackage ${rawList.length} 项`);
  const walkedSet = new Set(rawList.map(fromAsarPath));
  for (const entry of walked)
    if (!walkedSet.has(entry.path)) fail(`遍历结果不在 listPackage 中：${entry.path}`);

  const allFiles = walked.filter((e) => e.type === 'file');
  const nonVendor = allFiles.filter((e) => !e.path.startsWith('node_modules/'));
  const counts = {
    listPackageEntries: rawList.length,
    files: allFiles.length,
    directories: walked.length - allFiles.length,
    filesExcludingNodeModules: nonVendor.length,
    byRoot: Object.fromEntries(
      [
        ...nonVendor.reduce(
          (m, e) => m.set(e.path.split('/')[0], (m.get(e.path.split('/')[0]) || 0) + 1),
          new Map(),
        ),
      ].sort((a, b) => b[1] - a[1]),
    ),
    byExtension: Object.fromEntries(
      [
        ...nonVendor.reduce((m, e) => {
          const base = e.path.split('/').pop();
          const dot = base.lastIndexOf('.');
          m.set(dot > 0 ? base.slice(dot) : '(none)', (m.get(dot > 0 ? base.slice(dot) : '(none)') || 0) + 1);
          return m;
        }, new Map()),
      ].sort((a, b) => b[1] - a[1]),
    ),
  };
  console.log(
    `[codex-reference] 条目 ${counts.listPackageEntries}（文件 ${counts.files} + 目录 ${counts.directories}），非 node_modules 文件 ${counts.filesExcludingNodeModules}`,
  );

  // 2) 归档整体 SHA-256（流式，361 MB 不进内存）
  const archiveSha256 = await sha256File(archive, 'archive');

  // 3) 版本：MSIX 包目录版本与归档内 package.json 的 app 版本不同，两者都记录。
  //    本参考：包目录 26.917.9434.0，package.json version = 26.917.71314。
  const pkgBytes = asar.extractFile(archive, toAsarPath('package.json'));
  const codexVersion = JSON.parse(pkgBytes.toString('utf8')).version;
  if (!codexVersion) fail('归档 package.json 无 version 字段');
  const msixVersion = /Codex_(\d+\.\d+\.\d+\.\d+)_/.exec(archive)?.[1];
  if (codexVersion !== REFERENCE_APP || (msixVersion && msixVersion !== REFERENCE_MSIX))
    fail(`参考版本不匹配：需要 ${REFERENCE_MSIX} / ${REFERENCE_APP}，实际 ${msixVersion} / ${codexVersion}`);

  // 输出目录沿用 MSIX 版本号，和既有 .artifacts/codex-reference/<ver>/ 缓存保持一致。
  const outDir = args.out
    ? path.resolve(args.out)
    : path.join(REPO_ROOT, '.artifacts', 'codex-reference', String(msixVersion ?? codexVersion));
  fs.mkdirSync(outDir, { recursive: true });

  // 4) 重写可用的文件清单（保留正斜杠路径 + asarPath 反斜杠路径）
  fs.writeFileSync(
    path.join(outDir, 'archive-file-list.json'),
    JSON.stringify(
      {
        generatedBy: 'apps/desktop/scripts/codex-reference.mjs',
        archivePath: archive,
        archiveBytes,
        archiveSha256,
        codexVersion,
        appVersion: codexVersion,
        msixVersion: msixVersion ?? null,
        note: 'asarPath 是 extractFile/statFile 接受的形态（反斜杠、无前导分隔符）；path 是展示用形态。旧版本此文件只有正斜杠字符串，无法回喂 extractFile。',
        entries: walked.map((e) => ({
          path: e.path,
          asarPath: toAsarPath(e.path),
          type: e.type,
          bytes: e.bytes,
        })),
      },
      undefined,
      1,
    ),
  );

  // 5) 组白名单
  function pick(pool, patterns) {
    const set = new Set();
    for (const g of patterns) {
      const rx = globToRegExp(g);
      for (const p of pool) if (rx.test(path.posix.basename(p))) set.add(p);
    }
    return [...set].sort();
  }

  const assetPaths = nonVendor.filter((e) => e.path.startsWith(`${ASSET_DIR}/`)).map((e) => e.path);
  const cssPaths = nonVendor.filter((e) => e.path.endsWith('.css')).map((e) => e.path);
  const viteAll = nonVendor.filter((e) => e.path.startsWith('.vite/build/')).map((e) => e.path);
  const desktopPaths = pick(assetPaths, DESKTOP_PATTERNS);
  const namedPaths = pick(assetPaths, NAMED_JS_PATTERNS).filter((p) => !desktopPaths.includes(p));
  const vitePaths = pick(viteAll, VITE_PATTERNS);
  const skippedBig = viteAll.filter((p) =>
    VITE_SKIP.some((g) => globToRegExp(g).test(path.posix.basename(p))),
  );
  const present = new Set(nonVendor.map((e) => e.path));
  const otherPaths = OTHER_WHITELIST.filter((p) => present.has(p));
  for (const p of OTHER_WHITELIST) if (!present.has(p)) fail(`白名单要求的文件不在归档里：${p}`);

  // Preserve dependency evidence without executing the vendor application. The shared entrypoints
  // contain lazy import maps as well as static imports, so retain every local JS dependency.
  const dependencyPaths = assetPaths.filter(
    (p) => p.endsWith('.js') && !desktopPaths.includes(p) && !namedPaths.includes(p),
  );
  const resourcePaths = assetPaths.filter((p) => /\.(?:svg|woff2?|ttf|otf)$/.test(p));

  const categories = [
    { name: 'css', role: 'css', paths: cssPaths },
    { name: 'js-desktop', role: 'js', paths: desktopPaths },
    { name: 'js-named', role: 'js', paths: namedPaths },
    { name: 'js-dependency', role: 'js', paths: dependencyPaths },
    { name: 'ui-resource', role: 'resource', paths: resourcePaths },
    { name: 'vite', role: 'js', paths: vitePaths },
    { name: 'html', role: 'html', paths: otherPaths.filter((p) => p.endsWith('.html')) },
    { name: 'meta', role: 'meta', paths: otherPaths.filter((p) => p.endsWith('.json')) },
  ];

  // 6) 抽取 + 美化副本
  /** @type {{asarPath:string, normalizedPath:string, bytes:number, sha256:string, role:string, prettyPrinted:boolean, category:string}[]} */
  const entries = [];
  const prettyFailed = [];
  const seen = new Set();
  for (const cat of categories) {
    if (cat.paths.length === 0) fail(`分类 ${cat.name} 抽到 0 个文件（拒绝产出空证据）`);
    for (const normalized of cat.paths) {
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      const buf = asar.extractFile(archive, toAsarPath(normalized));
      if (!buf || buf.length === 0) fail(`抽取到空文件：${normalized}`);
      // The reference's own package.json must not keep its name on disk: scripts/check-pinned-deps.mjs
      // walks every package.json in the tree (skipping only .git/dist/node_modules) and would fail
      // `npm run check` on the reference app's caret ranges.
      const stored = normalized === 'package.json' ? 'codex-package.json' : normalized;
      const dest = path.join(outDir, ...stored.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      let pretty = false;
      if (normalized.endsWith('.css') || (normalized.endsWith('.js') && cat.name !== 'js-dependency')) {
        try {
          const code = prettyPrint(buf, normalized.endsWith('.css') ? 'css' : 'js', normalized);
          fs.writeFileSync(dest.replace(/(\.(?:css|js))$/, '.pretty$1'), code);
          pretty = true;
        } catch (error) {
          prettyFailed.push({ normalizedPath: normalized, error: String(error).split('\n')[0] });
        }
      }
      entries.push({
        asarPath: toAsarPath(normalized),
        normalizedPath: normalized,
        storedPath: stored,
        bytes: buf.length,
        sha256: sha256(buf),
        role: cat.role,
        prettyPrinted: pretty,
        category: cat.name,
      });
    }
  }

  // 7) 模式命中审计：0 命中的模式意味着参考版本结构变了，必须报出来
  const unmatchedPatterns = [];
  for (const [pattern, pool] of [
    ...DESKTOP_PATTERNS.map((g) => [g, assetPaths]),
    ...NAMED_JS_PATTERNS.map((g) => [g, assetPaths]),
    ...VITE_PATTERNS.map((g) => [g, viteAll]),
  ])
    if (matchCount(pattern, pool) === 0) unmatchedPatterns.push(pattern);

  const extractedBytes = entries.reduce((a, e) => a + e.bytes, 0);
  const manifest = {
    archivePath: archive,
    archiveBytes,
    archiveSha256,
    codexVersion,
    appVersion: codexVersion,
    msixVersion: msixVersion ?? null,
    extractedAt: new Date().toISOString(),
    counts: {
      ...counts,
      extractedFiles: entries.length,
      extractedBytes,
      prettyPrinted: entries.filter((e) => e.prettyPrinted).length,
      prettyFailed,
      byCategory: Object.fromEntries(
        categories.map((c) => [c.name, entries.filter((e) => e.category === c.name).length]),
      ),
      bytesByCategory: Object.fromEntries(
        categories.map((c) => [
          c.name,
          entries.filter((e) => e.category === c.name).reduce((a, e2) => a + e2.bytes, 0),
        ]),
      ),
      desktopBranchChunks: desktopPaths.length,
      desktopBranchBytes: entries.filter((e) => e.category === 'js-desktop').reduce((a, e) => a + e.bytes, 0),
    },
    patterns: {
      desktopBranch: DESKTOP_PATTERNS,
      namedJs: NAMED_JS_PATTERNS,
      vite: VITE_PATTERNS,
      unmatched: unmatchedPatterns,
    },
    recordedNotExtracted: skippedBig.map((p) => ({
      normalizedPath: p,
      bytes: allFiles.find((e) => e.path === p)?.bytes ?? 0,
      reason: '多 MB bundle，登记不抽取',
    })),
    omitted: OMITTED,
    entries: entries.sort((a, b) => a.normalizedPath.localeCompare(b.normalizedPath)),
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, undefined, 1));

  console.log(
    `[codex-reference] 抽取 ${entries.length} 个文件 / ${extractedBytes} bytes -> ${path.relative(REPO_ROOT, outDir).split(BS).join('/')}`,
  );
  console.log(
    `[codex-reference] 分类 ${JSON.stringify(manifest.counts.byCategory)} 字节 ${JSON.stringify(manifest.counts.bytesByCategory)}`,
  );
  console.log(
    `[codex-reference] 桌面分支 chunk ${manifest.counts.desktopBranchChunks} 个 / ${manifest.counts.desktopBranchBytes} bytes`,
  );
  console.log(
    `[codex-reference] 美化副本 ${manifest.counts.prettyPrinted} 个，失败 ${prettyFailed.length} 个`,
  );
  if (unmatchedPatterns.length)
    console.log(
      `[codex-reference] 注意：以下白名单模式命中 0 个文件（参考版本可能已改名）：${unmatchedPatterns.join(', ')}`,
    );
  if (prettyFailed.length)
    console.log(`[codex-reference] 注意：美化失败的文件见 manifest.counts.prettyFailed`);
  if (!fs.existsSync(path.join(outDir, 'manifest.json'))) fail('manifest.json 未写出');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => fail(error && error.stack ? error.stack : String(error)),
);
