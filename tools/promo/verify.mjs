/*
 * Read a rendered MP4 back and check it is actually playable.
 *
 * "The file exists" is not evidence. This decodes it in Chrome and asserts on
 * duration, dimensions, that frames change over time, and that real audio is
 * present. It also writes a contact sheet so a human can review the whole thing
 * in one look.
 *
 *   node tools/promo/verify.mjs .artifacts/promo/promo-1080p.mp4
 */
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>verify</title></head>
<body>
<script>
/*
 * Loads the mp4, walks it, and reports back a JSON blob. Two independent checks:
 * a video one (metadata + does the picture actually change between samples) and
 * an audio one (decode the whole track and measure RMS, so a silent-but-present
 * audio track cannot pass).
 */
window.__verify = async function (url, sampleCount) {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.src = url;

  const loaded = await new Promise((res, rej) => {
    video.onloadedmetadata = () => res();
    video.onerror = () => rej(new Error('video failed to load: ' + (video.error && video.error.code)));
    setTimeout(() => rej(new Error('timed out waiting for metadata')), 30000);
  });

  // readyState is sampled at its peak across the whole run, not here: right after
  // loadedmetadata it is still HAVE_METADATA (1), and it only climbs once seeks
  // actually decode frames. Reading it once at this point measures nothing.
  const meta = {
    duration: video.duration,
    width: video.videoWidth,
    height: video.videoHeight,
    readyState: video.readyState,
    peakReadyState: video.readyState,
  };

  // Seek to N evenly spaced timestamps and hash the decoded pixels.
  const canvas = document.createElement('canvas');
  canvas.width = 192; canvas.height = 108;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const hashes = [];
  const brightness = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = (video.duration * (i + 0.5)) / sampleCount;
    await new Promise((res, rej) => {
      const done = () => { video.removeEventListener('seeked', done); res(); };
      video.addEventListener('seeked', done);
      video.currentTime = t;
      setTimeout(() => { video.removeEventListener('seeked', done); rej(new Error('seek timeout at ' + t)); }, 15000);
    });
    // Chromium may report seeked before the new frame is painted; wait one rAF.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (video.readyState > meta.peakReadyState) meta.peakReadyState = video.readyState;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0, hash = 0;
    for (let p = 0; p < data.length; p += 4) {
      const lum = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
      sum += lum;
      hash = (hash * 31 + (lum | 0)) >>> 0;
    }
    hashes.push(hash);
    brightness.push(sum / (data.length / 4));
  }

  // Audio: decode the entire track and measure RMS.
  const audio = { present: false, rms: 0, channels: 0, sampleRate: 0, samples: 0, error: null };
  try {
    const bytes = await (await fetch(url)).arrayBuffer();
    const probe = new OfflineAudioContext(1, 1, 44100);
    const decoded = await probe.decodeAudioData(bytes.slice(0));
    audio.present = true;
    audio.channels = decoded.numberOfChannels;
    audio.sampleRate = decoded.sampleRate;
    audio.samples = decoded.length;
    let sumSq = 0, count = 0;
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const chan = decoded.getChannelData(c);
      // Stride keeps this fast on a 60s file while still measuring the whole track.
      for (let s = 0; s < chan.length; s += 16) { sumSq += chan[s] * chan[s]; count++; }
    }
    audio.rms = Math.sqrt(sumSq / Math.max(1, count));
  } catch (error) {
    audio.error = String(error && error.message || error);
  }

  return { meta, hashes, brightness, audio };
};

/** 4x3 grid of sampled frames, returned as a data URL. */
window.__contactSheet = async function (url, sampleCount, cols, rows) {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.src = url;
  await new Promise((res, rej) => {
    video.onloadedmetadata = () => res();
    video.onerror = () => rej(new Error('load failed'));
    setTimeout(() => rej(new Error('metadata timeout')), 30000);
  });

  const cellW = 480, cellH = 270;
  const sheet = document.createElement('canvas');
  sheet.width = cellW * cols;
  sheet.height = cellH * rows;
  const sctx = sheet.getContext('2d', { alpha: false });
  sctx.fillStyle = '#000';
  sctx.fillRect(0, 0, sheet.width, sheet.height);

  for (let i = 0; i < sampleCount; i++) {
    const t = (video.duration * (i + 0.5)) / sampleCount;
    await new Promise((res, rej) => {
      const done = () => { video.removeEventListener('seeked', done); res(); };
      video.addEventListener('seeked', done);
      video.currentTime = t;
      setTimeout(() => { video.removeEventListener('seeked', done); rej(new Error('seek timeout')); }, 15000);
    });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const col = i % cols, row = Math.floor(i / cols);
    sctx.drawImage(video, col * cellW, row * cellH, cellW, cellH);
    sctx.fillStyle = 'rgba(0,0,0,.65)';
    sctx.fillRect(col * cellW + 6, row * cellH + 6, 92, 26);
    sctx.fillStyle = '#fff';
    sctx.font = '15px monospace';
    sctx.fillText(t.toFixed(1) + 's', col * cellW + 14, row * cellH + 24);
  }
  return sheet.toDataURL('image/png');
};
</script>
</body></html>`;

function startServer(root, page, videoBytes, videoName) {
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
      return;
    }
    if (url === `/${videoName}`) {
      // Range support: the video element needs it to seek.
      const range = req.headers.range;
      if (range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range);
        const start = Number(match[1]);
        const end = match[2] ? Number(match[2]) : videoBytes.length - 1;
        res.writeHead(206, {
          'content-type': 'video/mp4',
          'content-range': `bytes ${start}-${end}/${videoBytes.length}`,
          'accept-ranges': 'bytes',
          'content-length': end - start + 1,
        }).end(videoBytes.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': videoBytes.length }).end(videoBytes);
      return;
    }
    res.writeHead(404).end('not found');
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done({ server, port: server.address().port })));
}

async function main() {
  const file = resolve(process.argv[2] ?? join(ROOT, '.artifacts/promo/promo-1080p.mp4'));
  const expectSeconds = Number(process.argv[3] ?? 0) || null;
  const bytes = await readFile(file);
  const videoName = 'check.mp4';
  console.log(`[verify] ${file} (${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB)`);

  const { server, port } = await startServer(ROOT, PAGE, bytes, videoName);
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--mute-audio'],
  });

  const failures = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (error) => console.log(`[page:throw] ${error.message}`));
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
    const SAMPLES = 12;
    const result = await page.evaluate(
      ([url, n]) => window.__verify(url, n),
      [`http://127.0.0.1:${port}/${videoName}`, SAMPLES],
    );

    const { meta, hashes, brightness, audio } = result;
    console.log(`[verify] duration=${meta.duration.toFixed(3)}s  ${meta.width}x${meta.height}  peakReadyState=${meta.peakReadyState}`);
    console.log(`[verify] audio: present=${audio.present} rms=${audio.rms.toFixed(4)} channels=${audio.channels} rate=${audio.sampleRate} samples=${audio.samples}${audio.error ? ` error=${audio.error}` : ''}`);
    console.log(`[verify] sampled brightness: ${brightness.map((b) => b.toFixed(1)).join(' ')}`);

    // --- assertions ---
    if (meta.width !== 1920 || meta.height !== 1080) failures.push(`expected 1920x1080, got ${meta.width}x${meta.height}`);
    if (expectSeconds && Math.abs(meta.duration - expectSeconds) > 0.5) {
      failures.push(`expected ~${expectSeconds}s, got ${meta.duration.toFixed(3)}s`);
    }
    if (meta.peakReadyState < 2) failures.push(`peakReadyState ${meta.peakReadyState} < 2 (never became decodable)`);
    const unique = new Set(hashes).size;
    if (unique < Math.ceil(SAMPLES * 0.6)) failures.push(`only ${unique}/${SAMPLES} distinct frames - animation appears frozen`);
    const meanBrightness = brightness.reduce((a, b) => a + b, 0) / brightness.length;
    if (meanBrightness < 3) failures.push(`mean brightness ${meanBrightness.toFixed(2)} - frames look black`);
    if (!audio.present) failures.push(`no decodable audio track (${audio.error})`);
    else if (audio.rms < 0.002) failures.push(`audio RMS ${audio.rms.toFixed(5)} - track is effectively silent`);
    if (audio.samples < meta.duration * 44100 * 0.8) failures.push('audio track is much shorter than the video');

    // --- contact sheet: 4x3 grid at the sampled timestamps ---
    const sheet = await page.evaluate(
      ([url, n, cols, rows]) => window.__contactSheet(url, n, cols, rows),
      [`http://127.0.0.1:${port}/${videoName}`, SAMPLES, 4, 3],
    );
    const sheetPath = file.replace(/\.mp4$/, '-contact-sheet.png');
    await mkdir(dirname(sheetPath), { recursive: true });
    await writeFile(sheetPath, Buffer.from(sheet.split(',')[1], 'base64'));
    console.log(`[verify] contact sheet: ${sheetPath}`);

    const seconds = meta.duration;
    console.log(`[verify] average bitrate: ${((bytes.byteLength * 8) / seconds / 1e6).toFixed(2)} Mbps`);

    if (failures.length) {
      console.log('\n[verify] FAILED:');
      for (const f of failures) console.log(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log('\n[verify] OK - all checks passed');
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(`[verify] FAILED: ${error.message}`);
  process.exitCode = 1;
});
