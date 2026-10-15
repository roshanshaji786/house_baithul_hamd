/**
 * Builds the text instructions sent to AI image models.
 *
 * The browser sends a "brief" describing what each element of the finished
 * space should look like (these descriptions come from the same style spec
 * that drives the free in-browser renderer), plus the reference images and
 * their roles. This module turns that into one clear prompt.
 */
import { ELEMENTS, REFERENCE_ROLES, roomLabel, roleById, elementLabel } from '../public/js/catalog.js';

const ELEMENT_IDS = new Set(ELEMENTS.map((e) => e.id));
const ROLE_IDS = new Set(REFERENCE_ROLES.map((r) => r.id));

/** Rules that apply to every request: protect the layout, no brands, no text. */
const LAYOUT_RULES = [
  'Keep the exact camera position, angle, lens and perspective of the FIRST image.',
  'Keep the room geometry exactly: wall positions, ceiling height, room size, columns, beams, stairs, and every window and door opening stay where they are with the same size.',
  'Do not add or remove windows, doors or walls. Do not change the view outside the windows.',
  'If a reference image has a different layout, size or camera angle, ignore its layout and use it for style only.',
  'Do not reproduce logos, brand names, trademarked products, text or watermarks.',
  'The result must look like a real photograph of a finished, liveable home, not a 3D model or drawing.',
];

/**
 * Sanitises the brief coming from the browser so a malformed request cannot
 * inject unexpected structure into the prompt.
 */
export function normaliseBrief(raw = {}) {
  const clean = (value, max = 400) =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

  const elements = {};
  for (const [key, value] of Object.entries(raw.elements ?? {})) {
    if (ELEMENT_IDS.has(key) && clean(value)) elements[key] = clean(value);
  }

  const references = Array.isArray(raw.references)
    ? raw.references.slice(0, 5).map((ref, index) => ({
        label: clean(ref?.label, 80) || `Reference ${index + 1}`,
        role: ROLE_IDS.has(ref?.role) ? ref.role : 'style',
      }))
    : [];

  const edit =
    raw.edit && ELEMENT_IDS.has(raw.edit.element)
      ? {
          element: raw.edit.element,
          description: clean(raw.edit.description),
          note: clean(raw.edit.note, 300),
        }
      : null;

  return {
    roomType: clean(raw.roomType, 20) || 'living',
    styleName: clean(raw.styleName, 80) || 'Modern',
    styleDescription: clean(raw.styleDescription, 600),
    elements,
    references,
    edit,
    analysisBrief: clean(raw.analysisBrief, 800),
  };
}

/** Lists the reference images (numbered from 2, the photo is image 1). */
function describeReferences(references, startIndex = 2) {
  return references.map((ref, i) => {
    const role = roleById(ref.role);
    return `- Image ${i + startIndex} "${ref.label}" (role: ${role.label}): ${role.aiInstruction}.`;
  });
}

/**
 * Prompt for a full render: unfinished photo (+ references) -> finished space.
 * @param {ReturnType<typeof normaliseBrief>} brief
 */
export function buildRenderPrompt(brief) {
  const room = roomLabel(brief.roomType).toLowerCase();
  const isExterior = brief.roomType === 'exterior';
  const lines = [];

  lines.push(
    isExterior
      ? 'The FIRST image is a photo of an unfinished house exterior (bare blockwork, exposed concrete or brick, unfinished ground).'
      : `The FIRST image is a photo of an unfinished ${room} (bare walls, exposed concrete or brick, unfinished floor, open ceiling).`,
  );
  lines.push(
    isExterior
      ? 'Create a photorealistic image of the SAME house fully finished: rendered and painted facade, cladding, window frames, landscaping, paving and outdoor lighting.'
      : `Create a photorealistic image of the SAME ${room} fully finished and furnished as a modern home.`,
  );

  lines.push('', 'Layout rules (most important):', ...LAYOUT_RULES.map((r) => `- ${r}`));

  lines.push('', `Style: ${brief.styleName}${brief.styleDescription ? ` - ${brief.styleDescription}` : ''}.`);
  if (brief.analysisBrief) lines.push(`Style notes from the reference check: ${brief.analysisBrief}`);

  if (brief.references.length) {
    lines.push('', 'Reference images (style only, never copy their layout):', ...describeReferences(brief.references));
    lines.push('Where a reference controls an element, it takes priority over the written description of that element.');
  }

  const elementLines = ELEMENTS.filter((e) => brief.elements[e.id]).map(
    (e) => `- ${e.label}: ${brief.elements[e.id]}`,
  );
  if (elementLines.length) lines.push('', 'Finish every element:', ...elementLines);

  return lines.join('\n');
}

/**
 * Prompt for changing a single element of an existing render.
 * The FIRST image is the current render, not the unfinished photo.
 */
export function buildEditPrompt(brief) {
  const { element, description, note } = brief.edit;
  const label = elementLabel(element).toLowerCase();
  const lines = [
    'The FIRST image is a photorealistic render of a finished space.',
    `Change ONLY the ${label}${description ? ` to: ${description}` : ''}.`,
  ];
  if (note) lines.push(`Extra instruction from the homeowner: ${note}`);
  lines.push(
    `Everything that is not part of the ${label} must stay pixel-for-pixel the same: camera, layout, walls, windows, furniture, lighting and colours.`,
    ...LAYOUT_RULES.slice(3).map((r) => `- ${r}`),
  );
  if (brief.references.length) {
    lines.push('', 'Reference images (style only):', ...describeReferences(brief.references));
  }
  return lines.join('\n');
}
