import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { build } from 'esbuild';

// Local, deterministic review pages. Vendor JavaScript and real user data never execute here.
const root = resolve(import.meta.dirname, '../../..');
const output = resolve(root, '.artifacts/desktop-visual/preview');
const reference = JSON.parse(await readFile(resolve(root, 'docs/desktop/reference-surfaces.json'), 'utf8'));
const theme = JSON.parse(await readFile(resolve(root, 'docs/desktop/reference-contract.json'), 'utf8'));
const assets = resolve(root, '.artifacts/codex-reference', reference.msixVersion, 'webview/assets');
const styles = [];
for (const source of reference.sources.filter(source => source.file.endsWith('.css'))) {
  const bytes = await readFile(resolve(assets, source.file));
  if (createHash('sha256').update(bytes).digest('hex') !== source.sha256)
    throw new Error('Reference source hash mismatch: ' + source.file);
  styles.push(bytes.toString('utf8'));
}
await mkdir(output, { recursive: true });
for (const [name, entry] of [['app', 'reference-harness'], ['surface', 'surfaces-harness']]) {
  await build({
    entryPoints: [resolve(root, `apps/desktop/test/e2e/fixtures/${entry}.tsx`)],
    outfile: resolve(output, name + '.js'), bundle: true, format: 'iife', platform: 'browser',
    jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent',
  });
}
const files = new Map();
for (const name of ['app.js', 'app.css', 'surface.js', 'surface.css'])
  files.set('/' + name, await readFile(resolve(output, name)));
const scenes = Object.keys(reference.fixtures);
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'");
  if (files.has(url.pathname)) {
    response.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
    response.end(files.get(url.pathname));
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (['/app', '/surface'].includes(url.pathname)) {
    const name = url.pathname.slice(1);
    response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Pi Desktop 视觉验收</title><div id="root"></div><link rel="stylesheet" href="/${name}.css"><style>.surface-anchor{position:fixed;left:48px;top:180px;width:220px;height:32px}.surface-anchor :is(.menu,.tooltip-anchor){width:100%;height:100%}.surface-anchor button{width:100%;height:32px}</style><script src="/${name}.js"></script></html>`);
    return;
  }
  if (url.pathname === '/reference' && scenes.includes(url.searchParams.get('scene'))) {
    const mode = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light';
    const injected = Object.entries(theme.injectedThemes[mode]).map(([key, value]) => `${key}:${value};`).join('');
    response.end(`<!doctype html><html lang="zh-CN" data-codex-window-type="electron" data-codex-window-chrome="application-menu" data-codex-os="win32" class="electron-opaque" data-theme="${mode}" style="${theme.injectedFonts}"><meta charset="utf-8"><title>Codex 固定源码参考</title><style>@layer theme,base,components,utilities;${styles.join('')}@layer theme {:where(:root:not([data-codex-window-type=extension]))[data-theme] {${injected}}}</style><body style="height:100vh;background:var(--color-surface);${theme.injectedFonts}">${reference.fixtures[url.searchParams.get('scene')]}</body></html>`);
    return;
  }
  if (url.pathname === '/') {
    response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>视觉验收入口</title><h1>固定源码与 Pi 组件</h1><p>仅包含本地测试数据；参考页不执行厂商脚本。</p>' + ['light', 'dark'].map(mode => `<h2>${mode}</h2><p><a href="/app?theme=${mode}&conversation=1">Pi 工作台</a></p>` + scenes.map(scene => `<p>${scene}: <a href="/reference?theme=${mode}&scene=${scene}">Codex 源码参考</a> · <a href="/surface?theme=${mode}&scene=${scene}">Pi 真实组件</a></p>`).join('')).join('') + '</html>');
    return;
  }
  response.statusCode = 404;
  response.end('Not found');
});
server.listen(0, '127.0.0.1', async () => {
  const address = server.address();
  const url = 'http://127.0.0.1:' + address.port;
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ url, referenceVersion: reference.msixVersion, sources: reference.sources, generatedAt: new Date().toISOString() }, null, 2) + '\n');
  console.log(url);
});
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
