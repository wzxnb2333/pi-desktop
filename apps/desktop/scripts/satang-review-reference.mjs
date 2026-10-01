import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const donor = process.argv[2];
if (!donor) throw new Error('Pass the read-only satang_code reference directory.');
const samples = [];
const keys = ['backgroundColor', 'color', 'fontSize', 'lineHeight', 'fontWeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderRadius', 'borderLeftWidth', 'borderBottomWidth'];
for (const theme of ['light', 'dark']) for (const [width, height] of [[1440, 940], [1000, 700]]) {
  const file = '.artifacts/reference/26.915.4065.0/review/' + theme + '-' + width + 'x' + height + '.dom-styles.json';
  const bytes = await readFile(resolve(donor, file));
  const nodes = JSON.parse(bytes.toString('utf8')).nodes;
  const find = predicate => { const node = nodes.find(predicate); if (!node) throw new Error('Missing Review node in ' + file); return node; };
  const strip = find(node => node.role === 'presentation' && node.cls?.startsWith('h-toolbar '));
  const selected = {
    strip,
    header: find(node => node.cls?.startsWith('@container/review-header ')),
    fileHeader: find(node => node.cls?.startsWith('group/diff-header ')),
    files: find(node => node.cls === 'relative flex h-full shrink-0 border-l border-default'),
    filterRow: find(node => node.i > strip.i && node.cls === 'flex shrink-0 items-center gap-1 px-2 pt-2 pb-px'),
    filter: find(node => node.i > strip.i && node.cls?.startsWith('relative flex h-token-button-composer ')),
    tree: find(node => node.tag === 'file-tree-container'),
  };
  const measurements = Object.fromEntries(Object.entries(selected).map(([key, node]) => [key, { node: node.i, rect: Array.isArray(node.rect) ? { x: node.rect[0], y: node.rect[1], w: node.rect[2], h: node.rect[3] } : node.rect, css: Object.fromEntries(keys.map(property => [property, node.styles[property]])) }]));
  samples.push({ theme, width, height, file, sha256: createHash('sha256').update(bytes).digest('hex'), measurements });
}
const sources = [];
for (const file of ['src/renderer/src/surfaces/review/index.tsx', 'src/renderer/src/surfaces/review/styles/tokens.css', 'src/renderer/src/styles/review.css']) sources.push({ file, sha256: createHash('sha256').update(await readFile(resolve(donor, file))).digest('hex') });
await writeFile(resolve(import.meta.dirname, '../../../docs/desktop/satang-review-reference.json'), JSON.stringify({ schemaVersion: 1, version: '26.915.4065.0', scope: 'Four earlier valid Review captures. Geometry covers chrome, header, file header, tree width and filter. Shadow-root diff lines and file rows are Pi functional adaptations; source data and placeholder controls are not copied.', samples, sources }, null, 2) + String.fromCharCode(10));
console.log('Imported four valid earlier Review DOM captures and source hashes.');
