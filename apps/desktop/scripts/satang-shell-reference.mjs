import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const donor = process.argv[2];
if (!donor) throw new Error('Pass the read-only satang_code reference directory.');
const root = resolve(import.meta.dirname, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const properties = ['borderRadius', 'fontSize', 'lineHeight', 'fontWeight', 'color', 'backgroundColor'];
const samples = [];
for (const theme of ['light', 'dark']) for (const [width, height] of [[1440, 940], [1000, 700]]) {
  const file = '.artifacts/reference/26.915.4065.0/pinned/sidebar/' + (theme === 'dark' ? 'dark2' : theme) + '/' + width + 'x' + height + '.dom-styles.json';
  const bytes = await readFile(resolve(donor, file));
  const nodes = JSON.parse(bytes.toString('utf8')).nodes.filter(node => node.rect.w > 0 && node.rect.h > 0);
  const selectors = {
    titlebar: node => node.cls?.includes('_ApplicationMenuTopBar_'),
    toggle: node => node.ariaLabel === 'Hide sidebar',
    back: node => node.ariaLabel === 'Back',
    forward: node => node.ariaLabel === 'Forward',
    brand: node => node.ariaLabel?.startsWith('Switch mode, current mode:'),
    search: node => node.ariaLabel === 'Search' && node.tag === 'button',
    section: node => node.cls?.startsWith('group/nav-section-title flex'),
    project: node => node.cls?.includes('group/folder-row') && node.role === 'button',
    thread: node => node.cls?.includes('data-[app-action-sidebar-thread-selected=true]') && node.role === 'button',
    footer: node => node.cls?.startsWith('flex h-toolbar items-center gap-2 px-row-x'),
    profile: node => node.ariaLabel === 'Open profile menu',
  };
  const measurements = {};
  const record = (key, node) => {
    if (!node) throw new Error(file + ': missing ' + key);
    measurements[key] = { node: node.i, rect: node.rect, css: Object.fromEntries(properties.map(property => [property, node.styles[property]])) };
  };
  for (const [key, select] of Object.entries(selectors)) record(key, nodes.find(select));
  const navRows = nodes.filter(node => node.tag === 'button' && node.cls?.startsWith('sidebar-item '));
  record('newTask', navRows[0]);
  record('primary', navRows[1]);
  record('navText', nodes.find(node => node.i > navRows[1].i && node.cls?.includes('text-base gap-2') && node.rect.x < 240));
  record('projectText', nodes.find(node => node.i > measurements.project.node && node.cls?.includes('text-base text-default') && node.rect.x < 240));
  const image = file.replace('.dom-styles.json', '.png');
  samples.push({ theme, width, height, file, sha256: hash(bytes), image, imageSha256: hash(await readFile(resolve(donor, image))), measurements });
}
const sources = [];
for (const file of ['src/renderer/src/shell/MenuBar.tsx', 'src/renderer/src/shell/LeftPanelHeader.tsx', 'src/renderer/src/surfaces/sidebar/index.tsx', 'src/renderer/src/styles/sidebar.css'])
  sources.push({ file, sha256: hash(await readFile(resolve(donor, file))) });
await writeFile(resolve(root, 'docs/desktop/satang-shell-reference.json'), JSON.stringify({
  schemaVersion: 1, source: 'satang_code', version: '26.915.4065.0', appVersion: '26.915.31945',
  scope: 'Pinned 240px sidebar. Geometry and style only, no captured task or account text. Localized labels and Pi actions are not source pixel claims.', sources, samples,
}, null, 2) + '\n');
console.log('Imported ' + samples.length + ' shell/sidebar DOM captures; no images opened.');
