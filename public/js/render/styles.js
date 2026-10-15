/**
 * Style specs: what every element of a finished space should look like.
 *
 * A "spec" is plain JSON with one entry per element (flooring, walls,
 * ceiling, lighting, fixtures, cabinets, furniture). It is built from:
 *   1. the chosen preset style (adapted to the room type),
 *   2. the reference images, according to their roles, and
 *   3. one-element-at-a-time edits made by the user.
 * The free renderer draws the spec directly; for AI renders the spec is
 * turned into short descriptions (see describeSpec).
 */
import { hexToRgb, mixHex, luma, saturation, warmth, rgbToHex } from '../lib/imageTools.js';
import { presetById, roleById } from '../catalog.js';

// ---------------------------------------------------------------------------
// Option libraries (also used by the element editor)
// ---------------------------------------------------------------------------
export const FLOOR_OPTIONS = [
  { id: 'oak-light', label: 'Light oak planks', material: { type: 'planks', base: '#c9a47c', size: 2, plankWidth: 0.19 } },
  { id: 'oak-natural', label: 'Natural oak planks', material: { type: 'planks', base: '#a97a50', size: 2, plankWidth: 0.19 } },
  { id: 'walnut', label: 'Walnut planks', material: { type: 'planks', base: '#6b4a33', size: 2, plankWidth: 0.16 } },
  { id: 'grey-oak', label: 'Grey-washed oak', material: { type: 'planks', base: '#a59d92', size: 2, plankWidth: 0.2 } },
  { id: 'herringbone-oak', label: 'Oak herringbone parquet', material: { type: 'herringbone', base: '#b98b5e', size: 0.9 } },
  { id: 'herringbone-teak', label: 'Teak herringbone parquet', material: { type: 'herringbone', base: '#8a5a35', size: 0.9 } },
  { id: 'porcelain-grey', label: 'Large light-grey porcelain tiles', material: { type: 'tiles', base: '#cfccc6', grout: '#bdb9b2', tileW: 1.2, tileH: 0.6, size: 2.4, variation: 0.03 } },
  { id: 'porcelain-white', label: 'Large warm-white porcelain tiles', material: { type: 'tiles', base: '#e9e5de', grout: '#d3cec5', tileW: 0.8, tileH: 0.8, size: 2.4, variation: 0.03 } },
  { id: 'marble-white', label: 'Polished white marble', material: { type: 'tiles', base: '#efede8', vein: '#8f8b86', grout: '#e2dfd8', tileW: 1.2, tileH: 1.2, size: 2.4, veinStrength: 0.65 } },
  { id: 'marble-dark', label: 'Dark veined marble', material: { type: 'tiles', base: '#33302d', vein: '#d9d1c3', grout: '#2a2826', tileW: 1.2, tileH: 0.6, size: 2.4, veinStrength: 0.7 } },
  { id: 'concrete', label: 'Polished concrete', material: { type: 'concrete', base: '#a8a59f', size: 4, variation: 0.15 } },
  { id: 'terrazzo', label: 'Terrazzo', material: { type: 'terrazzo', base: '#ebe6de', chips: ['#a7a199', '#3c3a37', '#c9b49a', '#d98f6a'], size: 1.2 } },
  { id: 'cement-tile', label: 'Patterned cement tiles', material: { type: 'patterned', colors: ['#efe4d0', '#b5543a', '#2f5f5b'], tileW: 0.2, size: 1.2 } },
  { id: 'kota', label: 'Kota stone', material: { type: 'tiles', base: '#7f8a7c', grout: '#6c7569', tileW: 0.6, tileH: 0.6, size: 1.8, variation: 0.1 } },
];

export const ACCENT_OPTIONS = [
  { id: 'none', label: 'No feature wall', material: null },
  { id: 'marble', label: 'Marble feature wall', material: { type: 'tiles', base: '#eeebe5', vein: '#9a938a', grout: '#e4e0d9', tileW: 1.2, tileH: 2.4, size: 2.4, veinStrength: 0.75 } },
  { id: 'fluted', label: 'Fluted wood panelling', material: { type: 'fluted', base: '#8f6a4a', size: 1, fluteWidth: 0.045 } },
  { id: 'slats', label: 'Timber slat wall', material: { type: 'slats', base: '#b0845a', size: 1, pitch: 0.07 } },
  { id: 'brick', label: 'Exposed brick', material: { type: 'brick', base: '#94503a', mortar: '#c4bcae', size: 1.38 } },
  { id: 'stone', label: 'Stone cladding', material: { type: 'stone', base: '#b6aa98', mortar: '#8e8578', size: 1.6 } },
  { id: 'limewash', label: 'Limewash plaster', material: { type: 'plaster', base: '#d8cbb8', size: 3, variation: 0.22 } },
  { id: 'paint', label: 'Painted accent colour', material: { type: 'paint', base: '#b86b4b', size: 1 } },
];

export const TILE_OPTIONS = [
  { id: 'subway-white', label: 'White metro tiles', material: { type: 'subway', base: '#f2f0eb', grout: '#d7d3cb', size: 0.9 } },
  { id: 'porcelain-grey', label: 'Large grey porcelain tiles', material: { type: 'tiles', base: '#c3c0ba', grout: '#b3afa8', tileW: 0.6, tileH: 1.2, size: 2.4, variation: 0.03 } },
  { id: 'marble', label: 'Marble-look tiles', material: { type: 'tiles', base: '#efede8', vein: '#9a958e', grout: '#e2dfd8', tileW: 0.6, tileH: 1.2, size: 2.4, veinStrength: 0.6 } },
  { id: 'green-glazed', label: 'Green glazed tiles', material: { type: 'tiles', base: '#4f7a70', grout: '#d9d4c9', tileW: 0.1, tileH: 0.1, size: 0.6, variation: 0.12, groutWidth: 0.002 } },
  { id: 'terrazzo', label: 'Terrazzo tiles', material: { type: 'terrazzo', base: '#ece7df', chips: ['#a7a199', '#3c3a37', '#c9b49a'], size: 1.2 } },
];

export const COUNTER_OPTIONS = [
  { id: 'quartz-white', label: 'White quartz', color: '#eeece8' },
  { id: 'marble', label: 'White marble', color: '#ebe8e2' },
  { id: 'granite-black', label: 'Black granite', color: '#262626' },
  { id: 'butcher-block', label: 'Oak butcher block', color: '#b88a5a' },
  { id: 'concrete', label: 'Concrete', color: '#9d9a94' },
];

export const METALS = [
  { id: 'black', label: 'Matte black', color: '#1f1f1f' },
  { id: 'brass', label: 'Brushed brass', color: '#b89148' },
  { id: 'chrome', label: 'Polished chrome', color: '#c8cbd0' },
  { id: 'nickel', label: 'Brushed nickel', color: '#9da1a3' },
  { id: 'copper', label: 'Copper', color: '#b06b45' },
  { id: 'white', label: 'Matte white', color: '#f1f0ec' },
];

export const PENDANTS = [
  { id: 'globe', label: 'Opal glass globe' },
  { id: 'dome', label: 'Metal dome' },
  { id: 'cone', label: 'Slim cone' },
  { id: 'edison', label: 'Bare Edison bulbs' },
  { id: 'rattan', label: 'Rattan shade' },
  { id: 'none', label: 'No pendant' },
];

export const CEILING_TYPES = [
  { id: 'flat', label: 'Flat painted ceiling' },
  { id: 'cove', label: 'False ceiling with cove lighting' },
  { id: 'slats', label: 'Timber slat ceiling' },
  { id: 'exposed', label: 'Exposed concrete, painted' },
];

export const TEMPERATURES = [
  { id: 2700, label: 'Warm (2700 K)' },
  { id: 3000, label: 'Soft warm (3000 K)' },
  { id: 4000, label: 'Neutral (4000 K)' },
  { id: 5000, label: 'Cool daylight (5000 K)' },
];

// ---------------------------------------------------------------------------
// Colour naming (descriptions for AI prompts and the UI)
// ---------------------------------------------------------------------------
export function colorName(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  const tone = l > 0.9 ? 'off-white' : l > 0.75 ? 'light' : l > 0.5 ? '' : l > 0.28 ? 'deep' : 'very dark';
  if (s < 0.12 || (l > 0.88 && s < 0.35)) {
    if (l > 0.9) return h < 70 || h > 300 ? 'warm white' : 'cool white';
    if (l > 0.72) return h < 70 && s > 0.04 ? 'greige' : 'light grey';
    if (l > 0.45) return 'mid grey';
    if (l > 0.2) return 'charcoal';
    return 'black';
  }
  const hues = [
    [15, 'red'], [35, 'terracotta'], [48, 'ochre'], [65, 'mustard yellow'], [90, 'olive'], [150, 'sage green'],
    [190, 'teal'], [250, 'blue'], [290, 'purple'], [335, 'pink'], [360, 'red'],
  ];
  let name = hues.find(([limit]) => h < limit)[1];
  if (name === 'terracotta' && l > 0.6) name = s < 0.5 ? 'beige' : 'peach';
  if (name === 'terracotta' && l < 0.32) name = 'brown';
  if (name === 'ochre' && l < 0.4) name = 'walnut brown';
  if (name === 'ochre' && l > 0.68) name = s < 0.45 ? 'sand' : 'butter yellow';
  if (name === 'blue' && l < 0.35) name = 'navy blue';
  if (name === 'sage green' && l < 0.32) name = 'forest green';
  if (name === 'sage green' && s > 0.55) name = 'green';
  return `${tone && !['very dark', 'deep'].includes(tone) ? tone + ' ' : tone === 'very dark' ? 'dark ' : ''}${name}`.trim();
}

// ---------------------------------------------------------------------------
// Preset specs
// ---------------------------------------------------------------------------
const opt = (list, id) => structuredClone(list.find((o) => o.id === id));
const metal = (id) => METALS.find((m) => m.id === id);

const BASE = {
  minimalist: {
    flooring: 'porcelain-grey',
    walls: { paint: '#eeebe6', finish: 'paint', accent: 'none' },
    ceiling: { type: 'cove', color: '#f7f6f3' },
    lighting: { temperature: 3000, level: 1.05, downlights: true, mood: 'day' },
    fixtures: { metal: 'black', pendant: 'cone', skirting: '#eeebe6', frames: '#2b2b2b', door: '#f2f0eb' },
    cabinets: { color: '#f1efea', counter: 'quartz-white', splash: 'porcelain-grey', handles: 'black' },
    furniture: { upholstery: '#c9c7c2', accent: '#2b2b2b', accent2: '#8d8a85', wood: '#c8a97e', rug: ['#e6e2db', '#a9a59e'], rugPattern: 'border', art: ['#2b2b2b', '#c9c7c2', '#e9e5dd'], plants: 1, density: 'minimal' },
  },
  scandinavian: {
    flooring: 'oak-light',
    walls: { paint: '#f4f1ea', finish: 'paint', accent: 'none' },
    ceiling: { type: 'flat', color: '#fbfaf7' },
    lighting: { temperature: 3000, level: 1.1, downlights: false, mood: 'day' },
    fixtures: { metal: 'white', pendant: 'globe', skirting: '#f4f1ea', frames: '#f2f2ef', door: '#f4f1ea' },
    cabinets: { color: '#a9b59a', counter: 'butcher-block', splash: 'subway-white', handles: 'brass' },
    furniture: { upholstery: '#e3d8c6', accent: '#a9b59a', accent2: '#d9b8a4', wood: '#d4b48c', rug: ['#efe9df', '#cfc4b2'], rugPattern: 'stripes', art: ['#a9b59a', '#e6d5c3', '#5b5b55'], plants: 2, density: 'cosy' },
  },
  luxury: {
    flooring: 'marble-white',
    walls: { paint: '#d9d2c7', finish: 'paint', accent: 'fluted' },
    ceiling: { type: 'cove', color: '#f2efe9' },
    lighting: { temperature: 2700, level: 0.98, downlights: true, mood: 'evening' },
    fixtures: { metal: 'brass', pendant: 'dome', skirting: '#d9d2c7', frames: '#3a3632', door: '#5a3e2b' },
    cabinets: { color: '#1f3a4d', counter: 'marble', splash: 'marble', handles: 'brass' },
    furniture: { upholstery: '#1f3a4d', accent: '#b08d57', accent2: '#ece6dc', wood: '#5a3e2b', rug: ['#ece6dc', '#b9a98f'], rugPattern: 'border', art: ['#b08d57', '#1f3a4d', '#ece6dc'], plants: 1, density: 'cosy' },
  },
  indian: {
    flooring: 'cement-tile',
    walls: { paint: '#f2e8d8', finish: 'paint', accent: 'paint', accentColor: '#c0603e' },
    ceiling: { type: 'slats', color: '#fbf6ee', wood: '#8a5a35' },
    lighting: { temperature: 2700, level: 1.02, downlights: true, mood: 'day' },
    fixtures: { metal: 'brass', pendant: 'rattan', skirting: '#8a5a35', frames: '#5c3b22', door: '#7a4a2a' },
    cabinets: { color: '#7a4a2a', counter: 'quartz-white', splash: 'green-glazed', handles: 'brass' },
    furniture: { upholstery: '#d9a441', accent: '#2f6f6b', accent2: '#c0603e', wood: '#7a4a2a', rug: ['#c0603e', '#f2e8d8'], rugPattern: 'diamond', art: ['#c0603e', '#d9a441', '#2f6f6b'], plants: 2, density: 'cosy' },
  },
  industrial: {
    flooring: 'concrete',
    walls: { paint: '#b9b6b0', finish: 'plaster', accent: 'brick' },
    ceiling: { type: 'exposed', color: '#3a3a3a' },
    lighting: { temperature: 2700, level: 0.95, downlights: false, mood: 'evening' },
    fixtures: { metal: 'black', pendant: 'edison', skirting: null, frames: '#1f1f1f', door: '#2b2b2b' },
    cabinets: { color: '#2b2b2b', counter: 'butcher-block', splash: 'subway-white', handles: 'black' },
    furniture: { upholstery: '#a0673d', accent: '#3a3a3a', accent2: '#d8d4cc', wood: '#7d5a3c', rug: ['#5d5a55', '#a39d93'], rugPattern: 'plain', art: ['#3a3a3a', '#a0673d', '#d8d4cc'], plants: 1, density: 'cosy' },
  },
};

/** Per-room adjustments to a preset's base spec. */
function adaptToRoom(spec, roomType, presetId) {
  if (roomType === 'bathroom') {
    const tile = { minimalist: 'porcelain-grey', scandinavian: 'subway-white', luxury: 'marble', indian: 'green-glazed', industrial: 'subway-white' }[presetId];
    spec.walls.lower = { option: tile, height: 2.1 };
    spec.flooring = ['luxury'].includes(presetId) ? spec.flooring : presetId === 'indian' ? 'terrazzo' : 'porcelain-grey';
    spec.walls.accent = 'none';
    spec.ceiling.type = 'flat';
    spec.fixtures.pendant = 'none';
  }
  if (roomType === 'kitchen') {
    if (['oak-light', 'cement-tile'].includes(spec.flooring) && presetId !== 'indian') spec.flooring = 'porcelain-white';
    spec.walls.accent = 'none';
  }
  if (roomType === 'bedroom') {
    if (spec.flooring === 'marble-white') spec.flooring = 'herringbone-oak';
    if (spec.flooring === 'concrete') spec.flooring = 'walnut';
  }
  return spec;
}

/** Exterior specs are different enough to be defined separately. */
const EXTERIOR = {
  minimalist: { facade: '#ecebe7', accent: { type: 'cladding', base: '#8a6a4f', size: 1.2 }, frames: '#2b2b2b', door: '#3a3a3a', paving: '#c8c4bc', sky: 'clear', lights: 'black' },
  scandinavian: { facade: '#f3f1ec', accent: { type: 'cladding', base: '#c8a882', size: 1.2 }, frames: '#f2f2ef', door: '#a9b59a', paving: '#cfc9bf', sky: 'clear', lights: 'white' },
  luxury: { facade: '#e3ddd3', accent: { type: 'stone', base: '#cbbfae', mortar: '#9b9184', size: 1.6 }, frames: '#3a3632', door: '#5a3e2b', paving: '#d9d3c8', sky: 'golden', lights: 'brass' },
  indian: { facade: '#f2e8d8', accent: { type: 'brick', base: '#b0613f', mortar: '#d9cdb8', size: 1.38 }, frames: '#5c3b22', door: '#7a4a2a', paving: '#a39a8b', sky: 'clear', lights: 'brass' },
  industrial: { facade: '#a9a6a0', accent: { type: 'brick', base: '#8e4b32', mortar: '#b9b1a3', size: 1.38 }, frames: '#1f1f1f', door: '#2b2b2b', paving: '#8f8b84', sky: 'golden', lights: 'black' },
};

/**
 * Builds the default spec for a preset and room type.
 * The returned object is fully "expanded": materials and colours, no ids.
 */
export function presetSpec(presetId, roomType) {
  const preset = presetById(presetId);
  const base = adaptToRoom(structuredClone(BASE[preset.id]), roomType, preset.id);
  if (roomType === 'exterior') return exteriorSpec(preset.id, base);

  const floor = opt(FLOOR_OPTIONS, base.flooring);
  const accent = opt(ACCENT_OPTIONS, base.walls.accent);
  if (accent?.material?.type === 'paint') accent.material.base = base.walls.accentColor ?? '#b86b4b';
  const lower = base.walls.lower ? opt(TILE_OPTIONS, base.walls.lower.option) : null;
  const counter = opt(COUNTER_OPTIONS, base.cabinets.counter);
  const splash = opt(TILE_OPTIONS, base.cabinets.splash) ?? opt(TILE_OPTIONS, 'subway-white');

  return {
    flooring: { material: floor.material, name: floor.label },
    walls: {
      paint: base.walls.paint,
      finish: base.walls.finish,
      accent: accent?.material ? { material: accent.material, name: accent.label } : null,
      lower: lower ? { material: lower.material, name: lower.label, height: base.walls.lower.height } : null,
    },
    ceiling: { ...base.ceiling },
    lighting: { ...base.lighting },
    fixtures: { ...base.fixtures, metalColor: metal(base.fixtures.metal).color, metalName: metal(base.fixtures.metal).label },
    cabinets: {
      color: base.cabinets.color,
      counter: counter.color,
      counterName: counter.label,
      splash: { material: splash.material, name: splash.label },
      handles: metal(base.cabinets.handles).color,
      handlesName: metal(base.cabinets.handles).label,
    },
    furniture: { ...base.furniture },
  };
}

function exteriorSpec(presetId, base) {
  const e = EXTERIOR[presetId];
  return {
    flooring: { material: { type: 'pavers', base: e.paving, size: 2.4 }, lawn: '#5f8a3a', name: 'Lawn with a paved path' },
    walls: { paint: e.facade, finish: 'paint', accent: { material: e.accent, name: e.accent.type === 'cladding' ? 'Timber cladding' : e.accent.type === 'stone' ? 'Stone cladding' : 'Exposed brick' }, lower: null },
    ceiling: { type: 'sky', sky: e.sky, color: '#9ec3e6' },
    lighting: { temperature: base.lighting.temperature, level: 1.05, downlights: false, mood: 'day' },
    fixtures: { metal: e.lights, metalColor: metal(e.lights).color, metalName: metal(e.lights).label, frames: e.frames, door: e.door, pendant: 'none', skirting: null },
    cabinets: null,
    furniture: { ...base.furniture, plants: 3, density: 'cosy' },
  };
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** Picks colours from a palette by simple rules. */
function pickColors(palette) {
  const usable = palette.filter((c) => c.weight > 0.02);
  const byLight = [...usable].sort((a, b) => luma(b.rgb) - luma(a.rgb));
  const light = byLight.find((c) => saturation(c.rgb) < 0.35 && luma(c.rgb) > 0.55) ?? byLight[0];
  const dark = byLight[byLight.length - 1];
  const mids = usable.filter((c) => c !== light && luma(c.rgb) > 0.15 && luma(c.rgb) < 0.85);
  const vivid = [...usable].sort((a, b) => saturation(b.rgb) * (0.5 + b.weight) - saturation(a.rgb) * (0.5 + a.weight))[0];
  const main = mids[0] ?? vivid ?? light;
  const woody = usable.find((c) => warmth(c.rgb) > 0.12 && luma(c.rgb) > 0.2 && luma(c.rgb) < 0.7 && saturation(c.rgb) > 0.2);
  return { light: light?.hex, dark: dark?.hex, main: main?.hex, vivid: vivid?.hex, woody: woody?.hex, second: (mids[1] ?? vivid)?.hex };
}

/** Wall paint derived from a reference: its light neutral, kept liveable. */
const wallPaintFrom = (hex) => mixHex(hex, '#f6f4ef', luma(hexToRgb(hex)) > 0.8 ? 0.15 : 0.55);

/** Floor material type that best matches an average floor colour. */
function floorFromColor(rgb, fallback) {
  const hex = rgbToHex(rgb);
  const l = luma(rgb);
  const w = warmth(rgb);
  const s = saturation(rgb);
  if (w > 0.12 && s > 0.22 && l < 0.75) return { material: { type: 'planks', base: hex, size: 2, plankWidth: 0.19 }, name: `${colorName(hex)} wood planks` };
  if (l > 0.72) return { material: { type: 'tiles', base: hex, grout: mixHex(hex, '#888888', 0.25), tileW: 1.2, tileH: 0.6, size: 2.4, variation: 0.03 }, name: `${colorName(hex)} large-format tiles` };
  if (s < 0.12 && l < 0.72) return { material: { type: 'concrete', base: hex, size: 4, variation: 0.12 }, name: `${colorName(hex)} polished concrete` };
  return fallback;
}

/**
 * Applies reference images to a spec according to their roles.
 * @param {object} spec  output of presetSpec (mutated copy is returned)
 * @param {{id, label, role, analysis}[]} references  analysis from analyseReference()
 * @returns {{spec, used: {id, label, role, effect}[]}}
 */
export function applyReferences(specIn, references, roomType) {
  const spec = structuredClone(specIn);
  // Image-backed materials hold canvases, which structuredClone keeps.
  const used = [];
  const seenRoles = new Set();
  for (const ref of references) {
    const a = ref.analysis;
    if (!a) continue;
    const role = roleById(ref.role);
    const duplicate = seenRoles.has(ref.role) && ref.role !== 'style';
    seenRoles.add(ref.role);
    if (duplicate) {
      used.push({ id: ref.id, label: ref.label, role: ref.role, effect: `Not used: another ${role.label.toLowerCase()} reference comes first.`, skipped: true });
      continue;
    }
    const c = pickColors(a.palette);
    const effects = [];

    if (ref.role === 'style') {
      if (c.light) {
        spec.walls.paint = wallPaintFrom(c.light);
        effects.push(`walls ${colorName(spec.walls.paint)}`);
      }
      if (spec.furniture && c.main) {
        spec.furniture.upholstery = c.main;
        if (c.vivid) spec.furniture.accent = c.vivid;
        if (c.woody) spec.furniture.wood = c.woody;
        spec.furniture.art = [c.vivid, c.main, c.light].filter(Boolean);
        effects.push(`furniture in ${colorName(c.main)}`);
      }
      if (a.floorColor && roomType !== 'exterior') {
        spec.flooring = floorFromColor(a.floorColor, spec.flooring);
        effects.push(`floor: ${spec.flooring.name.toLowerCase()}`);
      }
      spec.lighting.temperature = a.warmth > 0.1 ? 2700 : a.warmth > 0.03 ? 3000 : 4000;
      effects.push(`${spec.lighting.temperature} K lighting`);
      if (spec.cabinets && c.second) spec.cabinets.color = c.second;
    }

    if (ref.role === 'flooring') {
      if (a.uniformity > 0.55 && a.textureCanvas) {
        spec.flooring = {
          material: { type: 'image', canvas: a.textureCanvas, size: 1.0, base: rgbToHex(a.average) },
          name: `floor material matching the "${ref.label}" sample (${colorName(rgbToHex(a.average))})`,
          fromReference: ref.id,
        };
        effects.push('floor texture taken from the sample');
      } else {
        const source = a.floorColor ?? a.average;
        spec.flooring = floorFromColor(source, spec.flooring);
        effects.push(`floor colour only (${colorName(rgbToHex(source))})`);
      }
    }

    if (ref.role === 'kitchen' && spec.cabinets) {
      if (c.main) spec.cabinets.color = c.main;
      if (c.light) {
        spec.cabinets.counter = c.light;
        spec.cabinets.counterName = `${colorName(c.light)} stone`;
      }
      effects.push(`cabinets ${colorName(spec.cabinets.color)}`);
    }

    if (ref.role === 'palette') {
      if (c.light) spec.walls.paint = wallPaintFrom(c.light);
      if (c.vivid && spec.walls.accent?.material?.type === 'paint') spec.walls.accent.material.base = c.vivid;
      if (spec.furniture) {
        if (c.main) spec.furniture.upholstery = c.main;
        if (c.vivid) spec.furniture.accent = c.vivid;
        if (c.second) spec.furniture.accent2 = c.second;
        spec.furniture.art = [c.vivid, c.main, c.second].filter(Boolean);
        spec.furniture.rug = [c.light ?? spec.furniture.rug[0], c.second ?? c.main ?? spec.furniture.rug[1]];
      }
      if (spec.cabinets && c.second) spec.cabinets.color = c.second;
      effects.push(`colours ${[...new Set([c.light, c.main, c.vivid, c.second].filter(Boolean).map(colorName))].join(', ')}`);
    }

    if (ref.role === 'furniture' && spec.furniture) {
      // Ignore the studio background (very light) when picking upholstery.
      const subject = a.palette.filter((p) => luma(p.rgb) < 0.86 && luma(p.rgb) > 0.08);
      const main = subject[0]?.hex ?? c.main;
      if (main) spec.furniture.upholstery = main;
      if (c.woody) spec.furniture.wood = c.woody;
      if (subject[1]) spec.furniture.accent2 = subject[1].hex;
      effects.push(`upholstery ${colorName(spec.furniture.upholstery)}`);
    }

    used.push({ id: ref.id, label: ref.label, role: ref.role, effect: effects.length ? effects.join(', ') : 'style only' });
  }
  return { spec, used };
}

// ---------------------------------------------------------------------------
// Element edits
// ---------------------------------------------------------------------------

/**
 * Applies the user's one-element edits. Each override is stored per photo
 * as { element: partialSpec } and merged over the element.
 */
export function applyOverrides(specIn, overrides = {}, references = []) {
  const spec = { ...specIn };
  for (const [element, patchIn] of Object.entries(overrides)) {
    if (!patchIn || !spec[element]) continue;
    let patch = patchIn;
    // "Use my flooring reference" is stored by id, because canvases cannot be saved.
    if (element === 'flooring' && patch.useReference) {
      const ref = references.find((r) => r.id === patch.useReference);
      if (!ref?.analysis?.textureCanvas) continue;
      patch = {
        material: { type: 'image', canvas: ref.analysis.textureCanvas, size: 1.0, base: rgbToHex(ref.analysis.average) },
        name: `floor material matching the "${ref.label}" sample`,
        fromReference: ref.id,
      };
    }
    spec[element] = { ...spec[element], ...patch };
  }
  return spec;
}

/** Plain-English description of each element (for AI prompts and the UI). */
export function describeSpec(spec, roomType) {
  const out = {};
  const exterior = roomType === 'exterior';
  out.flooring = exterior
    ? `front garden lawn with a ${colorName(spec.flooring.material.base ?? '#cccccc')} paved path`
    : spec.flooring.name.toLowerCase();
  const walls = [`${exterior ? 'facade rendered and painted' : 'walls painted'} ${colorName(spec.walls.paint)} (${spec.walls.paint})`];
  if (spec.walls.finish === 'plaster') walls.push('in a soft limewash plaster finish');
  if (spec.walls.accent) walls.push(exterior ? `with ${spec.walls.accent.name.toLowerCase()} accents` : `with a ${spec.walls.accent.name.toLowerCase()} on the far wall`);
  if (spec.walls.lower) walls.push(`${spec.walls.lower.name.toLowerCase()} up to ${spec.walls.lower.height} m`);
  out.walls = walls.join(', ');
  const ceilingTypes = { flat: 'flat smooth ceiling', cove: 'false ceiling with hidden cove lighting', slats: 'timber slat ceiling', exposed: 'exposed concrete ceiling painted', sky: 'clear blue sky' };
  out.ceiling = exterior
    ? spec.ceiling.sky === 'golden' ? 'warm late-afternoon sky' : 'clear blue sky with a few soft clouds'
    : `${ceilingTypes[spec.ceiling.type] ?? 'flat ceiling'} in ${colorName(spec.ceiling.color)}`;
  const l = spec.lighting;
  out.lighting = `${l.temperature} K ${l.temperature <= 3000 ? 'warm' : 'neutral'} light, ${l.mood === 'evening' ? 'evening mood with lamps on' : 'bright daylight'}${l.downlights ? ', recessed downlights' : ''}`;
  const f = spec.fixtures;
  out.fixtures = exterior
    ? `${colorName(f.frames)} window frames, ${colorName(f.door)} front door, ${f.metalName.toLowerCase()} outdoor wall lights`
    : `${f.metalName.toLowerCase()} light fittings and hardware${f.pendant !== 'none' ? `, ${PENDANTS.find((p) => p.id === f.pendant)?.label.toLowerCase()} pendant` : ''}, ${colorName(f.frames)} window frames, ${colorName(f.door)} doors${f.skirting ? ', slim skirting boards' : ''}`;
  if (spec.cabinets && ['kitchen', 'bathroom'].includes(roomType)) {
    const c = spec.cabinets;
    out.cabinets = roomType === 'kitchen'
      ? `${colorName(c.color)} flat-panel kitchen cabinets with ${c.handlesName.toLowerCase()} handles, ${c.counterName.toLowerCase()} worktop, ${c.splash.name.toLowerCase()} splashback`
      : `${colorName(c.color)} wall-hung vanity with ${c.counterName.toLowerCase()} top and a large mirror`;
  }
  const fu = spec.furniture;
  if (fu) {
    const items = {
      living: `sofa in ${colorName(fu.upholstery)}, ${colorName(fu.wood)} wood coffee table, rug, floor lamp, plants and framed art`,
      bedroom: `bed with ${colorName(fu.upholstery)} bedding, ${colorName(fu.wood)} wood bedside tables with lamps, rug and plants`,
      kitchen: `${colorName(fu.wood)} bar stools, a few plants and accessories`,
      bathroom: 'towels, a plant and minimal accessories',
      exterior: 'planters, shrubs and a small tree',
    };
    out.furniture = items[roomType] ?? items.living;
  }
  return out;
}

/**
 * Full spec for one photo: preset -> references -> user edits.
 * Element edits always win over references, so changing one element never
 * gets undone by a reference.
 */
export function resolveSpec({ presetId, roomType, references = [], overrides = {} }) {
  const base = presetSpec(presetId, roomType);
  const { spec, used } = applyReferences(base, references, roomType);
  return { spec: applyOverrides(spec, overrides, references), used };
}
