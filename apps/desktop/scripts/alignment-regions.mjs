import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '../../..');
const output = join(root, '.artifacts/codex-26915-alignment');
const manifest = JSON.parse(await readFile(join(root, 'docs/desktop/codex-26915-reference-manifest.json'), 'utf8'));
const resultsPath = join(output, 'results.json');
const report = JSON.parse(await readFile(resultsPath, 'utf8'));
const require = createRequire(import.meta.url);
const { PNG } = require(join(root, 'node_modules/playwright-core/lib/utilsBundle.js'));
const referenceRequire = createRequire(join(manifest.referenceRoot, 'package.json'));
const pixelmatchModule = referenceRequire('pixelmatch');
const pixelmatch = typeof pixelmatchModule === 'function' ? pixelmatchModule : pixelmatchModule.default;

function crop(source, bounds) {
  const data = Buffer.alloc(bounds.w * bounds.h * 4);
  for (let row = 0; row < bounds.h; row++) {
    const start = ((bounds.y + row) * source.width + bounds.x) * 4;
    source.data.copy(data, row * bounds.w * 4, start, start + bounds.w * 4);
  }
  return data;
}

for (const row of report.results) {
  if (!row.pixel) continue;
  const reference = manifest.scenes.find(scene => scene.id === row.reference.id);
  const actual = PNG.sync.read(await readFile(join(output, row.name + '.png')));
  const expected = PNG.sync.read(await readFile(join(output, row.name + '.reference.png')));
  row.regions = [];
  for (const [key, source] of Object.entries(reference.measurements)) {
    const target = row.geometry.elements[key];
    if (!target) continue;
    // Compare the union at original window coordinates. No image alignment,
    // text/icon masks or synthetic pixels hide position/content differences.
    const x = Math.max(0, Math.floor(Math.min(source.rect.x, target.rect.x)));
    const y = Math.max(0, Math.floor(Math.min(source.rect.y, target.rect.y)));
    const right = Math.min(actual.width, Math.ceil(Math.max(source.rect.x + source.rect.w, target.rect.x + target.rect.w)));
    const bottom = Math.min(actual.height, Math.ceil(Math.max(source.rect.y + source.rect.h, target.rect.y + target.rect.h)));
    const bounds = { x, y, w: right - x, h: bottom - y };
    if (bounds.w <= 0 || bounds.h <= 0) continue;
    const kind = key === 'main' ? 'structural-surface-including-content' : 'text-dense-component';
    const threshold = key === 'main' ? manifest.pixelPolicy.structuralFraction : manifest.pixelPolicy.textDenseFraction;
    const diff = new PNG({ width: bounds.w, height: bounds.h });
    const pixels = pixelmatch(crop(expected, bounds), crop(actual, bounds), diff.data, bounds.w, bounds.h, { threshold: .1, includeAA: false });
    const fraction = pixels / (bounds.w * bounds.h);
    const eligible = reference.wholeWindowEligible || ['terminalSurface', 'terminalStrip', 'browserStrip', 'browserAddress'].includes(key);
    row.regions.push({ key, kind, bounds, pixels, fraction, threshold, eligible, passed: eligible && fraction <= threshold, masks: [] });
    await writeFile(join(output, row.name + '.' + key + '.diff.png'), PNG.sync.write(diff));
  }
  row.regionThresholdsPassed = row.regions.length > 0 && row.regions.every(region => region.passed);
  row.pixel.rawThresholdPassed = row.pixel.fraction <= row.pixel.threshold;
  row.pixel.passed = row.pixel.eligible && row.pixel.rawThresholdPassed && row.regionThresholdsPassed;
  if (row.pixel.eligible) row.comparison = row.pixel.passed ? 'pixel-pass' : 'pixel-fail';
}
await writeFile(resultsPath, JSON.stringify(report, null, 2) + String.fromCharCode(10));
const regions = report.results.flatMap(row => row.regions || []);
console.log(JSON.stringify({ regions: regions.length, eligible: regions.filter(region => region.eligible).length, passed: regions.filter(region => region.passed).length, structuralThreshold: manifest.pixelPolicy.structuralFraction, textThreshold: manifest.pixelPolicy.textDenseFraction, masks: [] }));
