/*
 * Camera: projects the 1440x940 window into the 1920x1080 frame as a real
 * perspective quad.
 *
 * The window is rendered flat at native resolution into an offscreen canvas,
 * then warped onto the projected quadrilateral. Yaw and pitch therefore produce
 * genuine keystone (the far edge is shorter) rather than a flat zoom or a roll,
 * which is the difference between "the app is on screen" and "a screenshot was
 * pasted at an angle".
 *
 * The warp is done in horizontal strips with an affine transform each. Vertical
 * lines stay vertical under a projective map, so the only approximation is
 * linear rather than perspective-correct interpolation along each strip's own
 * height - well under a pixel at the few degrees used here.
 */
/** The window's own CSS size; every coordinate inside ui.js is in this space. */
export const WINDOW = { width: 1440, height: 940 };
/** The output frame. */
export const FRAME = { width: 1920, height: 1080 };

/** Distance at which the window is parked, in window-pixel units. */
const PARK_DISTANCE = 1440;
/** Window height at PARK_DISTANCE, as a fraction of the frame height. */
const PARK_HEIGHT = 0.84;
/** Virtual lens: kept fixed while distance changes, so push-ins converge. */
const FOCAL = (PARK_HEIGHT * FRAME.height * PARK_DISTANCE) / WINDOW.height;
/** Strips per frame. 64 keeps the interpolation error sub-pixel. */
const STRIPS = 64;

const EASINGS = {
  smooth: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  out: (t) => 1 - (1 - t) ** 3,
  in: (t) => t * t * t,
  linear: (t) => t,
  backOut: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
};

export function ease(name, t) {
  const fn = EASINGS[name] ?? EASINGS.smooth;
  return fn(Math.max(0, Math.min(1, t)));
}

function lerpPose(a, b, t) {
  const keys = ['x', 'y', 'z', 'rotX', 'rotY', 'rotZ', 'glow'];
  const out = {};
  for (const key of keys) out[key] = (a[key] ?? 0) + ((b[key] ?? 0) - (a[key] ?? 0)) * t;
  out.opacity = (a.opacity ?? 1) + ((b.opacity ?? 1) - (a.opacity ?? 1)) * t;
  return out;
}

export function poseAt(shots, time) {
  if (!shots.length) return { x: 0, y: 0, z: PARK_DISTANCE, rotX: 0, rotY: 0, rotZ: 0, glow: 0, opacity: 1 };
  let current = shots[0];
  for (const shot of shots) if (time >= shot.start) current = shot;
  const index = shots.indexOf(current);
  const next = shots[index + 1];
  const span = next ? next.start - current.start : current.end - current.start;
  const t = ease(current.ease ?? 'smooth', (time - current.start) / span);
  return next ? lerpPose(current, next, t) : { ...current };
}

/**
 * Slow sine "breathing" so the camera is never perfectly still. The amplitude
 * is deliberately tiny: it should read as life, not as movement.
 */
export function breathe(time) {
  return {
    dz: Math.sin((time / 12) * Math.PI * 2) * 0.006,
    dx: Math.sin((time / 17) * Math.PI * 2) * 3,
    dy: Math.cos((time / 21) * Math.PI * 2) * 2.5,
    roll: Math.sin((time / 26) * Math.PI * 2) * 0.12,
  };
}

/**
 * The four screen-space corners of the window for a pose, ordered
 * top-left, top-right, bottom-right, bottom-left.
 *
 * Rotation order is yaw, then pitch, then roll, then translate - the order a
 * physical camera rig would apply them.
 */
export function projectQuad(pose, time, opts = {}) {
  const b = opts.breathe === false ? { dz: 0, dx: 0, dy: 0, roll: 0 } : breathe(time);
  const hw = WINDOW.width / 2;
  const hh = WINDOW.height / 2;
  // `z` is the camera distance in window-pixel units: PARK_DISTANCE parks it,
  // smaller is closer. Breathing nudges the distance by a fraction of a percent.
  const distance = Math.max(360, pose.z * (1 + b.dz));

  const yaw = ((pose.rotY ?? 0) * Math.PI) / 180;
  const pitch = ((pose.rotX ?? 0) * Math.PI) / 180;
  const roll = (((pose.rotZ ?? 0) + b.roll) * Math.PI) / 180;

  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const cosR = Math.cos(roll);
  const sinR = Math.sin(roll);

  const project = (px, py) => {
    // Rotate about Y, then X, in world space.
    const x1 = px * cosY;
    const z1 = -px * sinY;
    const y1 = py * cosP - z1 * sinP;
    const z2 = py * sinP + z1 * cosP;
    // Roll in the image plane.
    const x2 = x1 * cosR - y1 * sinR;
    const y2 = x1 * sinR + y1 * cosR;
    const zCamera = Math.max(120, distance + z2);
    const scale = FOCAL / zCamera;
    return {
      x: FRAME.width / 2 + x2 * scale + pose.x + b.dx,
      y: FRAME.height / 2 + y2 * scale + pose.y + b.dy,
    };
  };

  return [project(-hw, -hh), project(hw, -hh), project(hw, hh), project(-hw, hh)];
}

/**
 * Warp `source` onto a quadrilateral in horizontal strips.
 *
 * Each strip maps a horizontal band of the source to the band of the quad
 * between the same two fractions, using the local affine transform that matches
 * both edges. `STRIPS` of these tile the quad with no seams (each strip's source
 * rect is exactly its share of the height).
 */
export function drawQuad(ctx, source, quad, alpha = 1) {
  if (alpha <= 0.004) return;
  const [tl, tr, br, bl] = quad;
  const sourceHeight = source.height;
  const stripSource = sourceHeight / STRIPS;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  for (let i = 0; i < STRIPS; i += 1) {
    const f0 = i / STRIPS;
    const f1 = (i + 1) / STRIPS;

    // Interpolate the strip's four corners along the quad's own edges.
    const l0x = tl.x + (bl.x - tl.x) * f0;
    const l0y = tl.y + (bl.y - tl.y) * f0;
    const l1x = tl.x + (bl.x - tl.x) * f1;
    const l1y = tl.y + (bl.y - tl.y) * f1;
    const r0x = tr.x + (br.x - tr.x) * f0;
    const r0y = tr.y + (br.y - tr.y) * f0;
    const r1x = tr.x + (br.x - tr.x) * f1;
    const r1y = tr.y + (br.y - tr.y) * f1;

    const sy0 = i * stripSource;
    // Each strip reads one extra source row past its share. Strips rasterize
    // independently, and at fractional boundaries that leaves a hairline of the
    // background showing through; the extra row is overdrawn by the next strip
    // and costs nothing visible.
    const sh = Math.min(stripSource + 1, sourceHeight - sy0);
    if (sh <= 0) continue;

    // Affine mapping of the source strip onto the destination parallelogram.
    // x' = a*sx + e, y' = b*sx + d*sy + f, matching both edges at both ends.
    const a = (r0x - l0x) / WINDOW.width;
    const e = l0x;
    const b = (r0y - l0y) / WINDOW.width;
    const d = (l1y - l0y) / stripSource;
    const f = l0y;

    ctx.save();
    ctx.setTransform(a, b, 0, d, e, f);
    ctx.drawImage(source, 0, sy0, WINDOW.width, sh, 0, 0, WINDOW.width, sh);
    ctx.restore();
  }

  ctx.restore();
}

/** Axis-aligned bounds of a quad, for glow and sweep placement. */
export function quadBounds(quad) {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/** Fill the quad with a colour, optionally blurred - used for the drop shadow. */
export function fillQuad(ctx, quad, color, blur = 0) {
  ctx.save();
  if (blur) ctx.filter = `blur(${blur}px)`;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(quad[0].x, quad[0].y);
  for (let i = 1; i < 4; i += 1) ctx.lineTo(quad[i].x, quad[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
