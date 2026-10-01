import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ref = JSON.parse(readFileSync(resolve(root, 'docs/desktop/reference-contract.json'), 'utf8'));
function declarations(mode) {
  const sample = ref.samples.find((s) => s.mode === mode);
  return Object.entries({
    ...sample.palette,
    'composer-background': sample.measurements.composer.css['background-color'],
    'elevation-composer': sample.measurements.composer.css['box-shadow'],
    'elevation-popover': sample.measurements.menu.css['box-shadow'],
  })
    .map(([key, value]) => '  --' + key + ': ' + value + ';')
    .join('\n');
}
const css =
  '/* Generated from Codex 26.917.71314 default theme functions. See reference-contract.json. */\n:root {\n' +
  declarations('light') +
  '\n}\n:root[data-theme="dark"] {\n' +
  declarations('dark') +
  '\n}\n@media (prefers-color-scheme: dark) {\n :root[data-theme="system"] {\n' +
  declarations('dark') +
  '\n }\n}\n@supports (corner-shape: superellipse(1.5)) {\n :root {\n --radius-md: .625rem; --radius-lg: .78125rem; --radius-xl: .9375rem;\n --radius-2xl: 1.25rem; --radius-3xl: 1.5625rem; --radius-4xl: 1.875rem;\n --radius-button: var(--radius-lg);\n }\n .btn, .menu-list, .dialog { corner-shape: superellipse(1.5); }\n}\n';
writeFileSync(
  resolve(root, 'apps/desktop/src/renderer/src/styles/reference-theme.css'),
  css.replaceAll('\\n', '\n'),
);
