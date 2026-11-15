/*
 * The 60-second edit.
 *
 * One entry per shot. A shot's values are the camera pose AT its `start`; the
 * camera then travels toward the next shot's values over the interval between
 * them. So "hold still, then fly in" is two consecutive shots with the same
 * pose, followed by the destination.
 *
 * `z` is the camera distance in window-pixel units: 1440 parks the window at
 * 84% of the frame height, smaller is closer, larger is farther. Movements are
 * kept under a few degrees of yaw/pitch - enough to feel dimensional, not
 * enough to make the UI look like a tilted screenshot.
 *
 * The sound cue list lives here too, so the score and the picture read the same
 * numbers and cannot drift apart.
 */
import { initialState, CONVERSATION } from './ui.js';
import { ease } from './camera.js';

export const DURATION = 60;
/** Distance that parks the window with margins. */
export const PARK_Z = 1440;

export const SHOTS = [
  // 0-3.8s: the logo draws itself over an empty stage. Two identical poses hold
  // the window invisible; without the second, opacity would ramp from 0s.
  { start: 0, end: 3.8, x: 0, y: 30, z: 3400, rotX: 0, rotY: 0, rotZ: 0, opacity: 0, glow: 0, ease: 'smooth' },
  { start: 3.8, end: 4.6, x: 0, y: 30, z: 3400, rotX: 0, rotY: 0, rotZ: 0, opacity: 0, glow: 0, ease: 'smooth' },
  // 4.6-9.8s: the window, already faded up in the distance, flies in to park.
  { start: 4.6, end: 9.8, x: 0, y: 30, z: 3400, rotX: 0, rotY: 0, rotZ: 0, opacity: 0.85, glow: 0.25, ease: 'smooth' },
  // 9.8-15s: the fly-in. backOut overshoots slightly closer than park, then settles.
  { start: 9.8, end: 15.0, x: 0, y: 0, z: PARK_Z, rotX: -1.1, rotY: 1.8, rotZ: 0, opacity: 1, glow: 0.5, ease: 'backOut' },
  // 15-21s: slow push through the conversation.
  { start: 15.0, end: 21.0, x: -40, y: -5, z: 1520, rotX: -0.6, rotY: 0.9, rotZ: 0, opacity: 1, glow: 0.3, ease: 'smooth' },
  // 21-28s: focus shifts down the transcript.
  { start: 21.0, end: 28.0, x: 50, y: -18, z: 1490, rotX: 0.45, rotY: -1.1, rotZ: 0, opacity: 1, glow: 0.25, ease: 'smooth' },
  // 28-34.2s: capability montage, flatter and quicker.
  { start: 28.0, end: 31.2, x: 70, y: -26, z: 1460, rotX: 0, rotY: -1.6, rotZ: 0, opacity: 1, glow: 0.35, ease: 'out' },
  { start: 31.2, end: 34.2, x: -52, y: -12, z: 1620, rotX: -0.75, rotY: 1.5, rotZ: 0, opacity: 1, glow: 0.3, ease: 'out' },
  { start: 34.2, end: 37.4, x: 30, y: 18, z: 1420, rotX: 0.85, rotY: -0.75, rotZ: -0.35, opacity: 1, glow: 0.4, ease: 'out' },
  { start: 37.4, end: 42.4, x: -16, y: -6, z: 1570, rotX: -0.45, rotY: 0.45, rotZ: 0, opacity: 1, glow: 0.3, ease: 'smooth' },
  // 42.4-52.4s: settings, then the light/dark reveal at the same framing so the
  // theme change is the only thing moving.
  { start: 42.4, end: 47.4, x: 0, y: 6, z: 1500, rotX: -0.25, rotY: 1.1, rotZ: 0, opacity: 1, glow: 0.5, ease: 'smooth' },
  { start: 47.4, end: 51.6, x: 0, y: 0, z: 1390, rotX: 0, rotY: 0, rotZ: 0, opacity: 1, glow: 0.6, ease: 'smooth' },
  // 51.6-55.4s: pull back and dissolve while the end card fades up over it
  // (from 53.4s), so the frame is never empty between the two.
  { start: 51.6, end: 55.4, x: 0, y: 6, z: 1520, rotX: 0, rotY: 0, rotZ: 0, opacity: 1, glow: 0.7, ease: 'smooth' },
  { start: 55.4, end: 60.5, x: 0, y: 18, z: 2400, rotX: 0, rotY: 0, rotZ: 0, opacity: 0, glow: 0.9, ease: 'smooth' },
];

/**
 * Scenes mutate one state object; every `apply` sets absolute values derived
 * from `t`, never deltas, so seeking to any time gives the same picture.
 */
const SCENES = [
  {
    // Idle home screen while the camera is still far away.
    start: 9.6,
    apply(state) {
      state.view = 'home';
      state.sidebarOpen = true;
      state.reviewOpen = true;
      state.typed = '';
      state.caretOn = true;
    },
  },
  {
    // Type the prompt, then "send" it as the camera lands.
    start: 11.4,
    apply(state, t) {
      state.view = 'home';
      const full = CONVERSATION.userTurns[0];
      const p = ease('smooth', (t - 11.4) / 2.4);
      state.typed = full.slice(0, Math.round(full.length * p));
      state.caretOn = Math.floor(t * 2.2) % 2 === 0;
      // The send button lights up for the last beat before the cut.
      state.sending = t > 13.9;
    },
  },
  {
    // The conversation, revealed top to bottom.
    start: 14.6,
    apply(state, t) {
      state.view = 'workbench';
      state.typed = '';
      state.sending = false;
      const p = ease('smooth', (t - 14.6) / 11);
      state.revealUser = 0.1 + p * 0.9;
      state.thinkingShown = t > 16.6;
      state.toolOpen = ease('smooth', (t - 18.2) / 1.6);
      // Stream the closing answer rather than popping it in.
      const answer = CONVERSATION.assistantTurns[1];
      const streamStart = 24.6;
      state.streamText = t > streamStart
        ? answer.slice(0, Math.round(answer.length * ease('out', (t - streamStart) / 2.6)))
        : '';
    },
  },
  {
    // Open the real diff in the review pane.
    start: 28.1,
    apply(state, t) {
      state.view = 'workbench';
      state.revealUser = 1;
      state.streamText = '';
      state.toolOpen = 0;
      state.reviewTab = 'changes';
      state.reviewOpen = true;
      state.diffOpen = ease('smooth', (t - 28.7) / 1.8);
    },
  },
  {
    // The plan tab.
    start: 31.3,
    apply(state, t) {
      state.reviewTab = 'plan';
      state.diffOpen = 0;
      state.planProgress = ease('smooth', (t - 32.2) / 1.5);
    },
  },
  {
    // Integrated terminal.
    start: 34.3,
    apply(state, t) {
      state.view = 'terminal';
      state.reviewTab = 'changes';
      state.planProgress = 1;
      state.terminalLines = Math.min(7, 1 + Math.floor(ease('out', (t - 34.5) / 1.6) * 7));
    },
  },
  {
    // Command palette.
    start: 37.5,
    apply(state, t) {
      state.view = 'palette';
      state.terminalLines = 7;
      const full = '设置';
      state.paletteQuery = full.slice(0, Math.round(full.length * ease('smooth', (t - 38.1) / 1.4)));
    },
  },
  {
    // Settings, held through the light/dark crossfade.
    start: 42.5,
    apply(state) {
      state.view = 'settings';
      state.paletteQuery = '';
      state.reviewOpen = true;
      state.sidebarOpen = true;
    },
  },
  {
    // Back to the workbench for the closing beat under the end card.
    start: 50.4,
    apply(state) {
      state.view = 'workbench';
      state.revealUser = 1;
      state.streamText = '';
      state.reviewOpen = true;
      state.reviewTab = 'changes';
      state.diffOpen = 0;
      state.planProgress = 1;
    },
  },
];

/**
 * Light -> dark reveal. Not a crossfade: blending every token 50/50 turns the
 * whole UI mid-grey. Instead the dark theme is wiped in behind the light sweep,
 * so each pixel is either fully light or fully dark apart from a soft edge.
 */
export const THEME_SWEEP = { start: 45.4, end: 47.6 };

/** 0 = all light, 1 = all dark; in between, the sweep progress the wipe rides. */
export function themeWipeAt(time) {
  return ease('smooth', (time - THEME_SWEEP.start) / (THEME_SWEEP.end - THEME_SWEEP.start));
}

export function stateAt(time) {
  const state = initialState();
  for (const scene of SCENES) if (time >= scene.start) scene.apply(state, time);
  return state;
}

/**
 * Light sweeps, placed where the camera settles so the highlight lands on a
 * still frame rather than during a move.
 */
export const SWEEPS = [
  { start: 12.4, end: 14.8, intensity: 0.9 },
  { start: 25.4, end: 27.6, intensity: 0.7 },
  { ...THEME_SWEEP, intensity: 1.0 },
  { start: 54.6, end: 56.6, intensity: 0.8 },
];

export function sweepAt(time) {
  for (const sweep of SWEEPS) {
    if (time >= sweep.start && time <= sweep.end) {
      return {
        progress: ease('smooth', (time - sweep.start) / (sweep.end - sweep.start)),
        intensity: sweep.intensity,
      };
    }
  }
  return null;
}

/**
 * Sound cues. The audio renderer walks this list, so no cue time is ever
 * written down twice.
 */
export const CUES = [
  { time: 0.4, kind: 'pad-in' },
  { time: 1.1, kind: 'draw' }, // π stroke one
  { time: 1.8, kind: 'draw' }, // stroke two
  { time: 2.5, kind: 'draw' }, // stroke three
  { time: 3.8, kind: 'riser', duration: 1.4 },
  { time: 4.6, kind: 'whoosh', intensity: 0.5 },
  { time: 9.8, kind: 'whoosh', intensity: 1.0 },
  { time: 11.4, kind: 'typing', duration: 2.4 },
  { time: 14.0, kind: 'send' },
  { time: 14.6, kind: 'whoosh', intensity: 0.6 },
  { time: 14.75, kind: 'land' },
  { time: 16.6, kind: 'click' },
  { time: 18.2, kind: 'expand' },
  { time: 24.6, kind: 'typing', duration: 2.6 },
  { time: 27.6, kind: 'success' },
  { time: 28.1, kind: 'whoosh', intensity: 0.8 },
  { time: 28.8, kind: 'expand' },
  { time: 31.3, kind: 'whoosh', intensity: 0.6 },
  { time: 32.2, kind: 'click' },
  { time: 33.6, kind: 'success' },
  { time: 34.3, kind: 'whoosh', intensity: 0.7 },
  { time: 34.6, kind: 'terminal', duration: 1.6 },
  { time: 37.5, kind: 'whoosh', intensity: 0.6 },
  { time: 38.1, kind: 'typing', duration: 1.4 },
  { time: 40.0, kind: 'click' },
  { time: 42.5, kind: 'whoosh', intensity: 0.7 },
  { time: THEME_SWEEP.start, kind: 'sweep', duration: THEME_SWEEP.end - THEME_SWEEP.start },
  { time: THEME_SWEEP.end, kind: 'land' },
  { time: 51.6, kind: 'whoosh', intensity: 0.9 },
  { time: 55.0, kind: 'success' },
  { time: 57.0, kind: 'finale' },
];
