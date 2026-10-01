import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

// This oracle never imports Pi CSS or React components. Regeneration alone needs the extraction.
const root = resolve(import.meta.dirname, '../../..');
const input = resolve(root, process.argv[2] ?? '.artifacts/codex-reference/26.917.9434.0/webview/assets');
const theme = JSON.parse(readFileSync(resolve(root, 'docs/desktop/reference-contract.json'), 'utf8'));
const cssFiles = ['app-shared-fa570b9eb9dd.css', 'app-initial-e8ceb32eb626.css', 'app-primary-484df789f2f5.css'];
const anchors = {
  'app-shared-dc8f183e4945.js': ['k5=e=>', 'k5 as Qp', 'wdt={duration:300/1e3,ease:[.19,1,.22,1]}'],
  'app-initial-fc9a33fdda88.js': ['function MMi(', 'function BMi(', 'function xMi(', 'function _Mi('],
  'conversation-blocks-dbf9cc487eb4.js': ['function C_(', 'function D_(', 'function Rx(', 'function Ww(', 'function ux(', 'j_=1e3'],
  'agent-activity-units-ebdc48135dc2.js': ['function qe(', 'function Je('],
  'tool-activity-disclosure-65375d723bb8.js': ['function x(', 'inert:!O'],
};
const sources = [...cssFiles, ...Object.keys(anchors)].map(file => {
  const bytes = readFileSync(resolve(input, file));
  const source = bytes.toString('utf8');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (cssFiles.includes(file) && !theme.sources.some(prior => prior.file.endsWith('/' + file) && prior.sha256 === sha256)) throw new Error('Pinned CSS mismatch: ' + file);
  return { file, sha256, bytes: bytes.length, anchors: (anchors[file] ?? []).map(marker => {
    const index = source.indexOf(marker);
    if (index < 0) throw new Error('Missing vendor anchor: ' + file + ': ' + marker);
    return { marker, byte: Buffer.byteLength(source.slice(0, index)) };
  }) };
});
const css = '@layer theme,base,components,utilities;' + cssFiles.map(file => readFileSync(resolve(input, file), 'utf8')).join('');
const shared = readFileSync(resolve(input, 'app-shared-dc8f183e4945.js'), 'utf8');
const glyphSource = shared.slice(shared.indexOf('k5=e=>'), shared.indexOf('k5=e=>') + 900);
const chevron = { viewBox: '0 0 20 20', path: /d:\x60([^\x60]+)\x60/.exec(glyphSource)?.[1] };
if (!chevron.path) throw new Error('Missing source chevron path');
const motion = { durationMs: 300, easing: [0.19, 1, 0.22, 1], summaryThrottleMs: 1000 };
const header = 'relative inline-flex max-w-full min-w-0 items-center gap-1 self-start';
const summary = 'pointer-events-none relative shrink truncate text-size-chat inline-flex min-w-0 gap-1.5 items-center';
const toggle = 'absolute inset-0 cursor-interaction rounded-md';
const label = 'min-w-0 flex-1 truncate text-text/60';
function row(id, text, open, body, icon = '') {
  return '<div id="' + id + '" class="flex min-w-0 flex-col text-size-chat"><div id="' + id + '-header" class="' + header + '"><button id="' + id + '-toggle" aria-expanded="' + open + '" class="' + toggle + '"></button><span id="' + id + '-summary" class="' + summary + '">' + icon + '<span id="' + id + '-label" class="' + label + '">' + text + '</span></span><span class="pointer-events-none relative flex"><svg id="' + id + '-chevron" class="icon-2xs shrink-0 text-text/60" style="opacity:' + (open ? '1' : '0') + '" viewBox="0 0 16 16"></svg></span></div>' + (open ? body : '') + '</div>';
}
const fileLink = '<button id="file-link" data-agent-activity-file-link="true" class="pointer-events-auto relative inline-flex max-w-full truncate align-bottom underline decoration-dotted decoration-[0.5px] underline-offset-2 text-tertiary border-transparent border-0 p-0 rounded-md items-center" style="font:inherit">app.ts</button>';
const fixtures = {
  row: row('row', '读取文件', true, '<div id="row-body" class="flex flex-col gap-2 pt-2 pb-1 ps-6"><span>工具输出</span></div>'),
  group: row('group', '2 次读取、1 次搜索', true, '<div id="group-body" class="flex flex-col gap-[var(--conversation-grouped-item-gap,4px)] pt-1"><span>已读取 app.ts</span><span>已搜索 export</span></div>'),
  file: row('file', '已读取 ' + fileLink, false, '', '<svg width="16" height="16" class="shrink-0 text-text/60"></svg>'),
  diff: '<div id="diff" class="border-default flex flex-col overflow-hidden rounded-lg border"><div id="diff-heading" class="flex items-center justify-between gap-2 border-b border-default bg-background-primary-ghost-hover/60 px-2.5 py-0.5 text-size-chat-sm text-codex-description/80"><button style="font:inherit">app.ts</button></div><div style="height:40px" class="bg-surface-tertiary"></div></div>',
};
const probes = { row: ['row', 'row-header', 'row-toggle', 'row-summary', 'row-label', 'row-chevron', 'row-body'], group: ['group', 'group-body'], file: ['file-header', 'file-label', 'file-link'], diff: ['diff', 'diff-heading'] };
const properties = ['display', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'background-color', 'border-radius', 'border-top-width', 'border-top-color', 'box-shadow', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'row-gap', 'column-gap', 'overflow-x', 'overflow-y', 'opacity'];
const browser = await chromium.launch();
const samples = [];
try {
  for (const [width, height] of [[1000, 640], [1280, 800], [1440, 940]]) for (const mode of ['light', 'dark', 'system-light', 'system-dark']) {
    const resolvedTheme = mode.endsWith('dark') ? 'dark' : 'light';
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: resolvedTheme });
    await page.route('**/*', route => route.abort());
    const injected = Object.entries(theme.injectedThemes[resolvedTheme]).map(([key, value]) => key + ':' + value + ';').join('');
    for (const [scene, markup] of Object.entries(fixtures)) {
      await page.setContent('<!doctype html><html data-codex-window-type="electron" data-codex-window-chrome="application-menu" data-codex-os="win32" class="electron-opaque" data-theme="' + resolvedTheme + '" style="' + theme.injectedFonts + '"><head><style>' + css + '@layer theme {:where(:root:not([data-codex-window-type=extension]))[data-theme] {' + injected + '}}</style></head><body style="' + theme.injectedFonts + '"><main class="text-size-chat" style="width:min(768px,calc(100vw - 64px));margin:32px auto">' + markup + '</main></body></html>');
      const measurements = await page.evaluate(({ ids, properties }) => Object.fromEntries(ids.map(id => {
        const node = document.getElementById(id); const style = getComputedStyle(node); const box = node.getBoundingClientRect();
        return [id, { css: Object.fromEntries(properties.map(key => [key, style.getPropertyValue(key)])), rect: { x: box.x, y: box.y, width: box.width, height: box.height } }];
      })), { ids: probes[scene], properties });
      samples.push({ width, height, mode, scene, measurements });
    }
    await page.close();
  }
} finally { await browser.close(); }
writeFileSync(resolve(root, 'docs/desktop/reference-activity.json'), JSON.stringify({ msixVersion: theme.msixVersion, appVersion: theme.appVersion, sources, chevron, motion, fixtures, samples, limits: ['Controlled primitives, not the entire conversation host', 'Pi edit body uses validated tool diff instead of vendor patch metadata', 'Tool glyph mapping is a Pi capability adaptation'] }, null, 2) + '\n');
writeFileSync(resolve(root, 'apps/desktop/src/renderer/src/components/timeline/activity-source.ts'), '// Pinned app-shared k5 (Qp) glyph. Regenerate with scripts/reference-activity.mjs.\nexport const activityChevron = ' + JSON.stringify(chevron, null, 2) + ' as const;\n');
console.log('Wrote ' + samples.length + ' independent source measurements');
const declarations = mode => {
  const file = samples.find(sample => sample.mode === mode && sample.scene === 'file').measurements;
  const diff = samples.find(sample => sample.mode === mode && sample.scene === 'diff').measurements;
  return '--activity-file-color:' + file['file-link'].css.color + ';--activity-diff-description:' + diff['diff-heading'].css.color + ';--activity-diff-background:' + diff['diff-heading'].css['background-color'] + ';';
};
writeFileSync(resolve(root, 'apps/desktop/src/renderer/src/styles/activity-theme.css'), '/* Source-only activity oracle; pinned vendor theme, no Pi measurements. */\n:root {' + declarations('light') + '}\n:root[data-theme="dark"] {' + declarations('dark') + '}\n@media (prefers-color-scheme: dark) {:root[data-theme="system"] {' + declarations('dark') + '}}\n');
