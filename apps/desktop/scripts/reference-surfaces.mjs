import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

// Only pinned vendor sources and audited vendor theme values enter this oracle.
// No Pi stylesheet, application bootstrap, network or image capture is used.
const root = resolve(import.meta.dirname, '../../..');
const input = resolve(root, process.argv[2] ?? '.artifacts/codex-reference/26.917.9434.0/webview/assets');
const themeContract = JSON.parse(readFileSync(resolve(root, 'docs/desktop/reference-contract.json'), 'utf8'));
const cssFiles = ['app-shared-fa570b9eb9dd.css', 'app-initial-e8ceb32eb626.css', 'app-primary-484df789f2f5.css', 'user-message-8b0705662651.css'];
const anchors = {
  'app-shared-dc8f183e4945.js': ['function Rpt(', 'function zpt(', 'function Bpt(', 'function uft(', 'function _7(', 'function Sit(', 'function Cit(', 'function Got(', 'function Zot(', 'function Xot(', 'function est(', 'function Qot(', 'function mot(', 'function c8(', 'function Q6('],
  'app-initial-fc9a33fdda88.js': ['function uBi(', 'function sRi(', 'function Szi(', 'data-markdown-han-text'],
  'user-message-70f58cab2b4c.js': ['data-user-message-bubble', 'group flex w-full flex-col items-end justify-end gap-1'],
  'automation-delete-confirmation-dialog-d80f40edba25.js': ['color:`outline`', 'color:`danger`'],
};
const sources = [...cssFiles, ...Object.keys(anchors)].map(file => {
  const bytes = readFileSync(resolve(input, file));
  const source = bytes.toString('utf8');
  return { file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, anchors: (anchors[file] ?? []).map(marker => {
    const index = source.indexOf(marker);
    if (index < 0) throw new Error(`Missing source anchor: ${file}: ${marker}`);
    return { marker, byte: Buffer.byteLength(source.slice(0, index)) };
  }) };
});
for (const file of cssFiles.slice(0, 3)) {
  const prior = themeContract.sources.find(source => source.file.endsWith('/' + file));
  if (!prior || prior.sha256 !== sources.find(source => source.file === file).sha256) throw new Error('Theme/source version mismatch: ' + file);
}
const css = '@layer theme,base,components,utilities;' + cssFiles.map(file => readFileSync(resolve(input, file), 'utf8')).join('');
const menuSurface = 'no-drag z-50 flex select-none flex-col overflow-y-auto m-px bg-surface-elevated-secondary/90 text-default ring-border ring-[0.5px] shadow-xl-spread backdrop-blur-sm rounded-2xl p-[var(--app-menu-gutter,var(--spacing))]';
const menuItem = 'no-drag outline-hidden flex min-h-[var(--app-menu-item-height,0px)] shrink-0 items-center justify-center p-[var(--app-menu-item-padding,var(--padding-row-y)_var(--padding-row-x))] text-(length:--app-menu-item-font-size,var(--text-sm)) leading-(--app-menu-item-line-height,var(--text-sm--line-height)) rounded-xl text-default';
const menuContent = 'flex w-full items-center gap-[var(--spacing-menu-item-content,calc(var(--spacing)*1.5))]';
const tooltipSurface = 'w-fit text-sm whitespace-normal break-words select-none z-50 _textTheme_37tej_2 text-center rounded-2xl border border-(color:--color-border-tooltip) bg-(--color-background-tooltip) text-(color:--color-text-tooltip) leading-4.5 font-(weight:--tooltip-compact-font-weight) tracking-(--tracking-tooltip) shadow-(--shadow-tooltip) px-3 py-1.25';
const dialogSurface = 'codex-dialog z-50 outline-none fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-elevated-secondary/90 text-default ring-border ring-[0.5px] shadow-lg backdrop-blur-xl rounded-3xl max-w-[92vw] overflow-hidden w-[520px]';
const bubbleSurface = 'bg-user-message text-user-message min-w-0 max-w-(--user-chat-width) overflow-hidden break-words px-(--thread-content-margin) [&_.contain-inline-size]:[contain:initial] _bubble_149ln_1 py-2.5 rounded-2xl relative text-start';
const dialogButton = 'no-drag cursor-interaction items-center select-none focus:outline-hidden disabled:cursor-default aria-disabled:cursor-default disabled:opacity-40 aria-disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 border gap-1 whitespace-nowrap flex rounded-button-action px-4 py-1.5 text-base leading-[18px]';
const cancelButton = dialogButton + ' border-default bg-primary-soft-alpha not-disabled:not-aria-disabled:hover:bg-primary-ghost-hover data-[state=open]:bg-primary-ghost-hover border';
const dangerButton = dialogButton + ' bg-chart-red/10 not-disabled:not-aria-disabled:hover:bg-chart-red/20 text-chart-red border-transparent';
const sharedSource = readFileSync(resolve(input, 'app-shared-dc8f183e4945.js'), 'utf8');
const closeIconPath = sharedSource.match(/d:`(M14\.6549[^`]+)`/)?.[1];
if (!closeIconPath) throw new Error('Missing Y6 close icon');
const text = { user: '请检查项目中的设置保存流程，并保留中文文案。第二行用于验证换行后的气泡宽度与间距。', tooltip: '切换辅助面板', title: '删除自动化？', description: '这将永久删除此自动化，并停止之后的定时运行。' };
const fixtures = {
  menu: `<button id="anchor" style="position:fixed;left:48px;top:180px;width:220px;height:32px">菜单</button><div id="menu" role="menu" class="${menuSurface}" style="position:fixed;left:48px;top:213px;width:220px">${['选项 A', '选项 B', '不可用选项'].map((label, index) => `<div id="item${index}" role="menuitemradio" aria-checked="${index === 1}" class="${menuItem} ${index === 2 ? 'cursor-default opacity-50' : 'group hover:bg-primary-ghost-hover focus:bg-primary-ghost-hover cursor-interaction'}" tabindex="-1"><div id="content${index}" class="${menuContent}"><div class="flex min-w-0 flex-1 flex-col gap-1"><span class="whitespace-normal font-medium">${label}</span></div><span id="indicator${index}" class="icon-sm shrink-0"></span></div></div>`).join('')}</div>`,
  tooltip: `<button id="anchor" style="position:fixed;left:48px;top:180px;width:220px;height:32px">提示</button><div id="tooltip" role="tooltip" data-side="top" class="${tooltipSurface}" style="position:fixed;max-width:min(20rem,calc(100vw - 16px));max-height:calc(100vh - 16px)"><div id="tooltipContent" class="flex gap-2 items-center"><div class="min-w-0">${text.tooltip}</div></div></div>`,
  dialog: `<div id="overlay" class="extension:bg-surface-tertiary/80 electron:bg-[#00000022] codex-dialog-overlay fixed inset-0 z-50"></div><div id="dialog" role="dialog" class="${dialogSurface}"><div id="dialogBody" class="flex flex-col gap-0 text-base leading-normal tracking-normal px-5 py-5"><div class="flex w-full flex-col first:pt-0 pt-3"><div class="flex flex-col items-start gap-3"><div id="dialogHeading" class="flex min-w-0 flex-1 flex-col gap-1 self-stretch"><div id="dialogTitle" class="heading-dialog min-w-0 font-semibold"><h2>${text.title}</h2></div><div id="dialogDescription" class="text-codex-description text-base leading-normal tracking-normal"><p>${text.description}</p></div></div></div></div><div class="flex w-full flex-col first:pt-0 pt-3"><div id="dialogActions" class="flex w-full items-center justify-end gap-3"><div style="width:64px;height:36px"></div><div style="width:106px;height:36px"></div></div></div></div></div>`,
  user: `<div style="width:min(768px,calc(100vw - 64px));margin:32px auto"><div id="user" class="group flex w-full flex-col items-end justify-end gap-1"><h4 class="sr-only m-0 select-none">你</h4><div id="bubble" data-user-message-bubble="true" class="${bubbleSurface}"><div id="markdown" class="_MarkdownRoot_1xa4n_183" data-markdown-text-tone="user-message"><p id="paragraph" class="_Paragraph_1xa4n_110">${text.user}</p></div></div></div></div>`,
};
fixtures.dialog = fixtures.dialog.replace('<div style="width:64px;height:36px"></div><div style="width:106px;height:36px"></div>', `<button id="dialogCancel" class="${cancelButton}">取消</button><button id="dialogConfirm" class="${dangerButton}">删除自动化</button>`);
fixtures.dialog = fixtures.dialog.slice(0, -6) + `<button id="dialogClose" class="no-drag cursor-interaction leading-none hover:bg-primary-ghost-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 text-text/80 rounded p-1 absolute top-4 right-4"><svg id="dialogCloseIcon" class="icon-xs" width="21" height="21" viewBox="0 0 21 21" fill="none"><path d="${closeIconPath}" fill="currentColor"></path></svg><span class="sr-only">关闭对话框</span></button></div>`;
fixtures.prose = `<div style="width:min(768px,calc(100vw - 64px));margin:32px auto"><div id="prose" class="_MarkdownRoot_1xa4n_183"><h1 id="heading1" class="_Heading_1xa4n_122" dir="auto">验收结果</h1><p id="proseP1" class="_Paragraph_1xa4n_110" data-markdown-han-text="true" dir="auto">第一段中文，检查段落和行距。</p><p id="proseP2" class="_Paragraph_1xa4n_110" data-markdown-han-text="true" dir="auto">第二段包含<strong id="strong" class="font-semibold">重点</strong>，以及 English text。</p><h2 id="heading2" class="_Heading_1xa4n_122" dir="auto">检查项目</h2><ul id="list" class="_List_1xa4n_123 _UnorderedList_1xa4n_208" dir="auto"><li id="listItem" class="_ListItem_1xa4n_123">菜单与键盘</li><li class="_ListItem_1xa4n_123">对话框与焦点<ul id="nestedList" class="_List_1xa4n_123 _UnorderedList_1xa4n_208" dir="auto"><li class="_ListItem_1xa4n_123">恢复触发器</li></ul></li></ul><ol id="orderedList" class="_List_1xa4n_123 _OrderedList_1xa4n_220" start="3" dir="auto"><li class="_ListItem_1xa4n_123">保存设置</li></ol><blockquote id="quote" class="_Blockquote_1xa4n_284" dir="auto"><p id="quoteP" class="_Paragraph_1xa4n_110" data-markdown-han-text="true" dir="auto">仅比较源码中已经确定的结构。</p></blockquote><hr id="rule" class="_HorizontalRule_1xa4n_326"><h3 id="heading3" class="_Heading_1xa4n_122" dir="auto">下一步</h3><h4 id="heading4" class="_Heading_1xa4n_122" dir="auto">明细</h4><h5 id="heading5" class="_Heading_1xa4n_122" dir="auto">记录</h5><h6 id="heading6" class="_Heading_1xa4n_122" dir="auto">结束</h6></div></div>`;
const probes = { menu: ['menu', 'item0', 'item1', 'item2', 'content0', 'indicator0'], tooltip: ['tooltip', 'tooltipContent'], dialog: ['overlay', 'dialog', 'dialogBody', 'dialogHeading', 'dialogTitle', 'dialogDescription', 'dialogActions', 'dialogCancel', 'dialogConfirm'], user: ['bubble', 'markdown', 'paragraph'], prose: ['prose', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6', 'proseP1', 'proseP2', 'strong', 'list', 'listItem', 'nestedList', 'orderedList', 'quote', 'quoteP', 'rule'] };
const properties = ['display', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'background-color', 'border-radius', 'border-top-width', 'border-top-color', 'box-shadow', 'backdrop-filter', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'row-gap', 'column-gap', 'overflow-x', 'overflow-y', 'opacity', 'corner-shape', 'margin-top', 'margin-bottom', 'list-style-type'];
probes.dialog.push('dialogClose', 'dialogCloseIcon');
fixtures.table = `<div style="width:min(768px,calc(100vw - 64px));margin:32px auto"><div class="_MarkdownRoot_1xa4n_183"><div id="tableContainer" class="_TableContainer_1xa4n_41"><div id="tableScroller" class="_TableScroller_1xa4n_465"><div id="tableWrapper" class="_TableWrapper_1xa4n_474"><table id="table" class="_Table_1xa4n_41" dir="auto"><thead><tr class="_TableRow_1xa4n_554"><th id="tableHeading" class="_TableHeaderCell_1xa4n_562" data-col-size="sm" dir="auto">检查项目</th><th class="_TableHeaderCell_1xa4n_562" data-col-size="sm" dir="auto">状态</th></tr></thead><tbody class="_TableBody_1xa4n_617"><tr class="_TableRow_1xa4n_554"><td id="tableCell" class="_TableCell_1xa4n_554" data-col-size="sm" dir="auto">保存与重启</td><td class="_TableCell_1xa4n_554" data-col-size="sm" dir="auto">已通过</td></tr><tr class="_TableRow_1xa4n_554"><td id="tableLastCell" class="_TableCell_1xa4n_554" data-col-size="sm" dir="auto">中文输入</td><td class="_TableCell_1xa4n_554" data-col-size="sm" dir="auto">已通过</td></tr></tbody></table></div></div></div></div></div>`;
fixtures.code = `<div style="width:min(768px,calc(100vw - 64px));margin:32px auto"><div class="_MarkdownRoot_1xa4n_183"><div id="codeBlock" class="relative w-full min-w-0 overflow-clip contain-inline-size rounded-(--radius-3xl-base) border border-subtle bg-secondary-soft-alpha _Surface_1f1nx_1 _CodeBlock_1xa4n_625"><div id="codeToolbar" class="flex items-center font-sans text-sm select-none min-h-12 gap-2 py-1.5 ps-4 pe-1.5 font-medium text-default md:ps-5"><span style="width:16px;height:16px"></span><div class="min-w-0 flex-1 truncate">text</div><div class="ms-auto flex items-center min-w-0 max-w-full"><div style="width:65px;height:32px"></div></div></div><div id="codeContent" class="text-size-chat overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset px-4 pt-0 pb-3 md:px-5" dir="ltr"><code id="codeText" class="whitespace-pre! block text-size-code _CodeContent_1f1nx_6">npm run desktop:check\n设置已恢复</code></div></div></div></div>`;
probes.table = ['tableContainer', 'tableScroller', 'tableWrapper', 'table', 'tableHeading', 'tableCell', 'tableLastCell'];
probes.code = ['codeBlock', 'codeToolbar', 'codeContent', 'codeText'];
const richProperties = [...properties, 'border-bottom-width', 'border-bottom-color', 'border-collapse', 'border-spacing', 'text-align', 'white-space'];
const browser = await chromium.launch();
const samples = [];
try {
  for (const [width, height] of [[1000, 640], [1280, 800], [1440, 940]]) {
    for (const mode of ['light', 'dark', 'system-light', 'system-dark']) {
      const theme = mode.endsWith('dark') ? 'dark' : 'light';
      const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme });
      await page.route('**/*', route => route.abort());
      const injected = Object.entries(themeContract.injectedThemes[theme]).map(([key, value]) => `${key}:${value};`).join('');
      for (const [scene, fixture] of Object.entries(fixtures)) {
        await page.setContent(`<!doctype html><html data-codex-window-type="electron" data-codex-window-chrome="application-menu" data-codex-os="win32" class="electron-opaque" data-theme="${theme}" style="${themeContract.injectedFonts}"><head><style>${css}@layer theme {:where(:root:not([data-codex-window-type=extension]))[data-theme] {${injected}}}</style></head><body style="height:100vh;${themeContract.injectedFonts}">${fixture}</body></html>`);
        if (scene === 'tooltip') await page.evaluate(() => {
          const anchor = document.getElementById('anchor').getBoundingClientRect();
          const tip = document.getElementById('tooltip');
          const box = tip.getBoundingClientRect();
          tip.style.left = `${anchor.x + (anchor.width - box.width) / 2}px`;
          tip.style.top = `${anchor.top - box.height - 2}px`;
        });
        if (scene === 'menu') await page.locator('#item1').focus();
        const measurements = await page.evaluate(({ ids, properties }) => Object.fromEntries(ids.map(id => {
          const element = document.getElementById(id);
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          return [id, { css: Object.fromEntries(properties.map(property => [property, style.getPropertyValue(property)])), rect: { x: box.x, y: box.y, width: box.width, height: box.height } }];
        })), { ids: probes[scene], properties: scene === 'table' || scene === 'code' ? richProperties : properties });
        const states = {};
        if (scene === 'dialog') {
          for (const [state, id] of [['cancelHover', 'dialogCancel'], ['confirmHover', 'dialogConfirm'], ['confirmDisabled', 'dialogConfirm'], ['confirmFocus', 'dialogConfirm']]) {
            const target = page.locator('#' + id);
            await page.mouse.move(0, 0);
            if (state.endsWith('Hover')) await target.hover();
            if (state === 'confirmDisabled') await target.evaluate(element => { element.disabled = true; });
            if (state === 'confirmFocus') { await target.evaluate(element => { element.disabled = false; }); await page.keyboard.press('Tab'); await target.focus(); }
            states[state] = { id, css: await target.evaluate((element, properties) => Object.fromEntries(properties.map(property => [property, getComputedStyle(element).getPropertyValue(property)])), properties) };
          }
        }
        samples.push({ width, height, mode, scene, measurements, states });
      }
      await page.close();
    }
  }
} finally { await browser.close(); }
writeFileSync(resolve(root, 'docs/desktop/reference-surfaces.json'), JSON.stringify({
  msixVersion: themeContract.msixVersion, appVersion: themeContract.appVersion,
  method: 'Source-derived desktop DOM fragments, original CSS and pinned injected themes. No Pi oracle, vendor bootstrap, remote calls or image capture.',
  limitations: ['Isolated surfaces do not establish full-window pixel equality.', 'User bubble is the default, non-compact local desktop branch.', 'Code measures default text blocks and toolbar geometry, not glyph or syntax-palette equality. Table measures the normal, non-wide branch; actions, sticky headers and preview variants are excluded.'],
  sources, text, fixtures, probes, properties, samples, icons: { close: closeIconPath },
}, null, 2) + String.fromCharCode(10));
console.log(JSON.stringify({ cases: samples.length, scenes: Object.keys(fixtures), sources: sources.length }));
const palette = mode => {
  const sample = scene => samples.find(value => value.mode === mode && value.scene === scene).measurements;
  return Object.entries({
    'popup-background': sample('menu').menu.css['background-color'],
    'popup-menu-shadow': sample('menu').menu.css['box-shadow'],
    'popup-dialog-shadow': sample('dialog').dialog.css['box-shadow'],
    'popup-tooltip-shadow': sample('tooltip').tooltip.css['box-shadow'],
    'tooltip-background': sample('tooltip').tooltip.css['background-color'],
    'popup-description': sample('dialog').dialogDescription.css.color,
    'dialog-button-radius': sample('dialog').dialogConfirm.css['border-radius'],
    'dialog-close-color': sample('dialog').dialogClose.css.color,
    'dialog-close-icon-size': sample('dialog').dialogCloseIcon.rect.width + 'px',
    'dialog-cancel-background': sample('dialog').dialogCancel.css['background-color'],
    'dialog-danger-background': sample('dialog').dialogConfirm.css['background-color'],
    'dialog-danger-color': sample('dialog').dialogConfirm.css.color,
    'dialog-cancel-hover': samples.find(value => value.mode === mode && value.scene === 'dialog').states.cancelHover.css['background-color'],
    'dialog-danger-hover': samples.find(value => value.mode === mode && value.scene === 'dialog').states.confirmHover.css['background-color'],
    'dialog-focus-shadow': samples.find(value => value.mode === mode && value.scene === 'dialog').states.confirmFocus.css['box-shadow'],
    'markdown-border': sample('prose').rule.css['border-top-color'],
    'markdown-table-divider': sample('table').tableCell.css['border-bottom-color'],
    'markdown-code-background': sample('code').codeBlock.css['background-color'],
    'markdown-code-font': sample('code').codeText.css['font-family'],
  }).map(([key, value]) => `  --${key}: ${value};`).join(String.fromCharCode(10));
};
writeFileSync(resolve(root, 'apps/desktop/src/renderer/src/styles/surface-theme.css'), [
  '/* Source-only measurements from reference-surfaces.mjs; no application runtime dependencies. */',
  `:root {${palette('light')}}`,
  `:root[data-theme="dark"] {${palette('dark')}}`,
  `@media (prefers-color-scheme: dark) { :root[data-theme="system"] {${palette('dark')}} }`,
  '',
].join(String.fromCharCode(10)));
