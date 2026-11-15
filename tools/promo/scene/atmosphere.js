/*
 * Everything that is not the app window: the stage it sits on, the light that
 * sweeps across it, the logo animation, captions, and the end card.
 *
 * The stage is a dark studio. A light app screenshot on a dark ground is what
 * makes the interface read as a lit object rather than a flat image, and it
 * gives the accent blue something to glow against.
 */
import { FRAME, ease } from './camera.js';
import { TYPE } from './theme.js';
import { COPY } from './copy.js';

const ACCENT_LIGHT = 'rgb(44,103,197)';
const ACCENT_DARK = 'rgb(131,195,255)';

/** Static-to-slow-moving background. Deterministic: all noise is time-driven. */
export function drawStage(ctx, time) {
  // Base wash.
  const gradient = ctx.createRadialGradient(FRAME.width * 0.5, FRAME.height * 0.42, 80, FRAME.width * 0.5, FRAME.height * 0.5, FRAME.width * 0.78);
  gradient.addColorStop(0, '#14161a');
  gradient.addColorStop(1, '#0a0b0d');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, FRAME.width, FRAME.height);

  // A very faint grid, giving the empty space some texture.
  ctx.strokeStyle = 'rgba(255,255,255,.028)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < FRAME.width; x += 64) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, FRAME.height);
  }
  for (let y = 0; y < FRAME.height; y += 64) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(FRAME.width, y + 0.5);
  }
  ctx.stroke();

  // Slow drifting dust. Position is a pure function of time and index, so the
  // same frame renders identically on every run.
  for (let i = 0; i < 46; i += 1) {
    const seed = i * 127.1;
    const speed = 8 + (i % 7) * 3;
    const x = ((seed * 7.3) % FRAME.width + Math.sin(time * 0.12 + i) * 40 + FRAME.width) % FRAME.width;
    const y = FRAME.height - (((time * speed + seed * 3.7) % (FRAME.height + 120)) - 60);
    const r = 0.7 + (i % 5) * 0.42;
    const alpha = 0.05 + 0.07 * (0.5 + 0.5 * Math.sin(time * 0.7 + i * 1.7));
    ctx.fillStyle = `rgba(200,215,235,${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A soft glow behind the window, tied to the camera pose. */
export function drawWindowGlow(ctx, rect, amount) {
  if (amount <= 0.01) return;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const g = ctx.createRadialGradient(cx, cy, rect.width * 0.1, cx, cy, rect.width * 0.75);
  g.addColorStop(0, `rgba(44,103,197,${(0.16 * amount).toFixed(3)})`);
  g.addColorStop(0.55, `rgba(44,103,197,${(0.05 * amount).toFixed(3)})`);
  g.addColorStop(1, 'rgba(44,103,197,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, FRAME.width, FRAME.height);
}

/** Vignette, drawn last so it also darkens the window's edges. */
export function drawVignette(ctx, strength = 1) {
  const g = ctx.createRadialGradient(FRAME.width / 2, FRAME.height / 2, FRAME.height * 0.32, FRAME.width / 2, FRAME.height / 2, FRAME.width * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${0.55 * strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, FRAME.width, FRAME.height);
}

/**
 * A light sweep across the window surface. Reads as a specular highlight
 * travelling over glass, and is the main "premium" cue in the middle of the
 * video.
 */
/** Band width as a fraction of the swept width, and its slant per unit height. */
const SWEEP_BAND = 0.42;
export const SWEEP_SLANT = 0.35;

/** X of the sweep band's centre along its top edge, so a wipe can ride it. */
export function sweepCenter(left, width, progress) {
  const bandWidth = width * SWEEP_BAND;
  return left - bandWidth / 2 + (width + bandWidth * 2) * progress;
}

export function drawLightSweep(ctx, rect, progress, intensity = 1) {
  if (progress <= 0 || progress >= 1 || intensity <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.left, rect.top, rect.width, rect.height);
  ctx.clip();

  // A skewed bright band crossing left to right, with a soft leading edge.
  const bandWidth = rect.width * SWEEP_BAND;
  const x = sweepCenter(rect.left, rect.width, progress) - bandWidth / 2;
  const g = ctx.createLinearGradient(x, rect.top, x + bandWidth, rect.top + rect.height * 0.3);
  const peak = 0.2 * intensity;
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.42, `rgba(255,255,255,${(peak * 0.45).toFixed(3)})`);
  g.addColorStop(0.5, `rgba(255,255,255,${peak.toFixed(3)})`);
  g.addColorStop(0.58, `rgba(255,255,255,${(peak * 0.45).toFixed(3)})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');

  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x, rect.top - 20);
  ctx.lineTo(x + bandWidth, rect.top - 20);
  ctx.lineTo(x + bandWidth - rect.height * SWEEP_SLANT, rect.top + rect.height + 20);
  ctx.lineTo(x - rect.height * SWEEP_SLANT, rect.top + rect.height + 20);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * The π mark from apps/desktop/scripts/generate-icon.ps1, traced as the same
 * three round-capped Beziers on a 256x256 field, then drawn stroke by stroke.
 *
 * `progress` runs 0..1 over the whole mark; each stroke gets an equal third, so
 * the mark draws itself rather than fading in.
 */
export function drawLogo(ctx, cx, cy, size, progress, color = '#EFEFE7', bg = '#262827', opacity = 1) {
  const scale = size / 256;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-128, -128);

  // Rounded square plate, matching the icon's own background.
  if (bg) {
    const r = 56;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(256, 0, 256, 256, r);
    ctx.arcTo(256, 256, 0, 256, r);
    ctx.arcTo(0, 256, 0, 0, r);
    ctx.arcTo(0, 0, 256, 0, r);
    ctx.closePath();
    ctx.fill();
  }

  const strokes = [
    [53, 87, 85, 69, 156, 87, 199, 78],
    [94, 83, 94, 123, 93, 160, 73, 183],
    [158, 85, 153, 132, 147, 195, 184, 180],
  ];

  ctx.strokeStyle = color;
  ctx.lineWidth = 18;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  strokes.forEach((s, index) => {
    // Each stroke draws over its own third of the timeline.
    const from = index / strokes.length;
    const to = (index + 1) / strokes.length;
    const local = Math.max(0, Math.min(1, (progress - from) / (to - from)));
    if (local <= 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(s[0], s[1]);
    ctx.bezierCurveTo(s[2], s[3], s[4], s[5], s[6], s[7]);
    // Approximate the path length, then reveal that fraction of it.
    const length = approximateLength(s);
    ctx.setLineDash([length, length]);
    ctx.lineDashOffset = length * (1 - local);
    ctx.stroke();
    ctx.restore();
  });

  ctx.restore();
}

/** Sample a cubic Bezier to estimate its arc length. */
function approximateLength(s) {
  const [x0, y0, c1x, c1y, c2x, c2y, x1, y1] = s;
  let length = 0;
  let px = x0;
  let py = y0;
  for (let i = 1; i <= 24; i += 1) {
    const t = i / 24;
    const mt = 1 - t;
    const x = mt ** 3 * x0 + 3 * mt ** 2 * t * c1x + 3 * mt * t ** 2 * c2x + t ** 3 * x1;
    const y = mt ** 3 * y0 + 3 * mt ** 2 * t * c1y + 3 * mt * t ** 2 * c2y + t ** 3 * y1;
    length += Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  return length;
}

/** Logo plus wordmark, used for the opening and the end card. */
export function drawEndCard(ctx, time, opts) {
  const { logoProgress, logoAlpha, textAlpha, glow } = opts;
  const cx = FRAME.width / 2;
  const cy = FRAME.height / 2 - 40;

  if (glow > 0) {
    const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, 460);
    g.addColorStop(0, `rgba(44,103,197,${(0.22 * glow).toFixed(3)})`);
    g.addColorStop(1, 'rgba(44,103,197,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, FRAME.width, FRAME.height);
  }

  drawLogo(ctx, cx, cy, 132, logoProgress, '#EFEFE7', '#262827', logoAlpha);

  if (textAlpha > 0.01) {
    ctx.save();
    ctx.globalAlpha = textAlpha;
    const rise = (1 - textAlpha) * 16; // settles upward into place
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#EFEFE7';
    ctx.font = `600 62px ${TYPE.sans}`;
    ctx.fillText(COPY.product, cx, cy + 150 + rise);
    ctx.fillStyle = 'rgba(239,239,231,.62)';
    ctx.font = `${TYPE.uiWeight} 22px ${TYPE.sans}`;
    ctx.fillText(COPY.subtitle, cx, cy + 208 + rise);
    ctx.fillStyle = 'rgba(239,239,231,.4)';
    ctx.font = `${TYPE.uiWeight} 18px ${TYPE.sans}`;
    ctx.fillText(COPY.endCard, cx, cy + 252 + rise);
    ctx.restore();
  }
}

/** Lower-third caption during the montage. */
export function drawCaption(ctx, text, alpha, y = 980) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `500 30px ${TYPE.sans}`;
  const w = ctx.measureText(text).width;
  const padX = 34;
  const boxW = w + padX * 2;
  const x = FRAME.width / 2 - boxW / 2;

  ctx.fillStyle = 'rgba(16,18,22,.72)';
  const r = 28;
  ctx.beginPath();
  ctx.moveTo(x + r, y - 26);
  ctx.arcTo(x + boxW, y - 26, x + boxW, y + 26, r);
  ctx.arcTo(x + boxW, y + 26, x, y + 26, r);
  ctx.arcTo(x, y + 26, x, y - 26, r);
  ctx.arcTo(x, y - 26, x + boxW, y - 26, r);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.09)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#EFEFE7';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, FRAME.width / 2, y + 1);
  ctx.restore();
}

/** Hairline frame border, keeps the composition feeling deliberate. */
export function drawFrame(ctx) {
  ctx.strokeStyle = 'rgba(255,255,255,.05)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, FRAME.width - 2, FRAME.height - 2);
}

export { ACCENT_LIGHT, ACCENT_DARK, ease };
