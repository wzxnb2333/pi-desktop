/*
 * Promo renderer entry: composes one frame at a time and encodes it.
 *
 * The picture is a pure function of `time`, so frame N is byte-identical on
 * every run and the encoder can be handed exact timestamps. That is what
 * "smooth" means here: no real-time capture, no dropped frames, no jitter.
 *
 * Per frame:
 *   1. draw the app into a 1440x940 offscreen canvas at native resolution
 *   2. knock out its rounded corners
 *   3. project that bitmap onto a camera quad in the 1920x1080 frame
 *   4. add stage, glow, sweep, captions, end card
 *
 * Encoding is WebCodecs (H.264 + AAC) into mp4-muxer. No ffmpeg anywhere.
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { FRAME, WINDOW, poseAt, projectQuad, quadBounds, drawQuad, ease } from './camera.js';
import { drawApp } from './ui.js';
import { LIGHT, DARK } from './theme.js';
import {
  drawStage, drawWindowGlow, drawVignette, drawLightSweep, drawLogo, drawEndCard, drawCaption, drawFrame,
  sweepCenter, SWEEP_SLANT,
} from './atmosphere.js';
import { SHOTS, stateAt, themeWipeAt, sweepAt, CUES, DURATION } from './timeline.js';
import { COPY } from './copy.js';
import { synthesize } from './audio.js';

const FPS = 60;
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
/** Corner radius of the app window, matching the shell's own rounding. */
const WINDOW_RADIUS = 12;

const params = new URLSearchParams(location.search);
const seconds = Number(params.get('seconds')) || DURATION;

// Scratch canvases, allocated once: the app surface and the rounded copy.
const appCanvas = document.createElement('canvas');
appCanvas.width = WINDOW.width;
appCanvas.height = WINDOW.height;
const appCtx = appCanvas.getContext('2d', { alpha: false });

// The dark theme, drawn only during the wipe and masked onto the light one.
const darkCanvas = document.createElement('canvas');
darkCanvas.width = WINDOW.width;
darkCanvas.height = WINDOW.height;
const darkCtx = darkCanvas.getContext('2d');

/** Soft edge of the theme wipe, in window pixels. */
const WIPE_SOFTNESS = 90;

/**
 * Light theme with the dark theme revealed behind the sweep's centre line.
 * The edge has the sweep's slant, and the sweep is drawn over a near-frontal
 * window, so in window space the wipe and the highlight stay locked together.
 */
function drawThemeWipe(state, progress) {
  drawApp(appCtx, LIGHT, state);
  drawApp(darkCtx, DARK, state);
  const cx = sweepCenter(0, WINDOW.width, progress);
  // Unit normal of the slanted edge, pointing toward the not-yet-revealed side.
  const len = Math.hypot(1, SWEEP_SLANT);
  const nx = 1 / len;
  const ny = SWEEP_SLANT / len;
  const mask = darkCtx.createLinearGradient(
    cx - nx * WIPE_SOFTNESS, -ny * WIPE_SOFTNESS, cx + nx * WIPE_SOFTNESS, ny * WIPE_SOFTNESS,
  );
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  darkCtx.save();
  darkCtx.globalCompositeOperation = 'destination-in';
  darkCtx.fillStyle = mask;
  darkCtx.fillRect(0, 0, WINDOW.width, WINDOW.height);
  darkCtx.restore();
  appCtx.drawImage(darkCanvas, 0, 0);
}

const roundedCanvas = document.createElement('canvas');
roundedCanvas.width = WINDOW.width;
roundedCanvas.height = WINDOW.height;
const roundedCtx = roundedCanvas.getContext('2d');

/** The dark-ground opening: draw the π mark, fade it out as the window arrives. */
function logoAlphaAt(time) {
  if (time < 4.2) return 1;
  return Math.max(0, 1 - (time - 4.2) / 1.2);
}

/** Shorter than the shortest montage shot (~3s), so a caption never spills into the next one. */
const CAPTION_SECONDS = 2.7;

/** Caption for the current time, with a fade in and out. */
function captionAt(time) {
  for (const caption of COPY.captions) {
    const local = time - caption.time;
    if (local < 0 || local > CAPTION_SECONDS) continue;
    const fadeIn = ease('out', Math.min(1, local / 0.35));
    const fadeOut = ease('out', Math.min(1, Math.max(0, (CAPTION_SECONDS - local) / 0.5)));
    return { text: caption.text, alpha: Math.min(fadeIn, fadeOut) };
  }
  return null;
}

function drawFrameAt(ctx, time) {
  const wipe = themeWipeAt(time);
  const state = stateAt(time);
  const pose = poseAt(SHOTS, time);

  // --- 1. the window, at native resolution ---
  if (wipe <= 0) drawApp(appCtx, LIGHT, state);
  else if (wipe >= 1) drawApp(appCtx, DARK, state);
  else drawThemeWipe(state, wipe);

  // --- 2. rounded corners, knocked out of an opaque copy ---
  roundedCtx.clearRect(0, 0, WINDOW.width, WINDOW.height);
  roundedCtx.save();
  roundedCtx.beginPath();
  const r = WINDOW_RADIUS;
  roundedCtx.moveTo(r, 0);
  roundedCtx.arcTo(WINDOW.width, 0, WINDOW.width, WINDOW.height, r);
  roundedCtx.arcTo(WINDOW.width, WINDOW.height, 0, WINDOW.height, r);
  roundedCtx.arcTo(0, WINDOW.height, 0, 0, r);
  roundedCtx.arcTo(0, 0, WINDOW.width, 0, r);
  roundedCtx.closePath();
  roundedCtx.clip();
  roundedCtx.drawImage(appCanvas, 0, 0);
  roundedCtx.restore();

  // --- 3. the stage ---
  drawStage(ctx, time);

  const showWindow = pose.opacity > 0.004;
  if (showWindow) {
    const quad = projectQuad(pose, time);
    const bounds = quadBounds(quad);

    drawWindowGlow(ctx, { ...bounds, scale: bounds.width / WINDOW.width }, pose.glow ?? 0);

    // Drop shadow: the same quad, offset and blurred, under the window.
    const shadowQuad = quad.map((p) => ({ x: p.x + 6, y: p.y + 26 * (bounds.width / WINDOW.width) }));
    ctx.save();
    ctx.globalAlpha = 0.55 * (pose.opacity ?? 1);
    ctx.filter = `blur(${Math.max(6, 26 * (bounds.width / WINDOW.width))}px)`;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath();
    ctx.moveTo(shadowQuad[0].x, shadowQuad[0].y);
    for (let i = 1; i < 4; i += 1) ctx.lineTo(shadowQuad[i].x, shadowQuad[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    drawQuad(ctx, roundedCanvas, quad, pose.opacity ?? 1);

    // A hairline rim so the window edge reads as glass, not a cut-out.
    ctx.save();
    ctx.globalAlpha = 0.5 * (pose.opacity ?? 1);
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(quad[0].x, quad[0].y);
    for (let i = 1; i < 4; i += 1) ctx.lineTo(quad[i].x, quad[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    const sweep = sweepAt(time);
    if (sweep) drawLightSweep(ctx, bounds, sweep.progress, sweep.intensity);
  }

  const caption = captionAt(time);
  if (caption) drawCaption(ctx, caption.text, caption.alpha);

  // --- 4. opening mark and end card ---
  const logoAlpha = logoAlphaAt(time);
  if (logoAlpha > 0.004) {
    drawLogo(ctx, FRAME.width / 2, FRAME.height / 2, 150, ease('smooth', time / 3.2), '#EFEFE7', '#262827', logoAlpha);
  }

  if (time > 53.4) {
    const p = ease('smooth', (time - 53.4) / 2.0);
    drawEndCard(ctx, time, {
      logoProgress: 1,
      logoAlpha: p,
      textAlpha: ease('smooth', Math.max(0, (time - 55.0) / 1.6)),
      glow: p,
    });
  }

  drawVignette(ctx, 1);
  drawFrame(ctx);
}

// ---------------------------------------------------------------- encode

async function pickVideoConfig() {
  const candidates = [
    { codec: 'avc1.64002a', width: FRAME.width, height: FRAME.height, bitrate: 14_000_000, framerate: FPS, avc: { format: 'avc' } },
    { codec: 'avc1.640028', width: FRAME.width, height: FRAME.height, bitrate: 12_000_000, framerate: FPS, avc: { format: 'avc' } },
  ];
  for (const candidate of candidates) {
    const { supported, config } = await VideoEncoder.isConfigSupported(candidate);
    if (supported) return config ?? candidate;
  }
  throw new Error('no supported H.264 config');
}

async function run() {
  const log = [];
  const started = performance.now();

  const videoConfig = await pickVideoConfig();
  log.push(`video: ${videoConfig.codec} @ ${(videoConfig.bitrate / 1e6).toFixed(1)} Mbps`);

  const audioConfig = { codec: 'mp4a.40.2', sampleRate: SAMPLE_RATE, numberOfChannels: CHANNELS, bitrate: 192_000 };
  if (!(await AudioEncoder.isConfigSupported(audioConfig)).supported) throw new Error('AAC unsupported');

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: FRAME.width, height: FRAME.height, frameRate: FPS },
    audio: { codec: 'aac', numberOfChannels: CHANNELS, sampleRate: SAMPLE_RATE },
    fastStart: 'in-memory',
  });

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => { throw error; },
  });
  videoEncoder.configure(videoConfig);

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (error) => { throw error; },
  });
  audioEncoder.configure(audioConfig);

  // --- video ---
  const canvas = document.createElement('canvas');
  canvas.width = FRAME.width;
  canvas.height = FRAME.height;
  const ctx = canvas.getContext('2d', { alpha: false });

  const totalFrames = Math.round(seconds * FPS);
  const frameDuration = 1_000_000 / FPS;
  const videoStarted = performance.now();

  for (let i = 0; i < totalFrames; i += 1) {
    drawFrameAt(ctx, i / FPS);
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(i * frameDuration),
      duration: Math.round(frameDuration),
    });
    // A keyframe every two seconds keeps the file seekable without bloating it.
    videoEncoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
    frame.close();

    // Backpressure: software H.264 will outrun the frame loop otherwise, and the
    // encoder queue grows without bound.
    if (videoEncoder.encodeQueueSize > 10) {
      await new Promise((resolve) => {
        const check = () => (videoEncoder.encodeQueueSize <= 5 ? resolve() : setTimeout(check, 3));
        check();
      });
    }
  }
  log.push(`video frames: ${totalFrames} in ${((performance.now() - videoStarted) / 1000).toFixed(1)}s`);
  await videoEncoder.flush();
  videoEncoder.close();

  // --- audio ---
  // The score is always rendered at the full duration, so a partial video render
  // still lines up with the full soundtrack.
  const audioStarted = performance.now();
  const pcm = await synthesize({ duration: seconds, sampleRate: SAMPLE_RATE, channels: CHANNELS, cues: CUES });
  const totalAudioFrames = pcm.length / CHANNELS;
  const CHUNK = 1024;
  for (let offset = 0; offset < totalAudioFrames; offset += CHUNK) {
    const count = Math.min(CHUNK, totalAudioFrames - offset);
    const data = new AudioData({
      format: 'f32',
      sampleRate: SAMPLE_RATE,
      numberOfFrames: count,
      numberOfChannels: CHANNELS,
      timestamp: Math.round((offset / SAMPLE_RATE) * 1_000_000),
      data: pcm.subarray(offset * CHANNELS, (offset + count) * CHANNELS),
    });
    audioEncoder.encode(data);
    data.close();
    if (audioEncoder.encodeQueueSize > 24) {
      await new Promise((resolve) => {
        const check = () => (audioEncoder.encodeQueueSize <= 12 ? resolve() : setTimeout(check, 3));
        check();
      });
    }
  }
  await audioEncoder.flush();
  audioEncoder.close();
  log.push(`audio frames: ${totalAudioFrames} in ${((performance.now() - audioStarted) / 1000).toFixed(1)}s`);

  muxer.finalize();
  const bytes = new Uint8Array(muxer.target.buffer);
  log.push(`mp4: ${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB`);
  await fetch('/save?name=video', { method: 'POST', body: bytes });
  log.push(`total: ${((performance.now() - started) / 1000).toFixed(1)}s`);
  return log;
}

/**
 * Draw stills and post them as PNGs. Checking one frame beats rendering a whole
 * minute to discover a shot is framed wrong.
 */
async function still(times) {
  const canvas = document.createElement('canvas');
  canvas.width = FRAME.width;
  canvas.height = FRAME.height;
  const ctx = canvas.getContext('2d', { alpha: false });

  const log = [];
  for (const time of times) {
    drawFrameAt(ctx, time);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await fetch(`/save?name=${encodeURIComponent(`still-${time.toFixed(1)}s`)}`, { method: 'POST', body: bytes });
    log.push(`still ${time}s -> ${(bytes.byteLength / 1024).toFixed(0)} KB`);
  }
  return log;
}

window.__smoke = () => (params.has('still') ? still(params.get('still').split(',').map(Number)) : run());
window.__smokeReady = true;
