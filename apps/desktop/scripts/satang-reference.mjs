import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Read-only importer: retain geometry and provenance, never captured conversation text.
const donor = process.argv[2];
if (!donor) throw new Error('Usage: node apps/desktop/scripts/satang-reference.mjs <satang_code directory>');
const root = resolve(import.meta.dirname, '../../..');
const version = '26.915.4065.0';
const archiveSha256 = 'b8aeb817cd1ee6ef50efe8a97985d3be41de89688a5addfe0a444e1e52348096';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const properties = ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'borderRadius', 'backgroundColor', 'color', 'fontFamily', 'fontSize', 'lineHeight', 'fontWeight', 'gap', 'flexGrow', 'flexShrink', 'flexBasis'];
const selectors = {
  layout: node => node.cls?.startsWith('group/home-composer-layout '),
  hero: node => node.cls?.includes('basis-0 pb-24'),
  heading: node => node.cls?.startsWith('heading-xl flex'),
  dock: node => node.cls?.startsWith('flex min-w-0 shrink-0 flex-col group-has-'),
  utility: node => node.cls?.includes('_ComposerHomeUtilityBar_'),
  composer: node => node.cls?.includes('_ComposerLayoutRoot_'),
  body: node => node.cls?.includes('_ComposerLayoutBody_'),
  textbox: node => node.role === 'textbox' && node.ariaLabel === 'Do anything',
};
const samples = [];
for (const theme of ['light', 'dark']) for (const [width, height] of [[1440, 940], [1000, 700]]) {
  const file = `.artifacts/reference/${version}/pinned/welcome/${theme}/${width}x${height}.dom-styles.json`;
  const bytes = await readFile(resolve(donor, file));
  const capture = JSON.parse(bytes.toString('utf8'));
  const measurements = {};
  for (const [key, select] of Object.entries(selectors)) {
    const nodes = capture.nodes.filter(select).filter(node => node.rect.w > 0 && node.rect.h > 0);
    if (nodes.length !== 1) throw new Error(`${file}: expected one ${key} node, found ${nodes.length}`);
    const node = nodes[0];
    measurements[key] = { node: node.i, rect: node.rect, css: Object.fromEntries(properties.map(property => [property, node.styles[property]])) };
  }
  const image = file.replace('.dom-styles.json', '.png');
  samples.push({ theme, width, height, file, sha256: hash(bytes), image, imageSha256: hash(await readFile(resolve(donor, image))), measurements });
}
const sources = [];
for (const file of ['docs/parity/reference-status.md', 'src/renderer/src/styles/welcome.css', 'src/renderer/src/surfaces/welcome/styles/tokens.css', 'src/renderer/src/surfaces/welcome/index.tsx']) {
  sources.push({ file, sha256: hash(await readFile(resolve(donor, file))) });
}
const record = { schemaVersion: 1, source: 'satang_code', version, appVersion: '26.915.31945', archiveSha256, scope: 'Project welcome, pinned 240px sidebar; captured error banners and Windows setup wording are excluded from product content.', sources, samples };
await writeFile(resolve(root, 'docs/desktop/satang-reference.json'), JSON.stringify(record, null, 2) + '\n');
console.log(`Imported ${samples.length} welcome captures and ${sources.length} source hashes; no images opened.`);
