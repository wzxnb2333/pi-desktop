import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const donor = process.argv[2];
if (!donor) throw new Error('Pass the read-only satang_code reference directory.');
const samples = [];
const cssKeys = ['backgroundColor', 'color', 'fontSize', 'fontWeight', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderRadius', 'borderTopWidth', 'borderTopColor', 'boxShadow'];
for (const theme of ['light', 'dark']) for (const [width, height] of [[1440, 940], [1000, 700]]) {
  // Pinned capture did not reach the compact palette. Preserve that provenance.
  const pinned = width === 1440;
  const file = '.artifacts/reference/26.915.4065.0/' + (pinned ? 'pinned/palette/' + (theme === 'dark' ? 'dark2' : theme) + '/' : 'palette/' + theme + '-') + width + 'x' + height + '.dom-styles.json';
  const bytes = await readFile(resolve(donor, file));
  const nodes = JSON.parse(bytes.toString('utf8')).nodes;
  const dialog = nodes.find(node => node.role === 'dialog' && node.cls?.includes('command-menu-dialog'));
  if (!dialog) throw new Error('Missing palette dialog in ' + file);
  const children = nodes.filter(node => node.i > dialog.i);
  const selected = { dialog, panel: children[0], input: children.find(node => node.role === 'combobox'), list: children.find(node => node.role === 'listbox'), row: children.find(node => node.role === 'option') };
  const measurements = {};
  for (const [key, node] of Object.entries(selected)) {
    if (!node) throw new Error('Missing palette ' + key + ' in ' + file);
    const rect = Array.isArray(node.rect)
      ? Object.fromEntries(['x', 'y', 'w', 'h'].map((key, index) => [key, node.rect[index]]))
      : { x: node.rect.x, y: node.rect.y, w: node.rect.w, h: node.rect.h };
    if (Object.values(rect).some(value => typeof value !== 'number')) throw new Error('Invalid capture rectangle: ' + file + ' ' + key);
    measurements[key] = { node: node.i, rect, css: Object.fromEntries(cssKeys.filter(key => node.styles[key] !== undefined).map(key => [key, node.styles[key]])) };
  }
  samples.push({ theme, width, height, pinned, file, sha256: createHash('sha256').update(bytes).digest('hex'), measurements });
}
await writeFile(resolve(import.meta.dirname, '../../../docs/desktop/satang-palette-reference.json'), JSON.stringify({
  schemaVersion: 1, version: '26.915.4065.0', scope: 'Captured palette positioning, panel, input and row styles. Pi commands, result counts and search snippets remain functional adaptations.', samples,
}, null, 2) + '\n');
console.log('Imported four palette DOM samples, including two explicitly unpinned compact captures.');
