/**
 * Room geometry from a single photo ("room box" model).
 *
 * A photo taken facing a wall roughly straight on is treated as a camera
 * standing inside a box. The user (or `guessBackWall`) marks the far wall as
 * a rectangle and the vanishing point where the floor and ceiling lines
 * meet. With an assumed camera height and lens, that is enough to recover:
 *   - the room's approximate width, depth and ceiling height in metres, and
 *   - for every pixel, which surface it shows (floor, ceiling, left wall,
 *     right wall, far wall) and where on that surface it is.
 *
 * Coordinates ("room space"): metres, floor at y = 0, the photo's camera at
 * (0, cameraHeight, 0) looking down -z, the far wall at z = -depth.
 * This module is pure maths so it runs in both the browser and Node tests.
 */

export const SURFACE = { FLOOR: 0, CEILING: 1, LEFT: 2, RIGHT: 3, BACK: 4 };
export const SURFACE_NAMES = ['floor', 'ceiling', 'left', 'right', 'back'];

/** Horizontal field of view for common phone lenses, in degrees. */
export const LENSES = {
  main: { label: 'Phone main camera (1×)', hfov: 68 },
  wide: { label: 'Ultra-wide (0.5×)', hfov: 100 },
  tele: { label: 'Zoomed (2×)', hfov: 40 },
};

export const DEFAULT_CAMERA_HEIGHT = 1.5;

/** Default fit used before the user adjusts anything. */
export function defaultFit() {
  return { back: { x0: 0.28, y0: 0.27, x1: 0.72, y1: 0.7 }, vp: { x: 0.5, y: 0.5 }, lens: 'main', auto: false };
}

/** Keeps a fit valid: rectangle ordered and inside the frame, VP inside it. */
export function clampFit(fit) {
  const c = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const b = { ...fit.back };
  b.x0 = c(b.x0, 0.01, 0.95);
  b.x1 = c(b.x1, b.x0 + 0.04, 0.99);
  b.y0 = c(b.y0, 0.01, 0.95);
  b.y1 = c(b.y1, b.y0 + 0.04, 0.99);
  const vp = {
    x: c(fit.vp.x, b.x0 + 0.01, b.x1 - 0.01),
    y: c(fit.vp.y, b.y0 + 0.01, b.y1 - 0.01),
  };
  return { ...fit, back: b, vp, lens: LENSES[fit.lens] ? fit.lens : 'main' };
}

/**
 * Solves the room box for an image of `width` x `height` pixels.
 * @returns {object} room description used by the renderers and 3D view.
 */
export function solveRoom(fitInput, width, height, cameraHeight = DEFAULT_CAMERA_HEIGHT) {
  const fit = clampFit(fitInput);
  const hfov = (LENSES[fit.lens].hfov * Math.PI) / 180;
  const f = width / 2 / Math.tan(hfov / 2);
  const cx = fit.vp.x * width;
  const cy = fit.vp.y * height;
  const u0 = fit.back.x0 * width;
  const u1 = fit.back.x1 * width;
  const v0 = fit.back.y0 * height;
  const v1 = fit.back.y1 * height;

  // The floor (y = 0) meets the far wall along the rectangle's bottom edge.
  const depth = (f * cameraHeight) / (v1 - cy);
  const ceiling = cameraHeight + ((cy - v0) * depth) / f;
  const xL = ((u0 - cx) * depth) / f;
  const xR = ((u1 - cx) * depth) / f;

  return {
    width,
    height,
    f,
    cx,
    cy,
    eyeY: cameraHeight,
    depth,
    ceiling,
    xL,
    xR,
    roomWidth: xR - xL,
    fit,
  };
}

/** Projects a room-space point to image pixels. Returns null behind the camera. */
export function project(room, x, y, z) {
  if (z >= -1e-6) return null;
  const s = room.f / -z;
  return [room.cx + x * s, room.cy - (y - room.eyeY) * s];
}

/**
 * Casts the ray through pixel (u, v) into the box.
 * Returns { surface, x, y, z, t } where t is the distance along the ray
 * (with the ray's z component normalised to -1, so t equals depth).
 */
export function castRay(room, u, v) {
  const dx = (u - room.cx) / room.f;
  const dy = -(v - room.cy) / room.f;
  let t = room.depth;
  let surface = SURFACE.BACK;
  if (dy < 0) {
    const tf = room.eyeY / -dy;
    if (tf < t) {
      t = tf;
      surface = SURFACE.FLOOR;
    }
  } else if (dy > 0) {
    const tc = (room.ceiling - room.eyeY) / dy;
    if (tc < t) {
      t = tc;
      surface = SURFACE.CEILING;
    }
  }
  if (dx < 0) {
    const tl = room.xL / dx;
    if (tl < t) {
      t = tl;
      surface = SURFACE.LEFT;
    }
  } else if (dx > 0) {
    const tr = room.xR / dx;
    if (tr < t) {
      t = tr;
      surface = SURFACE.RIGHT;
    }
  }
  return { surface, t, x: dx * t, y: room.eyeY + dy * t, z: -t };
}

/**
 * 2D texture coordinates (metres) of a point on a surface, chosen so that
 * "u" runs horizontally and "v" runs upwards (walls) or away (floor/ceiling).
 */
export function surfaceUV(surface, x, y, z) {
  switch (surface) {
    case SURFACE.FLOOR:
    case SURFACE.CEILING:
      return [x, -z];
    case SURFACE.LEFT:
      return [-z, y];
    case SURFACE.RIGHT:
      return [z, y];
    default:
      return [x, y];
  }
}

/** Inverse of surfaceUV: room-space point for (u, v) on a surface. */
export function surfacePoint(room, surface, u, v) {
  switch (surface) {
    case SURFACE.FLOOR:
      return [u, 0, -v];
    case SURFACE.CEILING:
      return [u, room.ceiling, -v];
    case SURFACE.LEFT:
      return [room.xL, v, -u];
    case SURFACE.RIGHT:
      return [room.xR, v, u];
    default:
      return [u, v, -room.depth];
  }
}

/**
 * Guesses the far wall from a luminance image (Float32Array, 0..1).
 *
 * 1. The ceiling line and the floor line are long horizontal features across
 *    the middle of the photo: rows whose brightness steps (or dips, where the
 *    corner is shaded) consistently along their whole length.
 * 2. The far corners are where those lines stop being horizontal: following
 *    each line outwards, the horizontal feature fades where it turns into the
 *    diagonal wall/floor junction.
 * Works best for photos taken straight at a wall; returns null when nothing
 * convincing is found (the UI then keeps the default box for the user to fit).
 */
export function guessBackWall(lum, width, height) {
  const b = boxBlur(lum, width, height, Math.max(1, Math.round(width / 200)));
  const s = Math.max(1, Math.round(width / 160));
  const at = (x, y) => b[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  // Strength of a horizontal line feature at (x, y): step edge or ridge/valley.
  const hLine = (x, y) => {
    const up = at(x, y - s);
    const mid = at(x, y);
    const down = at(x, y + s);
    return { step: down - up, ridge: up + down - 2 * mid };
  };

  const x0 = Math.floor(width * 0.35);
  const x1 = Math.ceil(width * 0.65);
  const rowScore = new Float32Array(height);
  const steps = new Float32Array(x1 - x0);
  const ridges = new Float32Array(x1 - x0);
  for (let y = s; y < height - s; y++) {
    for (let x = x0; x < x1; x++) {
      const f = hLine(x, y);
      steps[x - x0] = f.step;
      ridges[x - x0] = f.ridge;
    }
    // Medians ignore features that only cover part of the row (sun patches, windows).
    rowScore[y] = Math.abs(median(steps)) + Math.abs(median(ridges));
  }
  // Candidate lines: strong local maxima of the row score.
  const rowMedian = median(rowScore);
  const maxScore = rowScore.reduce((m, v) => Math.max(m, v), 0);
  const candidates = [];
  for (let y = s + 1; y < height - s - 1; y++) {
    const v = rowScore[y];
    if (v >= rowScore[y - 1] && v > rowScore[y + 1] && v > 4 * rowMedian && v > 0.25 * maxScore && v > 0.008) candidates.push(y);
  }
  const tops = candidates.filter((y) => y < height * 0.48);
  const bottoms = candidates.filter((y) => y > height * 0.52);
  if (!tops.length || !bottoms.length) return null;

  // Follow a line outwards from the centre until its strength fades.
  const extent = (y, direction) => {
    const strength = (x) => {
      let best = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const f = hLine(x, y + dy);
        best = Math.max(best, Math.abs(f.step) + Math.abs(f.ridge));
      }
      return best;
    };
    const ref = rowScore[y];
    const run = Math.max(3, Math.round(width / 100));
    let weak = 0;
    for (let x = Math.round(width / 2); x > 0 && x < width - 1; x += direction) {
      weak = strength(x) < 0.35 * ref ? weak + 1 : 0;
      if (weak >= run) return x - direction * (run - 1);
    }
    return direction < 0 ? 0 : width - 1;
  };

  // A real far wall is a box: its top and bottom lines end at the same corners.
  // Windows on the far wall are boxes too, so prefer the largest consistent one.
  let best = null;
  for (const top of tops) {
    const tl = extent(top, -1);
    const tr = extent(top, 1);
    for (const bottom of bottoms) {
      const bl = extent(bottom, -1);
      const br = extent(bottom, 1);
      const mismatch = (Math.abs(tl - bl) + Math.abs(tr - br)) / width;
      const left = (tl + bl) / 2;
      const right = (tr + br) / 2;
      if (mismatch > 0.08 || right - left < width * 0.15) continue;
      if (left <= 1 || right >= width - 2) continue; // never faded: not a wall line
      const area = (right - left) * (bottom - top);
      const score = area * (1 - mismatch * 4);
      if (!best || score > best.score) best = { score, left, right, top, bottom };
    }
  }
  if (!best) return null;
  return {
    x0: best.left / width,
    x1: best.right / width,
    y0: best.top / height,
    y1: best.bottom / height,
  };
}

function argmaxRange(arr, from, to) {
  let best = -1;
  let bestValue = -Infinity;
  for (let i = Math.max(0, from); i < Math.min(arr.length, to); i++) {
    if (arr[i] > bestValue) {
      bestValue = arr[i];
      best = i;
    }
  }
  return best;
}

function median(arr) {
  const sorted = Float32Array.from(arr).sort();
  return sorted[sorted.length >> 1] || 1e-6;
}

/**
 * Separable box blur using running sums. Radius in pixels.
 * Optional `weights` performs a normalised (masked) blur.
 */
export function boxBlur(src, width, height, radius, weights = null) {
  const tmp = new Float32Array(src.length);
  const tmpW = weights ? new Float32Array(src.length) : null;
  const out = new Float32Array(src.length);
  // Horizontal pass.
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let acc = 0;
    let accW = 0;
    for (let x = -radius; x <= radius; x++) {
      const i = row + Math.min(width - 1, Math.max(0, x));
      const w = weights ? weights[i] : 1;
      acc += src[i] * w;
      accW += w;
    }
    for (let x = 0; x < width; x++) {
      tmp[row + x] = acc;
      if (tmpW) tmpW[row + x] = accW;
      const add = row + Math.min(width - 1, x + radius + 1);
      const sub = row + Math.max(0, x - radius);
      const wa = weights ? weights[add] : 1;
      const ws = weights ? weights[sub] : 1;
      acc += src[add] * wa - src[sub] * ws;
      accW += wa - ws;
    }
  }
  // Vertical pass.
  for (let x = 0; x < width; x++) {
    let acc = 0;
    let accW = 0;
    for (let y = -radius; y <= radius; y++) {
      const i = Math.min(height - 1, Math.max(0, y)) * width + x;
      acc += tmp[i];
      accW += tmpW ? tmpW[i] : 0;
    }
    for (let y = 0; y < height; y++) {
      const i = y * width + x;
      out[i] = tmpW ? (accW > 1e-6 ? acc / accW : 0) : acc / ((2 * radius + 1) * (2 * radius + 1));
      const add = Math.min(height - 1, y + radius + 1) * width + x;
      const sub = Math.max(0, y - radius) * width + x;
      acc += tmp[add] - tmp[sub];
      if (tmpW) accW += tmpW[add] - tmpW[sub];
    }
  }
  return out;
}

/** Rough room size text for the UI, e.g. "4.2 m wide × 5.1 m deep × 2.9 m high". */
export function describeRoomSize(room) {
  const r = (v) => (Math.round(v * 10) / 10).toFixed(1);
  return `${r(room.roomWidth)} m wide × ${r(room.depth)} m deep × ${r(room.ceiling)} m high`;
}
