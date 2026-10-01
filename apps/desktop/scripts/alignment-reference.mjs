import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const root = resolve(import.meta.dirname, '../../..');
const donor = resolve(process.argv[2] ?? 'E:/AI_collection/satang_code');
const require = createRequire(import.meta.url);
const { PNG } = require(resolve(root, 'node_modules/playwright-core/lib/utilsBundle.js'));
const version = '26.915.4065.0';
const hash = value => createHash('sha256').update(value).digest('hex');
const extractionBytes = await readFile(resolve(root, '.artifacts/codex-reference/' + version + '/manifest.json'));
const extraction = JSON.parse(extractionBytes);
if (extraction.msixVersion !== version || extraction.appVersion !== '26.915.31945') throw new Error('Extracted source version mismatch');
const original = JSON.parse(await readFile(resolve(donor, 'spec/reference-scenes.json'), 'utf8'));
if (original.version !== version) throw new Error('Reference version does not match the approved baseline');
const rows = [];
const excluded = [];
function text(capture) { return capture.visibleText || capture.nodes.map(node => node.text || '').join(' '); }
function hasErrorBody(capture) {
  return /thread can.t resume|Model provider .* not found|can.t load config\.toml|failed to load (?:session|thread)/i.test(text(capture));
}
function failed(capture, surface) {
  return hasErrorBody(capture) && ['workspace', 'management'].includes(surface);
}
for (const source of original.scenes) {
  let domPath = source.dom, imagePath = source.screenshot;
  let domBytes = await readFile(resolve(donor, domPath));
  let capture = JSON.parse(domBytes);
  if (hash(domBytes) !== source.domSha256) throw new Error(source.id + ': DOM hash mismatch');
  if (failed(capture, source.surface)) {
    excluded.push({ id: source.id, dom: domPath, screenshot: imagePath, reason: 'Session-load failure is not a normal workspace or management reference', sha256: hash(domBytes) });
    domPath = './.artifacts/reference/' + version + '/' + source.surface + '/' + source.theme + '-' + source.viewport.id + '.dom-styles.json';
    imagePath = domPath.replace('.dom-styles.json', '.png');
    domBytes = await readFile(resolve(donor, domPath));
    capture = JSON.parse(domBytes);
  }
  const imageBytes = await readFile(resolve(donor, imagePath));
  if (imagePath === source.screenshot && hash(imageBytes) !== source.screenshotSha256) throw new Error(source.id + ': screenshot hash mismatch');
  const png = PNG.sync.read(imageBytes);
  let transparent = 0;
  for (let offset = 3; offset < png.data.length; offset += 4) if (png.data[offset] !== 255) transparent++;
  let composition = null;
  if (transparent && source.composition) {
    const baseBytes = await readFile(resolve(donor, source.composition.source));
    if (hash(baseBytes) !== source.composition.sha256) throw new Error(source.id + ': backdrop evidence hash mismatch');
    const base = PNG.sync.read(baseBytes);
    const offset = (source.composition.at.y * base.width + source.composition.at.x) * 4;
    const actual = [...base.data.subarray(offset, offset + 3)];
    if (actual.join() !== source.composition.background.join()) throw new Error(source.id + ': backdrop evidence pixel mismatch');
    composition = { ...source.composition, verified: true, limitation: 'Native spatial tint cannot be reconstructed from one background sample; composition is only a comparison aid.' };
  }
  const nodes = capture.nodes ?? [];
  const asRect = rect => Array.isArray(rect) ? { x: rect[0], y: rect[1], w: rect[2], h: rect[3] } : rect;
  const isVisible = node => {
    const box = asRect(node.rect);
    return box?.w > 0 && box?.h > 0 && box.x < source.viewport.width && box.y < source.viewport.height && box.x + box.w > 0 && box.y + box.h > 0 && node.styles?.visibility !== 'hidden' && node.styles?.display !== 'none' && node.styles?.opacity !== '0';
  };
  const palette = nodes.find(node => node.cls?.includes('global-command-menu-dialog') && isVisible(node));
  const selectors = {
    main: node => node.cls?.includes('_MainContentSurface_'),
    sidebar: node => node.cls?.includes('app-shell-left-panel'),
    titlebar: node => node.cls?.includes('_ApplicationMenuTopBar_'),
    composer: node => node.cls?.includes('_ComposerLayoutBody_'),
    heading: node => node.cls?.startsWith('heading-xl flex'),
    ...(source.surface === 'terminal' ? {
      terminalSurface: node => node.cls === 'relative flex h-full w-full flex-col' && node.styles?.backgroundColor === 'rgb(24, 24, 24)',
      terminalStrip: node => node.cls?.startsWith('h-toolbar-pane '),
    } : {}),
    ...(source.surface === 'preview' ? {
      browserStrip: node => node.cls?.startsWith('h-toolbar bg-') && node.role === 'presentation',
      browserAddress: node => node.tag === 'input' && node.cls?.includes('placeholder:text-tertiary'),
    } : {}),
    ...(source.surface === 'palette' && palette ? {
      palette: node => node.i === palette.i + 1,
      paletteInput: node => node.i > palette.i && node.role === 'combobox',
      paletteList: node => node.i > palette.i && node.role === 'listbox',
      paletteRow: node => node.i > palette.i && node.role === 'option',
    } : {}),
  };
  const measurements = Object.fromEntries(Object.entries(selectors).flatMap(([key, predicate]) => {
    const node = nodes.find(node => predicate(node) && isVisible(node));
    return node ? [[key, { node: node.i, rect: asRect(node.rect), css: node.styles }]] : [];
  }));
  const dock = nodes.find(node => node.cls?.includes('absolute top-0 bottom-0 min-w-0 left-0') && isVisible(node));
  const terminalHeader = source.surface === 'terminal' ? nodes.find(node => node.cls?.startsWith('h-toolbar-pane ') && isVisible(node)) : undefined;
  const capturedLayout = {
    sidebarWidth: measurements.sidebar?.rect.w,
    ...(dock ? { reviewWidth: asRect(dock.rect).w } : {}),
    ...(terminalHeader ? { terminalHeight: source.viewport.height - asRect(terminalHeader.rect).y + 1 } : {}),
    summaryVisible: nodes.some(node => node.cls?.includes('group/summary-panel-item') && isVisible(node)),
  };
  // The earlier workspace fallback has HTTP error cards instead of the load-error
  // wording. It remains diagnostic even when the generic string matcher is false.
  const diagnosticBody = source.surface === 'workspace' || hasErrorBody(capture);
  rows.push({ id: source.id, surface: source.surface, theme: source.theme, locale: 'en-US', viewport: source.viewport,
    screenshot: imagePath, screenshotSha256: hash(imageBytes), dom: domPath, domSha256: hash(domBytes),
    state: { ...source.state, provenance: imagePath === source.screenshot ? 'Pinned scene state' : 'Earlier same-version capture; inspect its own DOM for panel and scroll state' },
    validity: diagnosticBody ? 'diagnostic-error-body' : transparent && !composition ? 'geometry-only' : 'usable-with-registered-differences',
    comparisonScope: diagnosticBody ? 'shell-and-components-only' : 'registered-scene',
    wholeWindowEligible: !diagnosticBody,
    transparentPixels: transparent, composition, measurements, capturedLayout,
    limitations: ['Pi brand and real product functions have separately registered differences.', ...(transparent ? ['Composited native backdrop does not establish exact native tint.'] : []), ...(diagnosticBody ? ['Visible conversation contains a provider error; only its unaffected shell or panel components may be compared. Offscreen nodes do not establish an expanded state.'] : [])],
  });
}
const manifest = {
  msixVersion: version, appVersion: '26.915.31945', archiveSha256: extraction.archiveSha256,
  extractionManifestSha256: hash(extractionBytes),
  archiveVerification: 'Hash retained by the same-version extraction manifest; the old installed archive is no longer present to rehash.',
  referenceRoot: donor, sourceManifestSha256: hash(await readFile(resolve(donor, 'spec/reference-scenes.json'))),
  pixelPolicy: { geometryPx: 1, radiusAndBorderPx: .5, structuralFraction: .005, textDenseFraction: .01, blanketTextOrIconMasks: false },
  excluded, scenes: rows,
  adaptations: ['approval', 'loading', 'model-connections', 'mcp', 'resource-inspection', 'inbox', 'automation-editor', 'terminal-search', 'file-editor', 'git-workflows', 'task-summary', 'icon-glyphs'],
  iconEvidence: { source: 'Satang spec/icons.json and the retained 26.915 extraction', limitation: 'The DOM collector omitted SVG geometry and the retained extraction contains no SVG files. Newer 26.917 glyphs are no longer imported. Existing project Lucide icons occupy measured slots as explicitly unverified Pi adaptations.' },
  differences: [
    { id: 'brand', scope: 'Pi marks and Pi Desktop product name', reason: 'User requested Pi branding' },
    { id: 'account', scope: 'Local workspace profile instead of Codex account profile', reason: 'Preserve real Pi capabilities' },
    { id: 'navigation', scope: 'Existing Pi Inbox, Automations and Skills functionality', reason: 'No mocked pull requests, plugins or account endpoints' },
    { id: 'setup', scope: 'Windows setup card', reason: 'Codex-specific runtime setup is absent in Pi; Pi model setup is shown only when needed' },
    { id: 'content', scope: 'Conversation, paths, providers, tools, files and timestamps', reason: 'Real data is never overwritten to obtain a passing image' },
  ],
};
const output = resolve(root, 'docs/desktop/codex-26915-reference-manifest.json');
await mkdir(resolve(root, 'docs/desktop'), { recursive: true });
await writeFile(output, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ output, scenes: rows.length, excluded: excluded.length, geometryOnly: rows.filter(row => row.validity === 'geometry-only').length }));
