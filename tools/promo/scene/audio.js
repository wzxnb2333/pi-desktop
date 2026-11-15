/*
 * The score and the sound effects, synthesized from scratch.
 *
 * No samples and no library: everything is oscillators, filtered noise and
 * envelopes rendered offline, so the result is bit-identical on every run and
 * needs no asset files.
 *
 * Cue timings come from timeline.js, so the audio and the picture cannot drift.
 */

const NOTE = { C2: 65.41, G2: 98.0, A2: 110.0, C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, C4: 261.63, D4: 293.66, E4: 329.63, G4: 392.0, A4: 440.0, C5: 523.25, E5: 659.25, G5: 783.99 };

/** Deterministic noise: a seeded LCG, so every render has identical texture. */
function makeNoise(ctx, seconds, seed = 1) {
  const length = Math.ceil(seconds * ctx.sampleRate);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let s = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    data[i] = (s / 0xffffffff) * 2 - 1;
  }
  return buffer;
}

/** A tone with an exponential decay, the workhorse for blips and impacts. */
function tone(ctx, dest, { freq, at, duration, gain, type = 'sine', attack = 0.005, detune = 0, pan = 0 }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  osc.detune.value = detune;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  osc.connect(env).connect(panner).connect(dest);
  osc.start(at);
  osc.stop(at + duration + 0.05);
}

/** Filtered noise burst: whooshes, typing, sweeps. */
function noiseBurst(ctx, dest, noiseBuffer, { at, duration, gain, from, to, q = 1.2, type = 'bandpass', attack = 0.02, pan = 0 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  src.playbackRate.value = 1;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, at);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + duration);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  src.connect(filter).connect(env).connect(panner).connect(dest);
  src.start(at);
  src.stop(at + duration + 0.05);
}

/**
 * Sustained pad: three detuned oscillators under a slowly modulated lowpass.
 * This is the bed the whole video sits on.
 */
function pad(ctx, dest, { at, duration, gain, root, chord, cutoffFrom, cutoffTo }) {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(cutoffFrom, at);
  filter.frequency.linearRampToValueAtTime(cutoffTo, at + duration * 0.55);
  filter.frequency.linearRampToValueAtTime(cutoffFrom * 0.9, at + duration);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.linearRampToValueAtTime(gain, at + Math.min(2.2, duration * 0.3));
  env.gain.setValueAtTime(gain, at + duration * 0.7);
  env.gain.linearRampToValueAtTime(0.0001, at + duration);

  filter.connect(env).connect(dest);

  // Root plus chord tones, each doubled with a slight detune for width.
  const freqs = [root, ...chord];
  for (const freq of freqs) {
    for (const detune of [-6, 6]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const voice = ctx.createGain();
      voice.gain.value = 0.5 / freqs.length;
      osc.connect(voice).connect(filter);
      osc.start(at);
      osc.stop(at + duration + 0.1);
    }
  }
  return { filter, env };
}

/**
 * Render the full soundtrack and return interleaved Float32 PCM.
 *
 * The chord progression tracks the edit: Cmaj (intro) - Am (workflow) -
 * Fmaj (montage) - Cmaj (theme reveal) - Fmaj-A (finale).
 */
export async function synthesize({ duration, sampleRate, channels, cues }) {
  const ctx = new OfflineAudioContext(channels, Math.ceil(duration * sampleRate), sampleRate);
  const master = ctx.createGain();
  master.gain.value = 0.62;
  // Gentle bus compression keeps the montage from clipping.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 22;
  comp.ratio.value = 3;
  comp.attack.value = 0.006;
  comp.release.value = 0.22;
  master.connect(comp).connect(ctx.destination);

  const noise = makeNoise(ctx, 4, 12345);

  // --- pad bed: one long chord per section ---
  const sections = [
    { at: 0.2, duration: 12, root: NOTE.C2 * 2, chord: [NOTE.G3, NOTE.C4, NOTE.E4], cutoffFrom: 340, cutoffTo: 900, gain: 0.17 },
    { at: 12, duration: 16, root: NOTE.A2, chord: [NOTE.E3, NOTE.A3, NOTE.C4], cutoffFrom: 380, cutoffTo: 1100, gain: 0.18 },
    { at: 28, duration: 14, root: NOTE.F3 / 2, chord: [NOTE.C4, NOTE.F3, NOTE.A3], cutoffFrom: 420, cutoffTo: 1300, gain: 0.19 },
    { at: 42, duration: 11, root: NOTE.C3, chord: [NOTE.G3, NOTE.C4, NOTE.E4], cutoffFrom: 400, cutoffTo: 1500, gain: 0.2 },
    { at: 52.5, duration: 8, root: NOTE.F3 / 2, chord: [NOTE.A3, NOTE.C4, NOTE.E4], cutoffFrom: 460, cutoffTo: 1700, gain: 0.22 },
  ];
  for (const section of sections) pad(ctx, master, section);

  // --- a slow heartbeat under the pad, one pulse every 2s ---
  for (let t = 1; t < duration - 1; t += 2) {
    tone(ctx, master, { freq: NOTE.C2, at: t, duration: 0.9, gain: 0.09, type: 'sine', attack: 0.02 });
  }

  // --- cues ---
  for (const cue of cues) {
    switch (cue.kind) {
      case 'pad-in':
        break; // the pad sections already handle this

      case 'draw': // a soft pencil-on-glass tick for each logo stroke
        noiseBurst(ctx, master, noise, { at: cue.time, duration: 0.36, gain: 0.09, from: 1800, to: 5200, q: 2.4, attack: 0.006 });
        tone(ctx, master, { freq: NOTE.E5, at: cue.time, duration: 0.3, gain: 0.04, type: 'sine' });
        break;

      case 'riser': // tension into the first reveal
        noiseBurst(ctx, master, noise, { at: cue.time, duration: cue.duration ?? 1.2, gain: 0.14, from: 260, to: 7000, q: 1.1, attack: 0.5 });
        break;

      case 'whoosh': // shot change
        noiseBurst(ctx, master, noise, { at: cue.time - 0.12, duration: 0.5, gain: 0.16 * (cue.intensity ?? 1), from: 7000, to: 280, q: 1.0, attack: 0.01 });
        noiseBurst(ctx, master, noise, { at: cue.time - 0.1, duration: 0.34, gain: 0.1 * (cue.intensity ?? 1), from: 300, to: 4200, q: 1.6, attack: 0.12 });
        break;

      case 'land': // the window arriving: a soft low thud plus a bright tail
        tone(ctx, master, { freq: 92, at: cue.time, duration: 0.5, gain: 0.3, type: 'sine', attack: 0.004 });
        tone(ctx, master, { freq: 138, at: cue.time + 0.01, duration: 0.34, gain: 0.12, type: 'sine' });
        noiseBurst(ctx, master, noise, { at: cue.time, duration: 0.22, gain: 0.07, from: 4200, to: 900, q: 0.8, attack: 0.002 });
        break;

      case 'typing': {
        // Irregular keystroke texture, deterministic spacing.
        const steps = Math.max(4, Math.round((cue.duration ?? 2) * 7));
        for (let i = 0; i < steps; i += 1) {
          const at = cue.time + ((cue.duration ?? 2) * i) / steps + ((i * 37) % 11) / 200;
          noiseBurst(ctx, master, noise, { at, duration: 0.045, gain: 0.05, from: 2600, to: 6200, q: 1.5, attack: 0.002, pan: ((i % 3) - 1) * 0.25 });
        }
        break;
      }

      case 'send': // message dispatched: a short upward blip
        tone(ctx, master, { freq: NOTE.E5, at: cue.time, duration: 0.18, gain: 0.14, type: 'triangle', attack: 0.003 });
        tone(ctx, master, { freq: NOTE.A4, at: cue.time + 0.05, duration: 0.22, gain: 0.1, type: 'sine' });
        break;

      case 'click': // a control being pressed
        tone(ctx, master, { freq: 1180, at: cue.time, duration: 0.055, gain: 0.09, type: 'square', attack: 0.001 });
        noiseBurst(ctx, master, noise, { at: cue.time, duration: 0.03, gain: 0.05, from: 5000, to: 2200, q: 1.0, attack: 0.001 });
        break;

      case 'expand': // a panel opening
        noiseBurst(ctx, master, noise, { at: cue.time, duration: 0.28, gain: 0.08, from: 900, to: 3400, q: 1.4, attack: 0.03 });
        tone(ctx, master, { freq: NOTE.D4, at: cue.time, duration: 0.2, gain: 0.06, type: 'sine' });
        break;

      case 'terminal': // shell output ticking in
        for (let i = 0; i < 9; i += 1) {
          noiseBurst(ctx, master, noise, { at: cue.time + i * 0.16, duration: 0.03, gain: 0.045, from: 3400, to: 5200, q: 2, attack: 0.001, pan: -0.3 });
        }
        break;

      case 'success': // three-note arpeggio on a completed action
        [NOTE.C4, NOTE.E4, NOTE.G4].forEach((freq, index) => {
          tone(ctx, master, { freq, at: cue.time + index * 0.07, duration: 0.6 - index * 0.1, gain: 0.11, type: 'sine', attack: 0.012 });
        });
        break;

      case 'sweep': // the light/dark reveal
        noiseBurst(ctx, master, noise, { at: cue.time, duration: cue.duration ?? 3, gain: 0.1, from: 400, to: 5200, q: 0.9, attack: 1.0 });
        tone(ctx, master, { freq: NOTE.G4, at: cue.time + 1.4, duration: 1.6, gain: 0.06, type: 'sine', attack: 0.6 });
        break;

      case 'finale': // rising triad plus a low settle
        [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5].forEach((freq, index) => {
          tone(ctx, master, { freq, at: cue.time + index * 0.11, duration: 2.4 - index * 0.25, gain: 0.1, type: 'sine', attack: 0.05 });
        });
        tone(ctx, master, { freq: 52, at: cue.time + 0.5, duration: 2.2, gain: 0.26, type: 'sine', attack: 0.06 });
        break;

      default:
        break;
    }
  }

  const rendered = await ctx.startRendering();
  const left = rendered.getChannelData(0);
  const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;

  // Interleave, with a gentle limiter so nothing clips the AAC encoder.
  const out = new Float32Array(left.length * channels);
  for (let i = 0; i < left.length; i += 1) {
    const l = Math.tanh(left[i] * 0.9);
    const r = Math.tanh(right[i] * 0.9);
    if (channels === 1) out[i] = (l + r) / 2;
    else {
      out[i * 2] = l;
      out[i * 2 + 1] = r;
    }
  }
  return out;
}
