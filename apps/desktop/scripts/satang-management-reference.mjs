import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const donor = process.argv[2];
if (!donor) throw new Error('Pass the read-only satang_code reference directory.');
const samples = [];
const keys = ['backgroundColor', 'color', 'fontSize', 'lineHeight', 'fontWeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderRadius', 'gap', 'maxWidth', 'minHeight'];
for (const theme of ['light', 'dark']) for (const [width, height] of [[1440, 940], [1000, 700]]) {
  const file = '.artifacts/reference/26.915.4065.0/management/' + theme + '-' + width + 'x' + height + '.dom-styles.json';
  const bytes = await readFile(resolve(donor, file));
  const nodes = JSON.parse(bytes.toString('utf8')).nodes;
  const find = predicate => { const node = nodes.find(predicate); if (!node) throw new Error('Missing management node in ' + file); return node; };
  const heading = find(node => node.tag === 'h1');
  const selected = {
    column: find(node => node.cls === 'mx-auto w-full px-panel max-w-[var(--thread-content-max-width)] pt-panel'),
    heading,
    subtitle: find(node => node.i > heading.i && node.cls === 'text-base leading-6 text-secondary'),
    searchRow: find(node => node.i > heading.i && node.cls?.startsWith('mx-auto flex w-full items-center gap-2 px-panel pb-2 ')),
    searchField: find(node => node.i > heading.i && node.cls?.includes('h-page-search')),
    input: find(node => node.i > heading.i && node.tag === 'input'),
    filterRow: find(node => node.i > heading.i && node.cls === 'flex items-center justify-between gap-4 pb-2 px-3'),
    selectedFilter: find(node => node.i > heading.i && node.tag === 'button' && node.cls?.includes('bg-segmented-selected ')),
    empty: find(node => node.cls?.includes('min-h-[var(--height-token-empty-state-page)]')),
    emptyContent: find(node => node.cls === 'flex w-full max-w-xl flex-col items-center justify-center text-center gap-3'),
    emptyTitle: find(node => node.cls === 'text-lg leading-6 font-medium text-default'),
    emptyBody: find(node => node.i > heading.i && node.cls === 'text-sm text-secondary'),
    cta: find(node => node.i > heading.i && node.tag === 'button' && node.cls?.includes('bg-text/5 ')),
  };
  samples.push({ theme, width, height, file, sha256: createHash('sha256').update(bytes).digest('hex'), measurements: Object.fromEntries(Object.entries(selected).map(([key, node]) => [key, { node: node.i, rect: { x: node.rect[0], y: node.rect[1], w: node.rect[2], h: node.rect[3] }, css: Object.fromEntries(keys.map(property => [property, node.styles[property]])) }])) });
}
const sources = [];
for (const file of ['src/renderer/src/surfaces/management/sites.tsx', 'src/renderer/src/surfaces/management/measured.ts', 'src/renderer/src/styles/management.css']) sources.push({ file, sha256: createHash('sha256').update(await readFile(resolve(donor, file))).digest('hex') });
await writeFile(resolve(import.meta.dirname, '../../../docs/desktop/satang-management-reference.json'), JSON.stringify({ schemaVersion: 1, version: '26.915.4065.0', scope: 'Earlier valid Sites captures supply shared management geometry. Pi resources, inbox and local schedules retain their own data, controls and text wrapping; no Sites service is implied. Global toolbar actions and populated resource/job rows are Pi functional adaptations.', samples, sources }, null, 2) + String.fromCharCode(10));
console.log('Imported four valid management DOM captures and source hashes.');
