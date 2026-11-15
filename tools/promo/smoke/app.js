/*
 * Stage 0 smoke test: prove the whole encode chain works before any art exists.
 *
 * Writes a 3s 1920x1080 60fps animation with a 440Hz sine tone through
 * VideoEncoder/AudioEncoder into mp4-muxer, then hands the bytes back to Node.
 *
 * Nothing here is reusable art; it exists to answer one question: can a headless
 * Chrome produce a real H.264 + AAC MP4 without ffmpeg?
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

const FPS = 60;
const WIDTH = 1920;
const HEIGHT = 1080;
const SAMPLE_RATE = 48000;
const CHANNELS = 2;

// Tried in order; the first one the runtime actually accepts wins.
const VIDEO_CANDIDATES = [
  { codec: 'avc1.64002a', width: WIDTH, height: HEIGHT, bitrate: 12_000_000, framerate: FPS, avc: { format: 'avc' } },
  { codec: 'avc1.640028', width: WIDTH, height: HEIGHT, bitrate: 12_000_000, framerate: FPS, avc: { format: 'avc' } },
];

async function pickVideoConfig() {
  const rejected = [];
  for (const config of VIDEO_CANDIDATES) {
    for (const hardwareAcceleration of ['no-preference', 'prefer-software']) {
      const candidate = { ...config, hardwareAcceleration };
      try {
        const { supported, config: resolved } = await VideoEncoder.isConfigSupported(candidate);
        if (supported) return { config: resolved ?? candidate, rejected };
      } catch (error) {
        rejected.push(`${candidate.codec}/${hardwareAcceleration}: ${error.message}`);
      }
    }
  }
  throw new Error(`no usable video config. rejected: ${rejected.join(' | ')}`);
}

function drawFrame(ctx, time) {
  // Four moving blocks plus a sweeping line: enough motion that "is it frozen?"
  // can be answered by comparing pixels between frames.
  const t = time;
  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, '#0a0b0d');
  gradient.addColorStop(1, '#14161a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const hues = ['#2c67c5', '#83c3ff', '#409c77', '#ba2623'];
  hues.forEach((color, index) => {
    const speed = 0.35 + index * 0.12;
    const x = WIDTH * 0.5 + Math.cos(t * speed + index * 1.7) * WIDTH * 0.28;
    const y = HEIGHT * 0.5 + Math.sin(t * speed * 1.3 + index * 0.9) * HEIGHT * 0.24;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(x, y, 90 + index * 18, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  const sweep = ((t / 3) % 1) * WIDTH;
  ctx.fillStyle = '#efefe7';
  ctx.fillRect(sweep, 0, 6, HEIGHT);

  ctx.font = '600 64px "Segoe UI", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`t = ${t.toFixed(2)}s`, 80, 140);
}

function renderAudio(seconds) {
  // 440Hz sine with a fade in/out. A constant tone is enough to prove the audio
  // track survives muxing; the real score comes later.
  const frames = Math.round(seconds * SAMPLE_RATE);
  const buffer = new Float32Array(frames * CHANNELS);
  for (let i = 0; i < frames; i += 1) {
    const t = i / SAMPLE_RATE;
    const fade = Math.min(1, t / 0.1) * Math.min(1, (seconds - t) / 0.2);
    const sample = Math.sin(2 * Math.PI * 440 * t) * 0.28 * fade;
    buffer[i * 2] = sample;
    buffer[i * 2 + 1] = sample;
  }
  return buffer;
}

async function main(seconds) {
  const log = [];
  const { config: videoConfig, rejected } = await pickVideoConfig();
  log.push(`video config: ${videoConfig.codec} hw=${videoConfig.hardwareAcceleration ?? 'default'}`);
  if (rejected.length) log.push(`rejected: ${rejected.join(' | ')}`);

  const audioConfig = { codec: 'mp4a.40.2', sampleRate: SAMPLE_RATE, numberOfChannels: CHANNELS, bitrate: 192_000 };
  const audioSupport = await AudioEncoder.isConfigSupported(audioConfig);
  log.push(`audio config: ${audioConfig.codec} supported=${audioSupport.supported}`);
  if (!audioSupport.supported) throw new Error('AAC not supported');

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: WIDTH, height: HEIGHT, frameRate: FPS },
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
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d', { alpha: false });
  const frameCount = Math.round(seconds * FPS);
  const frameDuration = 1_000_000 / FPS;

  for (let i = 0; i < frameCount; i += 1) {
    const time = i / FPS;
    drawFrame(ctx, time);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameDuration), duration: Math.round(frameDuration) });
    // Keyframe every second so the file is seekable and errors stay local.
    videoEncoder.encode(frame, { keyFrame: i % FPS === 0 });
    frame.close();
    // Backpressure: without this the encoder queue grows unbounded on software encode.
    if (videoEncoder.encodeQueueSize > 8) {
      await new Promise((resolve) => {
        const check = () => (videoEncoder.encodeQueueSize <= 4 ? resolve() : setTimeout(check, 4));
        check();
      });
    }
  }
  log.push(`encoded ${frameCount} video frames`);
  await videoEncoder.flush();
  videoEncoder.close();

  // --- audio ---
  // Exactly as long as the video: any extra audio (the usual padding trick)
  // becomes the MP4's declared duration and desyncs the last second.
  const pcm = renderAudio(seconds);
  const totalFrames = pcm.length / CHANNELS;
  const CHUNK = 1024;
  for (let offset = 0; offset < totalFrames; offset += CHUNK) {
    const count = Math.min(CHUNK, totalFrames - offset);
    const slice = pcm.subarray(offset * CHANNELS, (offset + count) * CHANNELS);
    const data = new AudioData({
      format: 'f32',
      sampleRate: SAMPLE_RATE,
      numberOfFrames: count,
      numberOfChannels: CHANNELS,
      timestamp: Math.round((offset / SAMPLE_RATE) * 1_000_000),
      data: slice,
    });
    audioEncoder.encode(data);
    data.close();
    if (audioEncoder.encodeQueueSize > 16) {
      await new Promise((resolve) => {
        const check = () => (audioEncoder.encodeQueueSize <= 8 ? resolve() : setTimeout(check, 4));
        check();
      });
    }
  }
  log.push(`encoded audio: ${totalFrames} frames`);
  await audioEncoder.flush();
  audioEncoder.close();

  muxer.finalize();
  const bytes = new Uint8Array(muxer.target.buffer);
  log.push(`muxed mp4: ${bytes.byteLength} bytes`);

  await fetch('/save', { method: 'POST', body: bytes });
  return log;
}

const requested = Number(new URLSearchParams(location.search).get('seconds'));
window.__smoke = () => main(Number.isFinite(requested) && requested > 0 ? requested : 3);
window.__smokeReady = true;
