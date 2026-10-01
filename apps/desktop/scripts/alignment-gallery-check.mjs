import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const directory = resolve('.artifacts/codex-26915-alignment');
const { results } = JSON.parse(await readFile(join(directory, 'results.json'), 'utf8'));
for (const row of results) {
  for (const suffix of row.pixel ? ['.png', '.reference.png', '.diff.png'] : ['.png']) {
    assert.ok((await stat(join(directory, row.name + suffix))).size > 100);
  }
  for (const region of row.regions || []) assert.ok((await stat(join(directory, row.name + '.' + region.key + '.diff.png'))).size > 100);
  assert.equal(row.geometry.locale, row.locale);
  assert.deepEqual(row.errors, []);
  assert.ok(row.geometry.pageOverflow <= 1);
  assert.ok(row.geometry.controlOverflow.every(control => control.pixels <= 1), row.name);
  assert.deepEqual(row.geometry.wrappedBreadcrumbs, [], row.name + ' wrapped breadcrumb');
  assert.deepEqual(row.geometry.clippedIcons, [], row.name + ' clipped browser icon');
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(pathToFileURL(join(directory, 'gallery.html')).href);
  assert.equal(await page.locator('#results section').count(), 2);
  await page.locator('#surface').selectOption('dialog');
  assert.equal(await page.locator('#results section').count(), 2);
  await page.locator('#locale').selectOption('zh-CN');
  await page.locator('#size').selectOption('1000×700');
  await page.locator('#theme').selectOption('dark');
  assert.equal(await page.locator('#results section').count(), 1);
  await page.locator('#surface').selectOption('summary');
  await page.screenshot({ path: join(directory, 'gallery-preview.png'), fullPage: true });
  for (const id of ['surface', 'locale', 'theme', 'size', 'status']) await page.locator('#' + id).selectOption('');
  assert.equal(await page.locator('#results section').count(), results.length);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
const result = { captures: results.length, assetsVerified: results.reduce((count, row) => count + (row.pixel ? 3 : 1) + (row.regions?.length || 0), 0), galleryFilters: 'passed', errors, checkedAt: new Date().toISOString() };
await writeFile(join(directory, 'gallery-validation.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
