import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';

type CapturedScene = { surface: string; theme: string; measurements: Record<string, { css: Record<string, string> }> };
const manifest: { msixVersion: string; scenes: CapturedScene[] } = JSON.parse(await readFile(new URL('../../../../../docs/desktop/codex-26915-reference-manifest.json', import.meta.url), 'utf8'));
if (manifest.msixVersion !== '26.915.4065.0') throw new Error('Unexpected UI reference version');

/** Uncaptured Pi components: verify the pinned palette and layout usability, not pixel parity. */
export async function expectAdaptedAppearance(page: Page, mode: string, selectors: string[]): Promise<void> {
  const theme = mode.endsWith('dark') ? 'dark' : 'light';
  const source = manifest.scenes.find(scene => scene.surface === 'welcome' && scene.theme === theme)!;
  await expect(page.locator('html')).toHaveCSS('color', source.measurements.main.css.color);
  await expect(page.locator('html')).toHaveCSS('background-color', source.measurements.main.css.backgroundColor);
  for (const selector of selectors) {
    const target = page.locator(selector).first();
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box!.width, selector).toBeGreaterThan(0);
    expect(box!.height, selector).toBeGreaterThan(0);
    expect(box!.x, selector).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width, selector).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}
