/**
 * Image helpers: loading files, quality checks, colour palettes and small
 * colour utilities. The analysis functions work on plain typed arrays so
 * they can be unit-tested in Node without a browser.
 */

// ---------------------------------------------------------------------------
// Colour utilities
// ---------------------------------------------------------------------------
export const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgbToHex = ([r, g, b]) =>
  '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
export const mixHex = (a, b, t) => {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
};
/** Relative luminance 0..1 (sRGB weights, gamma-encoded values). */
export const luma = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
export const saturation = ([r, g, b]) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
};
/** Positive for warm colours (red/yellow), negative for cool (blue). */
export const warmth = ([r, , b]) => (r - b) / 255;

/** sRGB (0..255) to linear (0..1) lookup table and the inverse. */
export const SRGB_TO_LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const LINEAR_LUT_SIZE = 4096;
const LINEAR_TO_SRGB_LUT = new Uint8ClampedArray(LINEAR_LUT_SIZE + 1).map((_, i) => {
  const c = i / LINEAR_LUT_SIZE;
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
});
/** Linear 0..1 to sRGB byte, clamped. */
export const linearToSrgb = (v) => LINEAR_TO_SRGB_LUT[Math.max(0, Math.min(LINEAR_LUT_SIZE, (v * LINEAR_LUT_SIZE) | 0))];
export const hexToLinear = (hex) => hexToRgb(hex).map((v) => SRGB_TO_LINEAR[v]);

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
const SUPPORTED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/bmp'];

/** Thrown for files that cannot be used at all. */
export class ImageLoadError extends Error {}

/** Decodes an image File/Blob into an ImageBitmap (EXIF rotation applied). */
export async function decodeImage(blob) {
  const name = blob.name ?? 'image';
  if (/\.(heic|heif)$/i.test(name) || /heic|heif/.test(blob.type)) {
    throw new ImageLoadError(`"${name}" is a HEIC photo, which most browsers cannot read. On iPhone choose Settings > Camera > Formats > Most Compatible, or export it as JPEG.`);
  }
  if (blob.type && !SUPPORTED.includes(blob.type)) {
    throw new ImageLoadError(`"${name}" is not a supported image. Please use JPEG, PNG or WebP.`);
  }
  if (blob.size > 40 * 1024 * 1024) {
    throw new ImageLoadError(`"${name}" is larger than 40 MB. Please use a smaller photo.`);
  }
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageLoadError(`"${name}" could not be opened. The file may be damaged or not an image.`);
  }
}

/** Draws a source into a canvas no larger than `maxSide` on its long edge. */
export function toCanvas(source, maxSide = Infinity) {
  const w0 = source.width;
  const h0 = source.height;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w0 * scale));
  canvas.height = Math.max(1, Math.round(h0 * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export const canvasToBlob = (canvas, type = 'image/jpeg', quality = 0.9) =>
  new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality),
  );

export const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

/** Luminance (0..1) of RGBA pixel data. */
export function luminanceOf(data, width, height) {
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255;
  }
  return out;
}

/** Downscaled RGBA + luminance used by the analysis functions. */
export function sampleImage(source, maxSide = 512) {
  const canvas = toCanvas(source, maxSide);
  const { width, height } = canvas;
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  return { data, width, height, lum: luminanceOf(data, width, height) };
}

// ---------------------------------------------------------------------------
// Quality checks
// ---------------------------------------------------------------------------

/**
 * Measures brightness, contrast and sharpness of a luminance image.
 * Sharpness is the mean of the strongest 2% Laplacian responses on a
 * ~512 px wide image: blurry photos have no crisp edges anywhere.
 */
export function measureQuality(lum, width, height) {
  let sum = 0;
  let sumSq = 0;
  let clipped = 0;
  for (let i = 0; i < lum.length; i++) {
    const v = lum[i];
    sum += v;
    sumSq += v * v;
    if (v > 0.97) clipped++;
  }
  const mean = sum / lum.length;
  const std = Math.sqrt(Math.max(0, sumSq / lum.length - mean * mean));

  const lap = new Float32Array((width - 2) * (height - 2));
  let k = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      lap[k++] = Math.abs(4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - width] - lum[i + width]);
    }
  }
  lap.sort();
  const from = Math.floor(lap.length * 0.98);
  let top = 0;
  for (let i = from; i < lap.length; i++) top += lap[i];
  const sharpness = top / Math.max(1, lap.length - from);

  return { mean, std, clipped: clipped / lum.length, sharpness };
}

/**
 * Turns measurements into user-facing problems.
 * Errors stop the image from being used (unless the user overrides);
 * warnings are shown but do not block.
 * @param {'photo'|'reference'} kind
 */
export function judgeQuality(stats, originalWidth, originalHeight, kind = 'photo') {
  const errors = [];
  const warnings = [];
  const shortSide = Math.min(originalWidth, originalHeight);
  const minSide = kind === 'photo' ? 480 : 160;
  const goodSide = kind === 'photo' ? 900 : 400;

  if (shortSide < minSide) {
    errors.push(`Too small (${originalWidth}×${originalHeight} px). Use a photo at least ${minSide} px on its short side - most phone photos are fine.`);
  } else if (shortSide < goodSide) {
    warnings.push(`Low resolution (${originalWidth}×${originalHeight} px). Results will look soft.`);
  }

  if (stats.mean < 0.12) {
    errors.push('Too dark to see the room. Open windows or switch on lights and take the photo again, ideally in daytime.');
  } else if (stats.mean < 0.2) {
    warnings.push('Quite dark. The app will brighten it, but a brighter photo gives better results.');
  }

  if (stats.clipped > 0.35) warnings.push('Very bright or washed out. Avoid pointing the camera at a window or the sun.');

  if (stats.mean < 0.12) {
    // Already reported as too dark; contrast and sharpness cannot be judged.
  } else if (stats.std < 0.035) {
    errors.push('Unclear: the image is almost one flat colour. Make sure the room is in view and in focus.');
  } else if (kind === 'photo' && stats.sharpness < 0.016) {
    errors.push('Blurry or unclear. Hold the phone steady, tap to focus and take the photo again.');
  } else if (stats.sharpness < 0.028) {
    warnings.push('Slightly blurry. A sharper photo will give cleaner results.');
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Colour palette (k-means on a subsample)
// ---------------------------------------------------------------------------

/** Small seeded random generator so results are repeatable. */
export function seededRandom(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Extracts the main colours of RGBA data.
 * @returns {{rgb: number[], hex: string, weight: number}[]} sorted by weight
 */
export function extractPalette(data, width, height, k = 6, region = null) {
  const rand = seededRandom(42);
  const px = [];
  const x0 = region ? Math.floor(region.x0 * width) : 0;
  const x1 = region ? Math.ceil(region.x1 * width) : width;
  const y0 = region ? Math.floor(region.y0 * height) : 0;
  const y1 = region ? Math.ceil(region.y1 * height) : height;
  const stride = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 4000)));
  for (let y = y0; y < y1; y += stride) {
    for (let x = x0; x < x1; x += stride) {
      const p = (y * width + x) * 4;
      if (data[p + 3] < 128) continue;
      px.push([data[p], data[p + 1], data[p + 2]]);
    }
  }
  if (!px.length) return [];
  const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

  // k-means++ initialisation.
  const centers = [px[Math.floor(rand() * px.length)].slice()];
  while (centers.length < Math.min(k, px.length)) {
    const d = px.map((p) => Math.min(...centers.map((c) => dist(p, c))));
    const total = d.reduce((a, b) => a + b, 0);
    if (total === 0) break;
    let r = rand() * total;
    let idx = 0;
    while (r > d[idx]) r -= d[idx++];
    centers.push(px[Math.min(idx, px.length - 1)].slice());
  }

  const assign = new Int32Array(px.length);
  for (let iter = 0; iter < 12; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    px.forEach((p, i) => {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, j) => {
        const dd = dist(p, c);
        if (dd < bestD) {
          bestD = dd;
          best = j;
        }
      });
      assign[i] = best;
      const s = sums[best];
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      s[3]++;
    });
    centers.forEach((c, j) => {
      if (sums[j][3]) for (let ch = 0; ch < 3; ch++) c[ch] = sums[j][ch] / sums[j][3];
    });
  }
  const counts = centers.map(() => 0);
  assign.forEach((a) => counts[a]++);
  return centers
    .map((c, j) => ({ rgb: c.map(Math.round), hex: rgbToHex(c), weight: counts[j] / px.length }))
    .filter((c) => c.weight > 0.01)
    .sort((a, b) => b.weight - a.weight);
}

/** Average colour of a normalised region. */
export function regionAverage(data, width, height, region) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = Math.floor(region.y0 * height); y < Math.ceil(region.y1 * height); y++) {
    for (let x = Math.floor(region.x0 * width); x < Math.ceil(region.x1 * width); x++) {
      const p = (y * width + x) * 4;
      r += data[p];
      g += data[p + 1];
      b += data[p + 2];
      n++;
    }
  }
  return n ? [r / n, g / n, b / n] : [128, 128, 128];
}

/**
 * How uniform an image's texture is across a 4x4 grid (0 = very uneven,
 * 1 = perfectly even). Material close-ups score high; whole-room photos
 * (bright ceiling, dark furniture...) score low.
 */
export function textureUniformity(lum, width, height) {
  const cells = [];
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      let s = 0;
      let n = 0;
      for (let y = Math.floor((gy * height) / 4); y < Math.floor(((gy + 1) * height) / 4); y++) {
        for (let x = Math.floor((gx * width) / 4); x < Math.floor(((gx + 1) * width) / 4); x++) {
          s += lum[y * width + x];
          n++;
        }
      }
      cells.push(s / n);
    }
  }
  const mean = cells.reduce((a, b) => a + b, 0) / cells.length;
  const sd = Math.sqrt(cells.reduce((a, b) => a + (b - mean) ** 2, 0) / cells.length);
  return Math.max(0, 1 - sd / Math.max(0.05, mean) / 0.35);
}

/** True when the top of the image looks like open sky (an outdoor photo). */
export function looksLikeOutdoors(data, width, height) {
  const [r, g, b] = regionAverage(data, width, height, { x0: 0.1, y0: 0, x1: 0.9, y1: 0.18 });
  return b > r * 1.08 && b > 140 && luma([r, g, b]) > 0.45;
}
