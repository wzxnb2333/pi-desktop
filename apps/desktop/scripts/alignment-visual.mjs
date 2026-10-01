import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(import.meta.dirname, '../../..');
const output = resolve(root, '.artifacts/codex-26915-alignment');
const require = createRequire(import.meta.url);
const { PNG } = require(resolve(root, 'node_modules/playwright-core/lib/utilsBundle.js'));
const manifest = JSON.parse(await readFile(resolve(root, 'docs/desktop/codex-26915-reference-manifest.json'), 'utf8'));
const referenceRequire = createRequire(resolve(manifest.referenceRoot, 'package.json'));
const pixelmatchModule = referenceRequire('pixelmatch');
const pixelmatch = typeof pixelmatchModule === 'function' ? pixelmatchModule : pixelmatchModule.default;
await mkdir(output, { recursive: true });
await build({ entryPoints: [resolve(root, 'apps/desktop/test/e2e/fixtures/reference-harness.tsx')], outfile: join(output, 'app.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
await writeFile(join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
const url = pathToFileURL(join(output, 'index.html')).href;
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const selected = process.argv.find(argument => argument.startsWith('--surface='))?.slice('--surface='.length).split(',');
const previous = selected ? JSON.parse(await readFile(join(output, 'results.json'), 'utf8')).results : [];
const results = previous.filter(row => !selected.includes(row.surface));
const scenarios = ['welcome', 'workspace', 'summary', 'review', 'files', 'browser', 'terminal', 'palette', 'model-menu', 'policy-menu', 'attachments', 'settings', 'models', 'permissions', 'mcp', 'automations', 'inbox', 'skills', 'approval', 'approval-confirm', 'approval-input', 'approval-select', 'dialog', 'loading'].filter(surface => !selected || selected.includes(surface));
if (!scenarios.length) throw new Error('No matching visual scenario');
function composite(png, background) {
  const result = new PNG({ width: png.width, height: png.height });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    const alpha = png.data[offset + 3] / 255;
    for (let channel = 0; channel < 3; channel++) result.data[offset + channel] = Math.round(png.data[offset + channel] * alpha + background[channel] * (1 - alpha));
    result.data[offset + 3] = 255;
  }
  return result;
}
try {
  for (const [width, height] of [[1440, 940], [1000, 700], [1280, 800]]) for (const theme of ['light', 'dark']) for (const locale of ['en-US', 'zh-CN']) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    for (const surface of scenarios) {
      errors.length = 0;
      const name = [surface, theme, locale, width + 'x' + height].join('-');
      const referenceSurface = surface === 'browser' ? 'preview' : surface;
      const reference = manifest.scenes.find(scene => scene.surface === referenceSurface && scene.theme === theme && scene.viewport.width === width && scene.validity !== 'excluded');
      const parameters = new URLSearchParams({ pinned: '1', theme, locale });
      if (surface === 'loading') parameters.set('loading', '1');
      else if (!['welcome', 'palette', 'model-menu', 'policy-menu', 'attachments'].includes(surface)) parameters.set('workspace', '1');
      if (surface === 'review') parameters.set('review', '1');
      if (surface.startsWith('approval')) parameters.set('approval', surface.split('-')[1] || 'action');
      await page.goto(url + '?' + parameters);
      await page.locator(surface === 'loading' ? '.loading' : '.desktop').waitFor();
      if (surface !== 'loading') {
        await page.evaluate(async ({ surface, capturedLayout }) => {
          const { data } = await window.desktop.invoke({ op: 'bootstrap' });
          const view = ['settings', 'models', 'permissions', 'mcp'].includes(surface) ? 'settings' : ['automations', 'inbox', 'skills'].includes(surface) ? surface : 'thread';
          await window.desktop.invoke({ op: 'ui.update', ui: { ...data.ui, view,
            ...(capturedLayout?.reviewWidth ? { reviewWidth: Math.round(capturedLayout.reviewWidth) } : {}),
            ...(capturedLayout?.terminalHeight ? { terminalHeight: Math.round(capturedLayout.terminalHeight) } : {}),
            reviewOpen: ['review', 'files', 'browser'].includes(surface),
            summaryOpen: surface === 'summary' || surface === 'terminal' && !!capturedLayout?.summaryVisible } });
          if (['review', 'files', 'browser'].includes(surface)) await window.desktop.invoke({ op: 'ui.threadPatch', threadId: 't1', patch: { reviewTab: surface === 'review' ? 'changes' : surface } });
        }, { surface, capturedLayout: reference?.capturedLayout });
        if (['settings', 'models', 'permissions', 'mcp'].includes(surface)) await page.locator('[data-category="' + (surface === 'settings' ? 'general' : surface) + '"]').click();
        if (surface === 'palette') await page.keyboard.press('Control+Shift+P');
        if (surface === 'dialog') {
          await page.getByLabel(locale === 'en-US' ? 'Help menu' : '帮助菜单', { exact: true }).click();
          await page.getByRole('menuitem', { name: locale === 'en-US' ? 'Local runtime information' : '本地运行信息', exact: true }).click();
          await page.getByRole('dialog').waitFor();
        }
        if (surface === 'terminal') {
          await page.evaluate(async () => { await window.desktop.invoke({ op: 'ui.threadPatch', threadId: 't1', patch: { terminalOpen: true } }); });
          await page.locator('.terminal-empty button').click();
          await page.locator('.xterm-screen').waitFor();
        }
        if (surface === 'model-menu') await page.locator('.composer-menu-model').click();
        if (surface === 'policy-menu') await page.locator('.composer-menu-policy').click();
        if (surface === 'attachments') await page.evaluate(async () => { await window.desktop.invoke({ op: 'ui.threadPatch', threadId: 't1', patch: { draft: { text: 'Original prompt / 原始草稿', attachments: ['C:/temporary/project/reference.png', 'C:/temporary/project/中文说明.txt'] } } }); });
      }
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(120);
      const geometry = await page.evaluate(() => {
        const result = {};
        for (const [key, selector] of Object.entries({ main: '.main', sidebar: '.sidebar', titlebar: '.titlebar', composer: '.composer', heading: '.welcome h1', terminalSurface: '.terminal-slot', terminalStrip: '.terminal-tabs', browserStrip: '.browser-tabs', browserAddress: '.preview-toolbar input', palette: '.command-palette', paletteInput: '.command-palette [role=combobox]', paletteList: '.command-results', paletteRow: '.command-results [role=option]' })) {
          const node = document.querySelector(selector); if (!node) continue;
          const box = node.getBoundingClientRect(), style = getComputedStyle(node);
          result[key] = { rect: { x: box.x, y: box.y, w: box.width, h: box.height }, css: Object.fromEntries(['backgroundColor', 'color', 'fontFamily', 'borderRadius', 'borderLeftWidth', 'fontSize', 'lineHeight'].map(key => [key, style[key]])) };
        }
        const controlOverflow = [...document.querySelectorAll('.composer-actions, .composer-footer, .toolbar, .review-tabs')].filter(node => node.clientWidth > 0).map(node => ({ selector: node.className, pixels: node.scrollWidth - node.clientWidth }));
        const wrappedBreadcrumbs = [...document.querySelectorAll('.breadcrumb > span, .breadcrumb > strong')].filter(node => getComputedStyle(node).visibility !== 'hidden' && node.getBoundingClientRect().height > parseFloat(getComputedStyle(node).lineHeight) + 1).map(node => node.textContent);
        const clippedIcons = [...document.querySelectorAll('.browser-overflow .menu-trigger-label')].filter(node => {
          const icon = node.querySelector('svg'); if (!icon) return false;
          const labelBox = node.getBoundingClientRect(), iconBox = icon.getBoundingClientRect();
          return iconBox.width > labelBox.width + .5 || iconBox.height > labelBox.height + .5;
        }).map(node => node.parentElement.getAttribute('aria-label'));
        return { elements: result, pageOverflow: document.documentElement.scrollWidth - innerWidth, controlOverflow, wrappedBreadcrumbs, clippedIcons, locale: document.documentElement.lang };
      });
      const implementation = join(output, name + '.png');
      await page.screenshot({ path: implementation, animations: 'disabled' });
      const result = { name, surface, theme, locale, viewport: { width, height }, implementation, geometry, errors: [...errors], capturedAt: new Date().toISOString(), comparison: 'adapted-no-matching-scene' };
      if (reference) {
        result.reference = { id: reference.id, domSha256: reference.domSha256, screenshotSha256: reference.screenshotSha256, capturedLayout: reference.capturedLayout };
        result.geometryComparisons = Object.entries(reference.measurements).flatMap(([key, expected]) => {
          const actual = geometry.elements[key];
          if (!actual) return [];
          const deltas = Object.fromEntries(['x', 'y', 'w', 'h'].map(property => [property, Math.abs(actual.rect[property] - expected.rect[property])]));
          const radius = (value) => (value.match(/[0-9.]+/g) ?? ['0']).map(Number);
          const sourceRadius = radius(expected.css.borderRadius), actualRadius = radius(actual.css.borderRadius);
          const radiusDeltas = actualRadius.map((value, index) => Math.abs(value - sourceRadius[Math.min(index, sourceRadius.length - 1)]));
          return [{ key, deltas, passed: Object.values(deltas).every(value => value <= manifest.pixelPolicy.geometryPx), radius: { expected: expected.css.borderRadius, actual: actual.css.borderRadius, passed: sourceRadius.length === actualRadius.length && radiusDeltas.every(value => value <= manifest.pixelPolicy.radiusAndBorderPx) }, colors: ['color', 'backgroundColor'].map(property => ({ property, expected: expected.css[property], actual: actual.css[property], passed: expected.css[property] === actual.css[property] })) }];
        });
        if (locale === 'en-US' && (reference.transparentPixels === 0 || reference.composition)) {
          let expected = PNG.sync.read(await readFile(resolve(manifest.referenceRoot, reference.screenshot)));
          if (reference.transparentPixels) expected = composite(expected, reference.composition.background);
          await writeFile(join(output, name + '.reference.png'), PNG.sync.write(expected));
          const actual = PNG.sync.read(await readFile(implementation));
          const diff = new PNG({ width, height });
          const pixels = pixelmatch(expected.data, actual.data, diff.data, width, height, { threshold: .1, includeAA: false });
          await writeFile(join(output, name + '.diff.png'), PNG.sync.write(diff));
          result.pixel = { pixels, fraction: pixels / (width * height), masks: [], threshold: manifest.pixelPolicy.textDenseFraction, eligible: reference.wholeWindowEligible, passed: reference.wholeWindowEligible && pixels / (width * height) <= manifest.pixelPolicy.textDenseFraction };
          result.comparison = !reference.wholeWindowEligible ? 'diagnostic-invalid-reference-body' : result.pixel.passed ? 'pixel-pass' : 'pixel-fail';
        } else result.comparison = locale === 'zh-CN' ? 'localized-layout-only' : 'geometry-only';
      }
      results.push(result);
      await writeFile(join(output, 'results.json'), JSON.stringify({ referenceVersion: manifest.msixVersion, results }, null, 2));
    }
    await page.close();
    console.log(theme + ' ' + locale + ' ' + width + 'x' + height + ': ' + scenarios.length + ' captures');
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ captures: results.length, pixelPass: results.filter(row => row.comparison === 'pixel-pass').length, pixelFail: results.filter(row => row.comparison === 'pixel-fail').length, errors: results.filter(row => row.errors.length).length, overflow: results.filter(row => row.geometry.pageOverflow > 1).length }));
