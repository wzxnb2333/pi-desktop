import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

// Supplement Satang's uncaptured states with separate, pinned source evidence.
const root = resolve(import.meta.dirname, '../../..');
const input = resolve(root, '.artifacts/codex-reference/26.917.9434.0/webview/assets');
const theme = JSON.parse(readFileSync(resolve(root, 'docs/desktop/reference-contract.json'), 'utf8'));
const cssFiles = ['app-shared-fa570b9eb9dd.css', 'app-initial-e8ceb32eb626.css', 'app-primary-484df789f2f5.css'];
const anchors = {
  'app-primary-a7ff54c980af.js': ['function WQ(', 'function z$(', 'function V8(', 'data-codex-approval-surface'],
  'app-initial-fc9a33fdda88.js': ['function AJi(', 'size-14'],
  'app-shared-dc8f183e4945.js': ['function c8(', 'h-token-button-composer px-'],
};
const sources = [...cssFiles, ...Object.keys(anchors)].map(file => {
  const bytes = readFileSync(resolve(input, file));
  const source = bytes.toString('utf8');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (cssFiles.includes(file) && !theme.sources.some(prior => prior.file.endsWith('/' + file) && prior.sha256 === sha256)) throw new Error('Pinned CSS mismatch: ' + file);
  return { file, sha256, bytes: bytes.length, anchors: (anchors[file] ?? []).map(marker => {
    const index = source.indexOf(marker);
    if (index < 0) throw new Error('Missing source anchor: ' + file + ': ' + marker);
    return { marker, byte: Buffer.byteLength(source.slice(0, index)) };
  }) };
});
const classes = {
  approval: 'flex flex-col overflow-hidden rounded-3xl border border-default text-default focus:outline-none bg-surface-elevated-secondary @container/approval-card',
  content: 'flex min-w-0 flex-col gap-2 px-4 pt-4 pb-3',
  header: 'flex min-w-0 flex-col gap-2',
  titles: 'flex min-w-0 flex-col gap-0.5',
  eyebrow: 'flex items-center gap-2 text-size-chat-sm leading-5 font-normal text-secondary',
  title: 'min-w-0 leading-5 wrap-anywhere text-size-chat font-medium text-default',
  description: 'text-size-chat-sm text-codex-description',
  footer: 'flex items-center gap-2 px-4 pt-2 pb-4 @max-md/approval-card:flex-col @max-md/approval-card:items-stretch',
  actions: 'ms-auto flex min-w-0 items-center gap-2 @max-md/approval-card:ms-0 @max-md/approval-card:w-full @max-md/approval-card:flex-col @max-md/approval-card:items-stretch',
  loading: 'flex items-center justify-center relative size-full bg-transparent',
  loadingContent: 'flex flex-col items-center gap-2',
  logo: 'size-14',
};
const button = 'no-drag cursor-interaction items-center select-none focus:outline-hidden disabled:cursor-default disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 border gap-1 whitespace-nowrap flex rounded-full h-token-button-composer px-(--padding-button-composer-inline,calc(var(--spacing)*2)) py-0 text-(length:--text-button-composer,var(--text-sm)) leading-(--line-height-button-composer,18px) @max-md/approval-card:justify-center';
const outline = button + ' border-default bg-primary-soft-alpha not-disabled:not-aria-disabled:hover:bg-primary-ghost-hover';
const primary = button + ' border-default bg-primary-solid not-disabled:not-aria-disabled:hover:bg-text/80 text-primary-solid';
const node = (id, content) => '<div id="' + id + '" class="' + classes[id] + '">' + content + '</div>';
const approval = node('approval', node('content', node('header', node('eyebrow', 'write · 需要确认') + node('titles', node('title', '允许执行此操作？') + node('description', '将更新工作区中的设置文件。')))) + node('footer', node('actions', '<button id="deny" class="' + outline + '">拒绝</button><button id="allow" class="' + primary + '">允许这一次</button>')));
const loading = node('loading', node('loadingContent', node('logo', '')));
const fixtures = { approval, loading };
const probes = { approval: ['approval', 'content', 'header', 'titles', 'eyebrow', 'title', 'description', 'footer', 'actions', 'deny', 'allow'], loading: ['loading', 'loadingContent', 'logo'] };
const properties = ['display', 'flex-direction', 'align-items', 'justify-content', 'background-color', 'color', 'border-radius', 'border-top-width', 'border-top-color', 'font-size', 'font-weight', 'line-height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'row-gap', 'column-gap', 'height', 'width', 'opacity'];
const css = '@layer theme,base,components,utilities;' + cssFiles.map(file => readFileSync(resolve(input, file), 'utf8')).join('');
const browser = await chromium.launch();
const samples = [];
try {
  for (const mode of ['light', 'dark']) for (const cardWidth of [736, 320]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, colorScheme: mode });
    await page.route('**/*', route => route.abort());
    const injected = Object.entries(theme.injectedThemes[mode]).map(([key, value]) => key + ':' + value + ';').join('');
    for (const [scene, fixture] of Object.entries(fixtures)) {
      await page.setContent('<!doctype html><html data-codex-window-type="electron" data-codex-window-chrome="application-menu" data-codex-os="win32" class="electron-opaque" data-theme="' + mode + '" style="' + theme.injectedFonts + '"><head><style>' + css + '@layer theme {:where(:root:not([data-codex-window-type=extension]))[data-theme] {' + injected + '}}</style></head><body style="height:100vh;' + theme.injectedFonts + '"><main style="width:' + cardWidth + 'px;height:100%">' + fixture + '</main></body></html>');
      const measurements = await page.evaluate(({ ids, properties }) => Object.fromEntries(ids.map(id => {
        const element = document.getElementById(id);
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return [id, { css: Object.fromEntries(properties.map(property => [property, style.getPropertyValue(property)])), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }];
      })), { ids: probes[scene], properties });
      const states = {};
      if (scene === 'approval') for (const id of ['deny', 'allow']) {
        await page.locator('#' + id).hover();
        states[id + 'Hover'] = await page.locator('#' + id).evaluate(element => getComputedStyle(element).backgroundColor);
      }
      samples.push({ mode, cardWidth, scene, measurements, states });
    }
    await page.close();
  }
} finally { await browser.close(); }
writeFileSync(resolve(root, 'docs/desktop/reference-states.json'), JSON.stringify({ msixVersion: theme.msixVersion, appVersion: theme.appVersion, method: 'Independent static DOM from pinned WQ/z$/V8/AJi and original CSS; no vendor execution, Pi imports, network or screenshots.', sources, classes, fixtures, probes, properties, samples, limits: ['Supplementary 26.917 source evidence, not a captured 26.915 Satang state.', 'Pi approval descriptions, input/select widgets and one-time replies retain Pi semantics.', 'No new persistent or scoped approval is exposed.', 'Loading retains Pi branding and visible status/error text; source evidence covers container geometry, not glyph identity.'] }, null, 2) + String.fromCharCode(10));
const palette = mode => {
  const sample = samples.find(item => item.mode === mode && item.scene === 'approval');
  const values = {
    'approval-background': sample.measurements.approval.css['background-color'],
    'approval-foreground': sample.measurements.approval.css.color,
    'approval-border': sample.measurements.approval.css['border-top-color'],
    'approval-muted': sample.measurements.description.css.color,
    'approval-eyebrow': sample.measurements.eyebrow.css.color,
    'approval-allow-background': sample.measurements.allow.css['background-color'],
    'approval-allow-foreground': sample.measurements.allow.css.color,
    'approval-deny-background': sample.measurements.deny.css['background-color'],
    'approval-allow-hover': sample.states.allowHover,
    'approval-deny-hover': sample.states.denyHover,
  };
  return Object.entries(values).map(([key, value]) => '--' + key + ':' + value + ';').join('');
};
const newline = String.fromCharCode(10);
writeFileSync(resolve(root, 'apps/desktop/src/renderer/src/styles/approval-theme.css'), '/* Generated from pinned vendor approval styles, not Pi measurements. */' + newline + ':root {' + palette('light') + '}' + newline + ':root[data-theme="dark"] {' + palette('dark') + '}' + newline + '@media (prefers-color-scheme: dark) {:root[data-theme="system"] {' + palette('dark') + '}}' + newline);
console.log('Wrote ' + samples.length + ' pinned approval/loading source samples');
