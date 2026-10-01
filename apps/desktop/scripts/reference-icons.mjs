import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const input = resolve(root, process.argv[2] ?? '.artifacts/codex-reference/26.917.9434.0/webview/assets');
const assets = {
  sidebar: 'sidebar-left-59ba729cde31.svg',
  review: 'sidebar-right-9fc56981dfae.svg',
  plus: 'plus-d6d3b78691d3.svg',
  send: 'arrow-up-sm-91887259a72f.svg',
  stop: 'stop-sm-cd0e1cd54621.svg',
  down: 'chevron-down-6d8fb03d85b2.svg',
  right: 'chevron-right-b4fa8e89cb1b.svg',
  terminal: 'terminal-46e2c288a804.svg',
  attachment: 'paperclip-b704d9072ad7.svg',
};
const icons = {};
const sources = [];
for (const [name, file] of Object.entries(assets)) {
  const bytes = readFileSync(resolve(input, file));
  const svg = bytes.toString('utf8');
  if (!svg.includes('viewBox="0 0 24 24"') || /<(?:script|image|use|foreignObject|g)\b/.test(svg))
    throw new Error('Unsupported SVG: ' + file);
  const paths = [...svg.matchAll(/<path\b([^>]+)\/?\s*>/g)].map((match) => {
    const attrs = Object.fromEntries(
      [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((attr) => [attr[1], attr[2]]),
    );
    if (!attrs.d || Object.keys(attrs).some((key) => !['d', 'fill', 'fill-rule', 'clip-rule'].includes(key)))
      throw new Error('Unsupported path: ' + file);
    return {
      d: attrs.d,
      ...(attrs['fill-rule'] ? { fillRule: attrs['fill-rule'] } : {}),
      ...(attrs['clip-rule'] ? { clipRule: attrs['clip-rule'] } : {}),
    };
  });
  if (!paths.length) throw new Error('Empty SVG: ' + file);
  icons[name] = paths;
  sources.push({
    name,
    file: 'webview/assets/' + file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    paths,
  });
}
const newline = String.fromCharCode(10);
writeFileSync(
  resolve(root, 'apps/desktop/src/renderer/src/components/primitives/reference-icon-data.ts'),
  '// Generated from pinned SVG path definitions; run scripts/reference-icons.mjs.' +
    newline +
    'export const referenceIcons = ' +
    JSON.stringify(icons, null, 2) +
    ' as const;' +
    newline,
);
writeFileSync(
  resolve(root, 'docs/desktop/reference-icons.json'),
  JSON.stringify(
    {
      msixVersion: '26.917.9434.0',
      appVersion: '26.917.71314',
      mapping:
        'Original glyph geometry; mapping glyphs to Pi controls is a capability adaptation, not proof of every vendor callsite.',
      sources,
    },
    null,
    2,
  ) + newline,
);
console.log('Extracted ' + sources.length + ' path-only icons; no images or application code executed.');
