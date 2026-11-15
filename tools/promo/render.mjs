/*
 * Promo renderer.
 *
 * Bundles a scene with esbuild, serves it over loopback HTTP (the page posts the
 * finished MP4 back to the same server), drives it in the system Chrome through
 * Playwright, and writes the result to disk.
 *
 * There is no ffmpeg anywhere in this path: Chrome's WebCodecs does H.264 + AAC
 * and mp4-muxer wraps the chunks into a real MP4.
 *
 *   node tools/promo/render.mjs --scene smoke --seconds 3 --out .artifacts/promo/smoke.mp4
 */
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

function parseArgs(argv) {
  const args = { scene: 'scene', seconds: null, out: null, from: null, to: null, still: null, headful: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--scene') args.scene = argv[++i];
    else if (key === '--seconds') args.seconds = Number(argv[++i]);
    else if (key === '--out') args.out = argv[++i];
    else if (key === '--from') args.from = Number(argv[++i]);
    else if (key === '--to') args.to = Number(argv[++i]);
    else if (key === '--still') args.still = argv[++i];
    else if (key === '--headful') args.headful = true;
  }
  // Stills go to their own folder: they are a look-check, not a deliverable.
  args.out = args.out ?? (args.still
    ? join(ROOT, `.artifacts/promo/stills/${args.scene}-still.mp4`)
    : join(ROOT, `.artifacts/promo/${args.scene}.mp4`));
  return args;
}

async function bundleScene(sceneDir) {
  const outfile = join(sceneDir, 'bundle.js');
  const result = await build({
    entryPoints: [join(sceneDir, 'app.js')],
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    logLevel: 'silent',
    sourcemap: false,
  });
  if (result.errors.length) throw new Error(result.errors.map((e) => e.text).join('\n'));
  return outfile;
}

function contentType(path) {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

/**
 * Static server for the scene plus a POST /save sink.
 * The page cannot write to disk itself, so it hands the finished bytes back here.
 * `?name=video` writes the final path; any other name becomes a file next to it,
 * which is how a still render drops several PNGs in one page load.
 */
function startServer(sceneDir, outputPath) {
  const saved = [];
  const server = createServer((req, res) => {
    if (req.method === 'POST' && (req.url ?? '').startsWith('/save')) {
      const name = new URL(req.url, 'http://x').searchParams.get('name') ?? 'video';
      const target = name === 'video' ? outputPath : join(dirname(outputPath), `${name}.png`);
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', async () => {
        const body = Buffer.concat(chunks);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, body);
        saved.push({ bytes: body.byteLength, path: target });
        res.writeHead(200).end('ok');
      });
      return;
    }
    const name = (req.url ?? '/').split('?')[0] === '/' ? '/index.html' : (req.url ?? '/').split('?')[0];
    const file = join(sceneDir, name);
    if (!file.startsWith(sceneDir)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    import('node:fs/promises')
      .then((fs) => fs.readFile(file))
      .then((data) => res.writeHead(200, { 'content-type': contentType(file) }).end(data))
      .catch(() => res.writeHead(404).end('not found'));
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => done({ server, port: server.address().port, saved }));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sceneDir = resolve(HERE, args.scene);
  await mkdir(dirname(args.out), { recursive: true });

  const started = Date.now();
  await bundleScene(sceneDir);
  console.log(`[render] bundled ${args.scene}`);

  const { server, port, saved } = await startServer(sceneDir, args.out);
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !args.headful,
    args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--no-sandbox', '--mute-audio'],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    page.on('console', (message) => {
      if (message.type() === 'error') console.log(`[page:error] ${message.text()}`);
    });
    page.on('pageerror', (error) => console.log(`[page:throw] ${error.message}`));

    const query = new URLSearchParams();
    if (args.seconds !== null) query.set('seconds', String(args.seconds));
    if (args.from !== null) query.set('from', String(args.from));
    if (args.to !== null) query.set('to', String(args.to));
    if (args.still !== null) query.set('still', args.still);
    const url = `http://127.0.0.1:${port}/index.html?${query}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction('window.__smokeReady === true', null, { timeout: 30_000 });

    const log = await page.evaluate(() => window.__smoke());
    for (const line of log) console.log(`[encode] ${line}`);

    if (!saved.length) throw new Error('page finished without posting anything to /save');
    for (const item of saved) {
      console.log(`[render] wrote ${item.path} (${(item.bytes / 1024 / 1024).toFixed(2)} MB)`);
    }
    console.log(`[render] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(`[render] FAILED: ${error.message}`);
  process.exitCode = 1;
});
