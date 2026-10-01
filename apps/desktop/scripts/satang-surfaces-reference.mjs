import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const donor = process.argv[2];
if (!donor) throw new Error('Pass the read-only satang_code reference directory.');
const cssKeys = ['backgroundColor', 'fontSize', 'fontWeight', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderRadius'];
const samples = [];
for (const surface of ['settings', 'terminal', 'preview']) {
  for (const theme of ['light', 'dark']) for (const [width, height] of [[1440, 940], [1000, 700]]) {
    const file = `.artifacts/reference/26.915.4065.0/pinned/${surface}/${theme === 'dark' ? 'dark2' : theme}/${width}x${height}.dom-styles.json`;
    const bytes = await readFile(resolve(donor, file));
    const nodes = JSON.parse(bytes.toString('utf8')).nodes;
    const find = predicate => { const node = nodes.find(predicate); if (!node) throw new Error('Missing captured node in ' + file); return node; };
    let selected;
    if (surface === 'settings') {
      const frame = find(node => node.cls?.startsWith('group/settings mx-auto'));
      selected = { frame, heading: find(node => node.i > frame.i && node.tag === 'h1'), card: find(node => node.i > frame.i && node.cls?.includes('rounded-2xl overflow-hidden border border-default')) };
    } else {
      const strip = find(node => node.role === 'presentation' && node.cls?.startsWith(surface === 'terminal' ? 'h-toolbar-pane ' : 'h-toolbar '));
      selected = { strip, tab: find(node => node.i > strip.i && node.role === 'tab') };
      if (surface === 'preview') {
        selected.address = find(node => node.i > strip.i && node.tag === 'input' && node.role === 'combobox');
        selected.emptyHeading = find(node => node.i > strip.i && node.cls === 'text-lg leading-6 font-medium text-default');
      }
    }
    const measurements = Object.fromEntries(Object.entries(selected).map(([key, node]) => [key, { node: node.i, rect: node.rect, css: Object.fromEntries(cssKeys.map(property => [property, node.styles[property]])) }]));
    samples.push({ surface, theme, width, height, file, sha256: createHash('sha256').update(bytes).digest('hex'), measurements });
  }
}
await writeFile(resolve(import.meta.dirname, '../../../docs/desktop/satang-surfaces-reference.json'), JSON.stringify({ schemaVersion: 1, version: '26.915.4065.0', scope: 'Captured auxiliary-panel chrome and settings geometry. Pi controls and content remain functional adaptations.', samples }, null, 2) + '\n');
console.log('Imported twelve pinned auxiliary-panel and settings DOM samples.');
