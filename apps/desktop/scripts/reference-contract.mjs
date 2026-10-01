import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { runInNewContext } from 'node:vm';

// No Pi stylesheet reads, application bootstrap, networking or image capture.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const input = resolve(root, process.argv[2] ?? '.artifacts/codex-reference/26.917.9434.0');
const files = [
  'webview/assets/app-shared-fa570b9eb9dd.css',
  'webview/assets/app-initial-e8ceb32eb626.css',
  'webview/assets/app-primary-484df789f2f5.css',
];
const markers = {
  'webview/assets/app-initial-fc9a33fdda88.js': [
    'function zra(',
    'function Rda(',
    'function jda(',
    'function k9s(',
    'function z9s(',
    'function qQo(',
    '--font-ui-family',
  ],
  'webview/assets/app-primary-a7ff54c980af.js': ['composerLayoutMode', 'auto-single-line'],
  'webview/assets/local-conversation-thread-d221045ad324.js': ['composerPresentation', 'composerLayoutMode'],
  'webview/assets/sidebar-left-59ba729cde31.svg': ['M6 5a1'],
};
const sources = [...files, ...Object.keys(markers)].map((file) => {
  const bytes = readFileSync(resolve(input, file));
  const text = bytes.toString('utf8');
  return {
    file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    anchors: (markers[file] ?? []).map((marker) => {
      const index = text.indexOf(marker);
      if (index < 0) throw new Error('Missing source anchor: ' + marker);
      return { marker, byte: Buffer.byteLength(text.slice(0, index)) };
    }),
  };
});
const css =
  '@layer theme,base,components,utilities;' +
  files.map((file) => readFileSync(resolve(input, file), 'utf8')).join('');
// Whitelist only the audited, pure color functions. Nothing imports or initializes the app.
const initial = readFileSync(resolve(input, 'webview/assets/app-initial-fc9a33fdda88.pretty.js'), 'utf8');
const pureNames = [
  'YQo',
  'XQo',
  'ZQo',
  '$Qo',
  'QQo',
  'e$o',
  't$o',
  'n$o',
  'r$o',
  'Q1',
  '$1',
  'e0',
  'i$o',
  'a$o',
  'o$o',
  's$o',
  'c$o',
  'l$o',
  't0',
  'u$o',
];
const pureFunctions = pureNames
  .map((name) => {
    const start = initial.indexOf('function ' + name + '(');
    const end = initial.indexOf(String.fromCharCode(10) + '}', start) + 2;
    if (start < 0 || end < start) throw new Error('Missing color function ' + name);
    return initial.slice(start, end);
  })
  .join(String.fromCharCode(10));
const defaultsStart = initial.indexOf('VR = { dark:');
const defaults = initial.slice(defaultsStart, initial.indexOf(';', defaultsStart) + 1);
const constantsStart = initial.indexOf('n0 = { blue: 0, green: 0, red: 0 }');
const constants = initial.slice(constantsStart, initial.indexOf(';', constantsStart) + 1);
const injectedThemes = runInNewContext(
  'var VR,n0,r0,d$o,f$o,p$o,m$o,h$o,g$o,_$o,v$o;' +
    defaults +
    constants +
    pureFunctions +
    ';Object.fromEntries(["light","dark"].map(mode => {const seed=YQo(VR[mode],mode);return [mode,XQo(seed,mode==="light"?ZQo(seed):$Qo(seed))];}))',
  Object.create(null),
  { timeout: 1000 },
);
const injectedFonts =
  '--font-ui-size:14px;--font-code-size:12px;--text-base:14px;--text-sm:13px;--text-xs:12px;--font-ui-family:var(--font-sans-default)';
// Rda/jda and ComposerLayout component hierarchy. 275px is the source sidebar default;
// 400px is an explicit test-host constraint, not a measurement from Pi.
const fixture = [
  '<div class="flex h-full min-h-0 flex-col">',
  '<header id="titlebar" class="_ApplicationMenuTopBar_1wfx1_2"></header>',
  '<div class="flex min-h-0 flex-1">',
  '<aside id="sidebar" class="sidebar-navigation flex shrink-0 flex-col" style="width:275px"><button id="nav" class="h-token-nav-row text-sm" style="border-radius:var(--radius-token-row)">测试任务</button></aside>',
  '<main id="main" class="_MainContentSurface_1wfx1_2" data-app-shell-main-surface="default">',
  '<header id="toolbar" class="_FloatingHeader_1wfx1_2"></header><div style="width:400px;margin:24px">',
  '<div id="composer" class="_ComposerLayoutRoot_7vtc3_2" data-composer-layout="multiline" data-composer-radius-variant="default" data-composer-surface-variant="opaque" data-composer-surface-overflow="visible">',
  '<div class="_ComposerLayoutAttachments_7vtc3_2" data-composer-spacing="default"></div>',
  '<div class="_ComposerLayoutInput_7vtc3_2" data-composer-layout="multiline" data-composer-spacing="default"><div id="input" style="min-height:var(--min-height-composer);line-height:var(--line-height-composer);font-size:var(--codex-chat-font-size)">测试输入</div></div>',
  '<div class="_ComposerLayoutFooter_7vtc3_2" data-composer-layout="multiline" data-composer-spacing="default"><button id="send" class="size-token-button-composer rounded-full"></button></div></div>',
  '<div id="panel" class="h-toolbar-pane"></div>',
  '<div id="settingsRow" style="min-height:var(--height-token-settings-row)"></div></div></main></div></div>',
].join('');
const properties = {
  titlebar: ['height'],
  toolbar: ['height'],
  sidebar: ['width'],
  main: ['width', 'height', 'border-top-left-radius', 'background-color'],
  nav: ['height', 'border-top-left-radius', 'font-size', 'font-family', 'line-height'],
  composer: ['height', 'border-top-left-radius', 'background-color', 'box-shadow', 'border-top-width'],
  input: ['height', 'line-height', 'font-size', 'font-family'],
  send: ['width', 'height', 'border-top-left-radius'],
  panel: ['height'],
  settingsRow: ['height'],
};
const browser = await chromium.launch();
const samples = [];
try {
  for (const [width, height] of [
    [1000, 640],
    [1280, 800],
    [1440, 940],
  ]) {
    for (const mode of ['light', 'dark', 'system-light', 'system-dark']) {
      const theme = mode.endsWith('dark') ? 'dark' : 'light';
      const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme });
      await page.route('**/*', (route) => route.abort());
      const injected = Object.entries(injectedThemes[theme])
        .map(([key, value]) => key + ':' + value + ';')
        .join('');
      await page.setContent(
        '<!doctype html><html data-codex-window-type="electron" data-codex-window-chrome="application-menu" data-codex-os="win32" class="electron-opaque" data-theme="' +
          theme +
          '" style="' +
          injectedFonts +
          '"><head><style>' +
          css +
          '@layer theme {:where(:root:not([data-codex-window-type=extension]))[data-theme] {' +
          injected +
          '}}</style></head><body style="height:100vh;' +
          injectedFonts +
          '">' +
          fixture +
          '</body></html>',
      );
      if (theme === 'dark')
        await page.locator('#composer').evaluate((element) => element.setAttribute('data-composer-dark', ''));
      const measurements = await page.evaluate(
        (fields) =>
          Object.fromEntries(
            Object.entries(fields).map(([id, props]) => {
              const el = document.getElementById(id);
              if (!el) throw new Error('Missing reference node: ' + id);
              const style = getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              return [
                id,
                {
                  css: Object.fromEntries(
                    props.map((property) => [property, style.getPropertyValue(property)]),
                  ),
                  rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                },
              ];
            }),
          ),
        properties,
      );
      const palette = await page.evaluate(() => {
        const mappings = {
          bg: '--color-surface',
          sidebar: '--color-surface-secondary',
          surface: '--app-color-background-elevated-primary-opaque',
          hover: '--color-background-primary-ghost-hover',
          selected: '--color-background-segmented-selected',
          text: '--color-text',
          muted: '--color-text-secondary',
          border: '--color-border',
          accent: '--color-text-info',
          'accent-soft': '--color-background-info-soft',
          danger: '--color-text-danger',
          'window-menu': '--app-color-background-application-menu',
          'user-message': '--color-background-user-message',
          'diff-added': '--app-color-editor-added',
          'diff-removed': '--app-color-editor-deleted',
        };
        const probe = document.createElement('span');
        document.body.append(probe);
        const values = Object.fromEntries(
          Object.entries(mappings).map(([key, token]) => {
            probe.style.color = 'var(' + token + ')';
            return [key, getComputedStyle(probe).color];
          }),
        );
        probe.remove();
        return values;
      });
      samples.push({ width, height, mode, measurements, palette });
      await page.close();
    }
  }
} finally {
  await browser.close();
}
const result = {
  msixVersion: '26.917.9434.0',
  appVersion: '26.917.71314',
  method:
    'Original CSS and isolated pure theme functions, source-derived DOM, electron/win32/opaque/application-menu host, injected default fonts; computed styles and bounding boxes; no bootstrap, services or images',
  limitations: [
    'Isolated component geometry, not a running authenticated Codex window',
    'Local multiline composer; conditional single-line/voice/home feature flags not asserted',
    'Menu, tooltip, dialog and prose are measured separately by reference-surfaces.json',
  ],
  sources,
  injectedThemes,
  injectedFonts,
  pureNames,
  fixture,
  properties,
  samples,
};
const output = resolve(root, 'docs/desktop/reference-contract.json');
writeFileSync(output, JSON.stringify(result, null, 2) + String.fromCharCode(10));
console.log(
  JSON.stringify(
    { output, cases: samples.length, sources: sources.length, fields: Object.keys(properties) },
    null,
    2,
  ),
);
