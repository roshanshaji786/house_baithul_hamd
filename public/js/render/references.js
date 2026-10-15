/**
 * Reference images: analysis and conflict checks.
 *
 * Each reference is analysed once when it is added (colours, the colour of
 * its floor area, how uniform its texture is, indoor or outdoor). The
 * analysis feeds the style spec (styles.js) and the checks below, which warn
 * when a reference does not fit the room's layout or scale. The app always
 * keeps the layout from the user's photo; warnings explain what is ignored.
 */
import {
  sampleImage, extractPalette, regionAverage, textureUniformity, looksLikeOutdoors, warmth, luma,
} from '../lib/imageTools.js';
import { seamlessFromImage } from './materials.js';
import { roomLabel, roleById } from '../catalog.js';

/** Analyses a reference image (ImageBitmap or canvas). */
export function analyseReference(source) {
  const { data, width, height, lum } = sampleImage(source, 256);
  const palette = extractPalette(data, width, height, 6);
  const average = regionAverage(data, width, height, { x0: 0, y0: 0, x1: 1, y1: 1 });
  const uniformity = textureUniformity(lum, width, height);
  const outdoors = looksLikeOutdoors(data, width, height);
  // In a room photo the bottom-centre strip is usually floor.
  const floorColor = uniformity < 0.55 ? regionAverage(data, width, height, { x0: 0.2, y0: 0.84, x1: 0.8, y1: 0.99 }) : null;
  const avgWarmth = palette.reduce((acc, c) => acc + warmth(c.rgb) * c.weight, 0);
  const brightness = palette.reduce((acc, c) => acc + luma(c.rgb) * c.weight, 0);
  let textureCanvas = null;
  return {
    palette,
    average,
    uniformity,
    outdoors,
    floorColor,
    warmth: avgWarmth,
    brightness,
    aspect: source.width / source.height,
    /** Seamless texture made from the image (created on first use). */
    get textureCanvas() {
      textureCanvas ??= seamlessFromImage(source);
      return textureCanvas;
    },
  };
}

/**
 * Heuristic layout/scale conflicts between references and a photo.
 * @param {{roomType: string, aspect: number}} photo
 * @param {{id, label, role, analysis}[]} references
 * @returns {{refId: string, message: string}[]}
 */
export function detectConflicts(photo, references) {
  const warnings = [];
  const room = roomLabel(photo.roomType).toLowerCase();
  const isExterior = photo.roomType === 'exterior';
  const seen = new Set();

  for (const ref of references) {
    const a = ref.analysis;
    const name = `"${ref.label}"`;
    const role = roleById(ref.role);
    if (!a) continue;

    if (seen.has(ref.role) && ref.role !== 'style') {
      warnings.push({ refId: ref.id, message: `${name} is a second ${role.label.toLowerCase()} reference, so only the first one is used.` });
      continue;
    }
    seen.add(ref.role);

    if (ref.role === 'kitchen' && photo.roomType !== 'kitchen') {
      warnings.push({
        refId: ref.id,
        message: photo.roomType === 'bathroom'
          ? `${name} is a kitchen reference; for this bathroom only its cabinet colour is used for the vanity. The layout stays as in your photo.`
          : `${name} is a kitchen reference but this photo is a ${room}, so it is not used here. The layout stays as in your photo.`,
      });
    }
    if (ref.role === 'furniture' && isExterior) {
      warnings.push({ refId: ref.id, message: `${name} shows furniture, which does not apply to a house exterior. Only its colours are used for planters.` });
    }
    if (ref.role === 'style' && a.outdoors !== isExterior) {
      warnings.push({
        refId: ref.id,
        message: a.outdoors
          ? `${name} looks like an outdoor scene but this is a ${room}. Only its colours and mood are used; your photo's layout is kept.`
          : `${name} looks like an interior but this photo is a house exterior. Only its colours are used; your photo's layout is kept.`,
      });
    }
    if (ref.role === 'style') {
      const flip = (a.aspect > 1.15 && photo.aspect < 0.87) || (a.aspect < 0.87 && photo.aspect > 1.15);
      if (flip) {
        warnings.push({ refId: ref.id, message: `${name} is framed ${a.aspect > 1 ? 'landscape' : 'portrait'} while your photo is ${photo.aspect > 1 ? 'landscape' : 'portrait'}. Its room shape is ignored; only the style is used.` });
      }
    }
    if (ref.role === 'flooring' && a.uniformity < 0.55) {
      warnings.push({
        refId: ref.id,
        message: `${name} looks like a whole room rather than a close-up of the floor material, so only its floor colour is used. Your photo's floor area and scale are kept.`,
      });
    }
  }
  return warnings;
}
