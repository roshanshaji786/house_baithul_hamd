/**
 * Shared catalogue of the app's fixed choices.
 *
 * Pure data with no browser APIs, so the Node server imports this file too
 * (for prompt building and request validation) and both sides agree on ids.
 */

/** Room types a photo can be tagged with. */
export const ROOM_TYPES = [
  { id: 'living', label: 'Living room' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'bedroom', label: 'Bedroom' },
  { id: 'bathroom', label: 'Bathroom' },
  { id: 'exterior', label: 'Full house exterior' },
];

/**
 * Roles a reference image can play. `controls` lists the elements the
 * reference is allowed to influence; `aiInstruction` is how the role is
 * explained to an AI image model.
 */
export const REFERENCE_ROLES = [
  {
    id: 'style',
    label: 'Overall style',
    hint: 'A finished room you like. Sets the mood, colours and materials.',
    controls: ['flooring', 'walls', 'ceiling', 'lighting', 'fixtures', 'cabinets', 'furniture'],
    aiInstruction:
      'match its overall mood, colour scheme, materials, lighting and furniture style',
  },
  {
    id: 'flooring',
    label: 'Flooring',
    hint: 'A close-up of a floor material: tiles, wood, stone or concrete.',
    controls: ['flooring'],
    aiInstruction: 'use its material, colour, pattern and finish for the floor only',
  },
  {
    id: 'kitchen',
    label: 'Kitchen',
    hint: 'A kitchen you like. Sets cabinets, worktops and splashback.',
    controls: ['cabinets'],
    aiInstruction:
      'use its cabinet, worktop and splashback style for the kitchen joinery only',
  },
  {
    id: 'palette',
    label: 'Colour palette',
    hint: 'A palette, swatch card or any image whose colours you like.',
    controls: ['walls', 'furniture', 'cabinets'],
    aiInstruction: 'use its colours for wall paint, accents and soft furnishings',
  },
  {
    id: 'furniture',
    label: 'Furniture',
    hint: 'A sofa, bed or furniture set you like.',
    controls: ['furniture'],
    aiInstruction: 'use its furniture style, shapes and upholstery for the furniture only',
  },
];

/** Elements of a finished space that can be edited one at a time. */
export const ELEMENTS = [
  { id: 'flooring', label: 'Flooring' },
  { id: 'walls', label: 'Walls & paint' },
  { id: 'ceiling', label: 'Ceiling' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'fixtures', label: 'Fixtures' },
  { id: 'cabinets', label: 'Cabinets & vanity' },
  { id: 'furniture', label: 'Furniture' },
];

/** Preset styles offered when there are no reference images. */
export const STYLE_PRESETS = [
  {
    id: 'minimalist',
    name: 'Modern minimalist',
    description:
      'clean lines, warm white walls, large-format light grey porcelain floor, hidden cove lighting, matte black details, low-profile grey and oak furniture, almost no clutter',
    swatches: ['#eeebe6', '#c9c7c2', '#8d8a85', '#2b2b2b', '#c8a97e'],
  },
  {
    id: 'scandinavian',
    name: 'Scandinavian',
    description:
      'soft white walls, light oak plank floor, bright warm daylight feel, oatmeal and sage textiles, light wood furniture with rounded edges, plants and natural textures',
    swatches: ['#f4f1ea', '#d9c3a0', '#a9b59a', '#e6d5c3', '#5b5b55'],
  },
  {
    id: 'luxury',
    name: 'Luxury contemporary',
    description:
      'greige walls with a marble or fluted feature wall, polished white marble floor, layered warm lighting with a cove ceiling, brushed brass fixtures, deep velvet upholstery and walnut',
    swatches: ['#d9d2c7', '#f2efe9', '#1f3a4d', '#b08d57', '#5a3e2b'],
  },
  {
    id: 'indian',
    name: 'Indian modern',
    description:
      'warm ivory walls with a terracotta accent wall, patterned cement-tile floor, teak wood and cane furniture, brass fixtures, mustard, teal and terracotta textiles, warm lighting',
    swatches: ['#f2e8d8', '#c0603e', '#d9a441', '#2f6f6b', '#7a4a2a'],
  },
  {
    id: 'industrial',
    name: 'Industrial loft',
    description:
      'exposed brick feature wall, concrete grey walls, polished concrete floor, dark open ceiling, black steel fixtures, Edison bulb pendants, cognac leather and reclaimed wood furniture',
    swatches: ['#b9b6b0', '#8e4b32', '#3a3a3a', '#a0673d', '#d8d4cc'],
  },
];

export const MAX_REFERENCES = 5;
export const MAX_PHOTOS = 12;

export const roomLabel = (id) => ROOM_TYPES.find((r) => r.id === id)?.label ?? 'Room';
export const roleById = (id) => REFERENCE_ROLES.find((r) => r.id === id);
export const elementLabel = (id) => ELEMENTS.find((e) => e.id === id)?.label ?? id;
export const presetById = (id) => STYLE_PRESETS.find((s) => s.id === id) ?? STYLE_PRESETS[0];
