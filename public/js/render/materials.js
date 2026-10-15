/**
 * Procedural materials for the free in-browser renderer.
 *
 * Each material description (plain JSON, e.g. {type: 'planks', base: '#c8a27a'})
 * is turned into a seamless texture canvas covering `size` metres, then into
 * a "sampler" with mip levels so the floor stays crisp near the camera and
 * free of shimmering patterns in the distance. The same canvases are reused
 * as textures in the 3D house.
 */
import { hexToRgb, mixHex, seededRandom, SRGB_TO_LINEAR } from '../lib/imageTools.js';

const TEX = 1024; // texture resolution in pixels

// ---------------------------------------------------------------------------
// Periodic value noise (wraps at `period` lattice cells, so textures tile).
// ---------------------------------------------------------------------------
function makeNoise(seed) {
  const rand = seededRandom(seed * 9301 + 49297);
  const table = new Float32Array(512 * 512).map(() => rand());
  const smooth = (t) => t * t * (3 - 2 * t);
  const noise = (x, y, period) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = smooth(x - xi);
    const fy = smooth(y - yi);
    const p = period || 512;
    const x0 = ((xi % p) + p) % p;
    const y0 = ((yi % p) + p) % p;
    const x1 = (x0 + 1) % p;
    const y1 = (y0 + 1) % p;
    const a = table[(y0 & 511) * 512 + (x0 & 511)];
    const b = table[(y0 & 511) * 512 + (x1 & 511)];
    const c = table[(y1 & 511) * 512 + (x0 & 511)];
    const d = table[(y1 & 511) * 512 + (x1 & 511)];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  /** Fractal noise; `period` is in lattice cells of the first octave. */
  const fbm = (x, y, period, octaves = 4) => {
    let total = 0;
    let amp = 1;
    let norm = 0;
    let p = period;
    for (let o = 0; o < octaves; o++) {
      total += amp * noise(x, y, p);
      norm += amp;
      x *= 2;
      y *= 2;
      p *= 2;
      amp *= 0.5;
    }
    return total / norm;
  };
  return { noise, fbm, rand };
}

// ---------------------------------------------------------------------------
// Texture generators. Each draws into `ctx` (TEX x TEX) representing
// material.size metres and returns nothing.
// ---------------------------------------------------------------------------

/** Per-pixel helper: fills the canvas from fn(x, y) -> [r, g, b]. */
function fillPixels(ctx, fn) {
  const img = ctx.createImageData(TEX, TEX);
  const d = img.data;
  for (let y = 0, p = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++, p += 4) {
      const c = fn(x, y);
      d[p] = c[0];
      d[p + 1] = c[1];
      d[p + 2] = c[2];
      d[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Overlays fine noise to add grain/texture to flat drawings. */
function addGrain(ctx, n, amount, scale = 64, period = 64) {
  const img = ctx.getImageData(0, 0, TEX, TEX);
  const d = img.data;
  for (let y = 0, p = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++, p += 4) {
      const g = 1 + (n.fbm((x / TEX) * scale, (y / TEX) * scale, period, 3) - 0.5) * amount;
      d[p] *= g;
      d[p + 1] *= g;
      d[p + 2] *= g;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const shade = (hex, f) => hexToRgb(hex).map((v) => Math.max(0, Math.min(255, v * f)));
const rgbCss = (c) => `rgb(${c.map((v) => Math.round(v)).join(',')})`;

/** Draws a rectangle on a tiling canvas, wrapping around the edges. */
function wrapRect(ctx, x, y, w, h, style) {
  ctx.fillStyle = style;
  for (const dx of [-TEX, 0, TEX]) {
    for (const dy of [-TEX, 0, TEX]) {
      if (x + dx < TEX && x + dx + w > 0 && y + dy < TEX && y + dy + h > 0) ctx.fillRect(x + dx, y + dy, w, h);
    }
  }
}

const GENERATORS = {
  /** Solid paint with an almost invisible roller texture. */
  paint(ctx, m, n) {
    const c = hexToRgb(m.base);
    fillPixels(ctx, (x, y) => {
      const g = 1 + (n.fbm((x / TEX) * 24, (y / TEX) * 24, 24, 3) - 0.5) * 0.025;
      return [c[0] * g, c[1] * g, c[2] * g];
    });
  },

  /** Limewash / microcement: soft cloudy variation. */
  plaster(ctx, m, n) {
    const c = hexToRgb(m.base);
    fillPixels(ctx, (x, y) => {
      const g = 1 + (n.fbm((x / TEX) * 4, (y / TEX) * 4, 4, 5) - 0.5) * (m.variation ?? 0.16);
      return [c[0] * g, c[1] * g, c[2] * g];
    });
  },

  /** Wood planks running along the texture's vertical axis. */
  planks(ctx, m, n) {
    const size = m.size;
    const plankW = m.plankWidth ?? 0.19;
    const cols = Math.max(1, Math.round(size / plankW));
    const colPx = TEX / cols;
    const base = hexToRgb(m.base);
    const variation = m.variation ?? 0.14;
    const grainPeriod = Math.max(1, Math.round(40 * size));
    const streakPeriod = Math.max(1, Math.round(3 * size));
    const splits = [];
    for (let c = 0; c < cols; c++) {
      const offset = n.rand();
      const cut = 0.35 + n.rand() * 0.3;
      splits.push({ a: offset, b: (offset + cut) % 1, toneA: 1 + (n.rand() - 0.5) * 2 * variation, toneB: 1 + (n.rand() - 0.5) * 2 * variation, seedA: n.rand() * 50, seedB: n.rand() * 50 });
    }
    fillPixels(ctx, (x, y) => {
      const c = Math.min(cols - 1, Math.floor(x / colPx));
      const s = splits[c];
      const fy = y / TEX;
      // Which of the two planks in this column (seams at a and b).
      const inA = s.a < s.b ? fy >= s.a && fy < s.b : fy >= s.a || fy < s.b;
      const tone = inA ? s.toneA : s.toneB;
      const seed = inA ? s.seedA : s.seedB;
      const lx = (x - c * colPx) / colPx;
      // Periods match the tile so the grain wraps seamlessly.
      const grain = n.fbm(lx * 3 + seed, fy * grainPeriod, grainPeriod, 3);
      const streak = n.fbm(lx * 30 + seed, fy * streakPeriod, streakPeriod, 2);
      let g = tone * (0.86 + 0.18 * grain + 0.1 * (streak - 0.5));
      const dSeam = Math.min(Math.abs(fy - s.a), Math.abs(fy - s.b), 1 - Math.abs(fy - s.a), 1 - Math.abs(fy - s.b)) * TEX;
      if (m.seams !== false && (lx * colPx < 1.6 || dSeam < 1.2)) g *= 0.55; // bevel gaps
      return [base[0] * g, base[1] * g, base[2] * g];
    });
  },

  /** Herringbone parquet (axis-aligned staircase pattern). */
  herringbone(ctx, m, n) {
    const k = 5; // plank length in plank widths
    const unit = TEX / (2 * k); // plank width in px; tile = 2k widths
    const variation = m.variation ?? 0.14;
    ctx.fillStyle = rgbCss(shade(m.base, 0.5));
    ctx.fillRect(0, 0, TEX, TEX);
    for (let a = -2 * k; a < 4 * k; a++) {
      for (let b = -4; b < 4; b++) {
        const ox = (a + b * k) * unit;
        const oy = (a - b * k) * unit;
        const t1 = 1 + (n.rand() - 0.5) * 2 * variation;
        const t2 = 1 + (n.rand() - 0.5) * 2 * variation;
        wrapRect(ctx, ox + 0.8, oy + 0.8, k * unit - 1.6, unit - 1.6, rgbCss(shade(m.base, t1)));
        wrapRect(ctx, ox + 0.8, oy + unit + 0.8, unit - 1.6, k * unit - 1.6, rgbCss(shade(m.base, t2)));
      }
    }
    addGrain(ctx, n, 0.22, 96, 96);
  },

  /** Rectangular tiles with grout; optional marble veining per tile. */
  tiles(ctx, m, n) {
    const tw = m.tileW ?? 0.6;
    const th = m.tileH ?? 0.6;
    const cols = Math.max(1, Math.round(m.size / tw));
    const rows = Math.max(1, Math.round(m.size / th));
    const cw = TEX / cols;
    const ch = TEX / rows;
    const grout = hexToRgb(m.grout ?? mixHex(m.base, '#808080', 0.35));
    const base = hexToRgb(m.base);
    const vein = m.vein ? hexToRgb(m.vein) : null;
    const tones = Array.from({ length: cols * rows }, () => 1 + (n.rand() - 0.5) * 2 * (m.variation ?? 0.05));
    const offsets = Array.from({ length: cols * rows }, () => n.rand() * 100);
    const groutPx = Math.max(1.5, (TEX / m.size) * (m.groutWidth ?? 0.003));
    const stagger = m.stagger ? 0.5 : 0;
    fillPixels(ctx, (x, y) => {
      const r = Math.floor(y / ch);
      const xs = (x + (r % 2) * stagger * cw) % TEX;
      const c = Math.floor(xs / cw);
      const lx = xs - c * cw;
      const ly = y - r * ch;
      if (lx < groutPx || ly < groutPx) return grout;
      const idx = (r % rows) * cols + (c % cols);
      let g = tones[idx];
      let col = base;
      if (vein) {
        const o = offsets[idx];
        const u = lx / cw + o;
        const v = ly / ch + o * 0.7;
        const turb = n.fbm(u * 3, v * 3, 0, 5);
        const line = Math.abs(Math.sin((u * 1.3 + v * 0.8 + turb * 3.2) * Math.PI * 1.2));
        const veinAmt = Math.pow(1 - line, 14) * (m.veinStrength ?? 0.8) + Math.pow(1 - line, 4) * 0.12;
        col = base.map((b, i) => b + (vein[i] - b) * Math.min(1, veinAmt));
        g *= 0.97 + 0.06 * n.fbm(u * 8, v * 8, 0, 3);
      } else {
        g *= 0.985 + 0.03 * n.fbm((x / TEX) * 40, (y / TEX) * 40, 40, 2);
      }
      // Slight darkening near the edges suggests a bevel.
      if (lx < groutPx + 2 || ly < groutPx + 2) g *= 0.93;
      return [col[0] * g, col[1] * g, col[2] * g];
    });
  },

  /** Polished or microtopping concrete. */
  concrete(ctx, m, n) {
    const c = hexToRgb(m.base);
    fillPixels(ctx, (x, y) => {
      const u = x / TEX;
      const v = y / TEX;
      const cloud = n.fbm(u * 3, v * 3, 3, 5);
      const speck = n.noise(u * 300, v * 300, 300);
      let g = 0.9 + 0.2 * cloud + (speck > 0.93 ? -0.1 : 0) + (speck < 0.04 ? 0.06 : 0);
      g *= 1 + (m.variation ?? 0) * (n.fbm(u * 1.5, v * 1.5, 1.5, 2) - 0.5);
      return [c[0] * g, c[1] * g, c[2] * g];
    });
  },

  /** Terrazzo: base with scattered chips of the given colours. */
  terrazzo(ctx, m, n) {
    GENERATORS.concrete(ctx, { ...m, variation: 0.05 }, n);
    const chips = m.chips ?? ['#9a9a9a', '#3b3b3b', '#d8c7b0'];
    const count = 2600 * (m.density ?? 1);
    for (let i = 0; i < count; i++) {
      const x = n.rand() * TEX;
      const y = n.rand() * TEX;
      const r = 1.5 + n.rand() ** 3 * 9;
      ctx.fillStyle = chips[Math.floor(n.rand() * chips.length)];
      for (const dx of [-TEX, 0, TEX]) {
        for (const dy of [-TEX, 0, TEX]) {
          ctx.beginPath();
          const sides = 5 + Math.floor(n.rand() * 3);
          for (let s = 0; s < sides; s++) {
            const a = (s / sides) * Math.PI * 2;
            const rr = r * (0.6 + n.rand() * 0.5);
            ctx.lineTo(x + dx + Math.cos(a) * rr, y + dy + Math.sin(a) * rr);
          }
          ctx.fill();
        }
      }
    }
  },

  /** Hand-made patterned cement tile (Athangudi-inspired motif). */
  patterned(ctx, m, n) {
    const tile = m.tileW ?? 0.2;
    const count = Math.max(1, Math.round(m.size / tile));
    const s = TEX / count;
    const [c1, c2, c3] = m.colors ?? ['#efe4d0', '#b5543a', '#2f5f5b'];
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) {
        const x = i * s;
        const y = j * s;
        ctx.fillStyle = c1;
        ctx.fillRect(x, y, s, s);
        ctx.fillStyle = c2;
        // Quarter circles in each corner form circles across four tiles.
        for (const [cx, cy] of [[x, y], [x + s, y], [x, y + s], [x + s, y + s]]) {
          ctx.beginPath();
          ctx.arc(cx, cy, s * 0.36, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = c1;
        for (const [cx, cy] of [[x, y], [x + s, y], [x, y + s], [x + s, y + s]]) {
          ctx.beginPath();
          ctx.arc(cx, cy, s * 0.22, 0, Math.PI * 2);
          ctx.fill();
        }
        // Central diamond.
        ctx.fillStyle = c3;
        ctx.beginPath();
        ctx.moveTo(x + s / 2, y + s * 0.2);
        ctx.lineTo(x + s * 0.8, y + s / 2);
        ctx.lineTo(x + s / 2, y + s * 0.8);
        ctx.lineTo(x + s * 0.2, y + s / 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = c1;
        ctx.beginPath();
        ctx.arc(x + s / 2, y + s / 2, s * 0.08, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = rgbCss(shade(c1, 0.7));
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.75, y + 0.75, s - 1.5, s - 1.5);
      }
    }
    addGrain(ctx, n, 0.12, 48, 48);
  },

  brick(ctx, m, n) {
    const bw = 0.23;
    const bh = 0.075;
    const cols = Math.max(1, Math.round(m.size / bw));
    const rows = Math.max(2, Math.round(m.size / bh / 2) * 2);
    const cw = TEX / cols;
    const ch = TEX / rows;
    const mortarPx = Math.max(2, (TEX / m.size) * 0.011);
    ctx.fillStyle = m.mortar ?? '#b9b3a8';
    ctx.fillRect(0, 0, TEX, TEX);
    for (let r = 0; r < rows; r++) {
      for (let c = -1; c < cols; c++) {
        const x = c * cw + (r % 2) * cw * 0.5;
        const tone = 0.8 + n.rand() * 0.35;
        wrapRect(ctx, x + mortarPx / 2, r * ch + mortarPx / 2, cw - mortarPx, ch - mortarPx, rgbCss(shade(m.base, tone)));
      }
    }
    addGrain(ctx, n, 0.3, 128, 128);
  },

  /** Wall tiles in a running bond (subway / metro tiles). */
  subway(ctx, m, n) {
    GENERATORS.tiles(ctx, { ...m, tileW: m.tileW ?? 0.15, tileH: m.tileH ?? 0.075, stagger: true, groutWidth: 0.002, variation: 0.04 }, n);
  },

  /** Vertical fluted panelling (wood or stone). */
  fluted(ctx, m, n) {
    const flute = m.fluteWidth ?? 0.04;
    const count = Math.max(4, Math.round(m.size / flute));
    const c = hexToRgb(m.base);
    fillPixels(ctx, (x, y) => {
      const t = ((x / TEX) * count) % 1;
      const g = 0.72 + 0.32 * Math.sin(t * Math.PI) + 0.05 * (n.fbm((x / TEX) * 6, (y / TEX) * 60, 6, 3) - 0.5);
      return [c[0] * g, c[1] * g, c[2] * g];
    });
  },

  /** Vertical timber slats with dark gaps. */
  slats(ctx, m, n) {
    const pitch = m.pitch ?? 0.07;
    const count = Math.max(4, Math.round(m.size / pitch));
    const c = hexToRgb(m.base);
    const gap = hexToRgb(m.gap ?? '#1e1a17');
    const tones = Array.from({ length: count }, () => 0.9 + n.rand() * 0.2);
    fillPixels(ctx, (x, y) => {
      const i = Math.floor((x / TEX) * count);
      const t = ((x / TEX) * count) % 1;
      if (t > 0.72) return gap;
      const g = tones[i] * (0.9 + 0.2 * n.fbm(t * 4 + i * 7, (y / TEX) * 30, 0, 3));
      return [c[0] * g, c[1] * g, c[2] * g];
    });
  },

  /** Horizontal timber cladding boards (exteriors). */
  cladding(ctx, m, n) {
    const board = m.boardHeight ?? 0.15;
    const count = Math.max(2, Math.round(m.size / board));
    const c = hexToRgb(m.base);
    const tones = Array.from({ length: count }, () => 0.88 + n.rand() * 0.22);
    fillPixels(ctx, (x, y) => {
      const i = Math.floor((y / TEX) * count);
      const t = ((y / TEX) * count) % 1;
      const g = tones[i] * (t > 0.93 ? 0.5 : 0.92 + 0.16 * n.fbm((x / TEX) * 40, t * 3 + i * 5, 40, 3));
      return [c[0] * g, c[1] * g, c[2] * g];
    });
  },

  /** Natural stone in random courses (exterior plinths, feature walls). */
  stone(ctx, m, n) {
    ctx.fillStyle = m.mortar ?? '#8c867c';
    ctx.fillRect(0, 0, TEX, TEX);
    const rows = 7;
    const rh = TEX / rows;
    for (let r = 0; r < rows; r++) {
      let x = n.rand() * -TEX * 0.2;
      while (x < TEX) {
        const w = rh * (1.2 + n.rand() * 1.6);
        const tone = 0.78 + n.rand() * 0.4;
        wrapRect(ctx, x + 3, r * rh + 3, w - 6, rh - 6, rgbCss(shade(m.base, tone)));
        x += w;
      }
    }
    addGrain(ctx, n, 0.35, 64, 64);
  },

  /** Lawn. */
  grass(ctx, m, n) {
    const c = hexToRgb(m.base ?? '#5f8a3a');
    fillPixels(ctx, (x, y) => {
      const u = x / TEX;
      const v = y / TEX;
      const g = 0.75 + 0.35 * n.fbm(u * 6, v * 6, 6, 3) + 0.25 * (n.noise(u * 400, v * 400, 400) - 0.5);
      return [c[0] * g, c[1] * g * 1.02, c[2] * g * 0.9];
    });
  },

  /** Large-format concrete or stone pavers with narrow joints. */
  pavers(ctx, m, n) {
    GENERATORS.tiles(ctx, { ...m, tileW: m.tileW ?? 0.6, tileH: m.tileH ?? 0.3, stagger: true, groutWidth: 0.008, variation: 0.08 }, n);
    addGrain(ctx, n, 0.15, 128, 128);
  },
};

/** Material types the free renderer can draw. */
export const MATERIAL_TYPES = Object.keys(GENERATORS);

// ---------------------------------------------------------------------------
// Texture cache and samplers
// ---------------------------------------------------------------------------
const textureCache = new Map();

/** Returns a TEX x TEX canvas for a material description (cached). */
export function materialCanvas(material, seed = 1) {
  if (material.type === 'image') return material.canvas;
  const key = JSON.stringify({ ...material, seed });
  if (textureCache.has(key)) return textureCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEX;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const generator = GENERATORS[material.type] ?? GENERATORS.paint;
  generator(ctx, { size: 1, ...material }, makeNoise(seed));
  if (textureCache.size > 40) textureCache.delete(textureCache.keys().next().value);
  textureCache.set(key, canvas);
  return canvas;
}

/**
 * Builds a mip-mapped sampler for a material.
 * sample(u, v, footprint, out) writes linear RGB into out[0..2], where u, v
 * are metres on the surface and footprint is metres per output pixel.
 */
export function createSampler(material, seed = 1) {
  const canvas = materialCanvas(material, seed);
  const size = material.size ?? 1;
  const levels = [];
  let level = canvas;
  for (;;) {
    const w = level.width;
    const data = level.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, w).data;
    const lin = new Float32Array(w * w * 3);
    for (let i = 0, p = 0; i < w * w; i++, p += 4) {
      lin[i * 3] = SRGB_TO_LINEAR[data[p]];
      lin[i * 3 + 1] = SRGB_TO_LINEAR[data[p + 1]];
      lin[i * 3 + 2] = SRGB_TO_LINEAR[data[p + 2]];
    }
    levels.push({ w, lin });
    if (w <= 8) break;
    const next = document.createElement('canvas');
    next.width = next.height = w >> 1;
    const ctx = next.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(level, 0, 0, w >> 1, w >> 1);
    level = next;
  }
  const texelsPerMetre = levels[0].w / size;
  const maxLevel = levels.length - 1;

  function sample(u, v, footprint, out) {
    let lv = Math.log2(Math.max(1e-6, footprint * texelsPerMetre));
    lv = lv < 0 ? 0 : lv > maxLevel ? maxLevel : lv;
    const L = levels[Math.round(lv)];
    const w = L.w;
    // Texture v grows downwards; surface v grows upwards/away.
    let x = (u / size) * w - 0.5;
    let y = (-v / size) * w - 0.5;
    x -= Math.floor(x / w) * w;
    y -= Math.floor(y / w) * w;
    const x0 = x | 0;
    const y0 = y | 0;
    const fx = x - x0;
    const fy = y - y0;
    const x1 = x0 + 1 === w ? 0 : x0 + 1;
    const y1 = y0 + 1 === w ? 0 : y0 + 1;
    const a = (y0 * w + x0) * 3;
    const b = (y0 * w + x1) * 3;
    const c = (y1 * w + x0) * 3;
    const d = (y1 * w + x1) * 3;
    const lin = L.lin;
    for (let ch = 0; ch < 3; ch++) {
      const top = lin[a + ch] + (lin[b + ch] - lin[a + ch]) * fx;
      const bottom = lin[c + ch] + (lin[d + ch] - lin[c + ch]) * fx;
      out[ch] = top + (bottom - top) * fy;
    }
  }
  return { sample, canvas, size };
}

/**
 * Turns an arbitrary photo (e.g. a flooring reference) into a seamless
 * texture: the centre square is blended with a half-offset copy of itself so
 * that its edges wrap without visible seams.
 */
export function seamlessFromImage(source) {
  const side = Math.min(source.width, source.height);
  const crop = document.createElement('canvas');
  crop.width = crop.height = TEX;
  const cctx = crop.getContext('2d', { willReadFrequently: true });
  cctx.drawImage(source, (source.width - side) / 2, (source.height - side) / 2, side, side, 0, 0, TEX, TEX);
  const a = cctx.getImageData(0, 0, TEX, TEX);
  const out = cctx.createImageData(TEX, TEX);
  const half = TEX / 2;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      // Weight is 1 in the centre of the crop and 0 at its edges.
      const wx = 1 - Math.abs(x - half) / half;
      const wy = 1 - Math.abs(y - half) / half;
      const w = Math.min(1, Math.min(wx, wy) * 2.2);
      const p = (y * TEX + x) * 4;
      const q = (((y + half) % TEX) * TEX + ((x + half) % TEX)) * 4;
      for (let ch = 0; ch < 3; ch++) out.data[p + ch] = a.data[p + ch] * w + a.data[q + ch] * (1 - w);
      out.data[p + 3] = 255;
    }
  }
  cctx.putImageData(out, 0, 0);
  return crop;
}

/** Average colour (hex) of a material, used for UI swatches and 3D tints. */
export function materialSwatch(material, seed = 1) {
  if (material.type !== 'image' && material.base && !['patterned', 'terrazzo'].includes(material.type)) return material.base;
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(materialCanvas(material, seed), 0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
}
