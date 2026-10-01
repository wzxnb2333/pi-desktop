import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const donor = process.argv[2];
if (!donor) throw new Error('Pass the read-only satang_code reference directory.');
const keys = ['backgroundColor', 'color', 'fontSize', 'lineHeight', 'fontWeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderRadius', 'borderTopWidth', 'gap', 'maxWidth', 'maxHeight', 'height', 'whiteSpace', 'boxShadow'];
const samples = [];
for (const theme of ['light', 'dark']) {
  const file = '.artifacts/reference/26.915.4065.0/workspace/' + theme + '-1440x940.dom-styles.json';
  const bytes = await readFile(resolve(donor, file));
  const nodes = JSON.parse(bytes.toString('utf8')).nodes;
  const find = predicate => { const node = nodes.find(predicate); if (!node) throw new Error('Missing workspace node in ' + file); return node; };
  const bubble = find(node => node.cls?.includes('_bubble_'));
  const plan = find(node => node.cls?.includes('max-h-[200px]'));
  const notice = find(node => node.tag === 'aside' && node.cls?.includes('border-primary-outline') && node.cls?.endsWith('gap-3'));
  const selected = {
    scroll: find(node => node.cls?.startsWith('thread-scroll-container ')),
    column: find(node => node.cls?.includes('_transcriptBody_')),
    bubble,
    userMarkdown: find(node => node.i > bubble.i && node.cls?.includes('_MarkdownRoot_')),
    activity: find(node => node.tag === 'button' && node.cls?.startsWith('group/activity-header ')),
    plan,
    planHeader: find(node => node.i > plan.i && node.cls === 'relative flex h-10 flex-wrap items-center justify-between gap-2 px-3 py-2'),
    planTitle: find(node => node.i > plan.i && node.cls === 'text-base leading-tight inline-flex items-center gap-2 font-normal text-tertiary'),
    planBody: find(node => node.i > plan.i && node.cls === 'px-4 py-3'),
    notice,
  };
  samples.push({ theme, width: 1440, height: 940, file, sha256: createHash('sha256').update(bytes).digest('hex'), measurements: Object.fromEntries(Object.entries(selected).map(([key, node]) => [key, { node: node.i, css: Object.fromEntries(keys.map(property => [property, node.styles[property]])) }])) });
}
const sources = [];
for (const file of ['src/renderer/src/surfaces/workspace/index.tsx', 'src/renderer/src/surfaces/workspace/parts.tsx', 'src/renderer/src/styles/workspace.css']) sources.push({ file, sha256: createHash('sha256').update(await readFile(resolve(donor, file))).digest('hex') });
const unavailable = [];
for (const surface of ['approval', 'emptyloading']) {
  const file = 'src/renderer/src/surfaces/' + surface + '/index.tsx';
  const specFile = 'spec/surfaces/' + surface + '.json';
  const source = await readFile(resolve(donor, file));
  const spec = JSON.parse(await readFile(resolve(donor, specFile), 'utf8'));
  unavailable.push({ surface, file, sha256: createHash('sha256').update(source).digest('hex'), specFile, reached: spec.reached, captures: spec.captures, status: 'Source entry is a placeholder; no measured signed-in state. Keep functional Pi states; do not copy invented-v1 backups.' });
}
await writeFile(resolve(import.meta.dirname, '../../../docs/desktop/satang-workspace-reference.json'), JSON.stringify({ schemaVersion: 1, version: '26.915.4065.0', scope: 'Valid earlier normal conversation DOM supplies CSS values. Capture pane widths differ; absolute coordinates and narrow-width pixels are not claimed. Persistent folds, turn metadata, complete scrollable plans and real Pi state remain functional adaptations.', samples, sources, unavailable }, null, 2) + String.fromCharCode(10));
console.log('Imported two valid workspace DOM captures and audited unavailable state entries.');
