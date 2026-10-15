/**
 * Render orchestration: one entry point for "render this photo", whichever
 * engine is selected.
 *
 *  - local   : free in-browser renderer (localRenderer.js)
 *  - openai  : server -> OpenAI image edits   (paid)
 *  - gemini  : server -> Google Gemini images (paid)
 *
 * Both paths use the same style spec, so switching engine keeps the design.
 */
import { store, runtime, uid } from '../state.js';
import { presetById, roleById } from '../catalog.js';
import { resolveSpec, describeSpec } from './styles.js';
import { analyseReference, detectConflicts } from './references.js';
import { analysePhoto, renderFinish, elementMask } from './localRenderer.js';
import { canvasToBlob, toCanvas, blobToDataUrl, sampleImage } from '../lib/imageTools.js';
import { guessBackWall } from '../lib/geometry.js';

/** Stable small integer from a string (used as a render seed). */
export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}

/** References that can be used (readable, not blocked by quality errors). */
export function usableReferences() {
  return store.project.references.filter((r) => !r.quality?.errors?.length || r.useAnyway);
}

/** References with their analysis attached (analysed on first use). */
export async function analysedReferences() {
  const refs = usableReferences();
  const out = [];
  for (const ref of refs) {
    if (!runtime.references.has(ref.id)) {
      const bmp = await runtime.bitmap(ref);
      runtime.references.set(ref.id, analyseReference(bmp));
    }
    out.push({ ...ref, analysis: runtime.references.get(ref.id) });
  }
  return out;
}

/** Key describing every input of a render; a different key means "out of date". */
export function settingsKey(photo) {
  const p = store.project;
  return JSON.stringify({
    style: p.styleId,
    engine: p.engine,
    room: photo.roomType,
    fit: photo.fit,
    refs: usableReferences().map((r) => [r.id, r.role, r.label]),
    overrides: Object.entries(photo.overrides).map(([k, v]) => [k, JSON.stringify(v)]),
  });
}

/** Cached photo analysis for the current fit and room type. */
export async function photoAnalysis(photo, maxSide = 1600, options = {}) {
  const base = `${photo.id}|${JSON.stringify(photo.fit)}|${photo.roomType}`;
  const key = `${base}|${maxSide}|${options.pad ?? 0}`;
  if (!runtime.analyses.has(key)) {
    // Drop analyses made with an older room box or room type.
    for (const k of [...runtime.analyses.keys()]) if (k.startsWith(photo.id) && !k.startsWith(base)) runtime.analyses.delete(k);
    const bmp = await runtime.bitmap(photo);
    runtime.analyses.set(key, analysePhoto(bmp, photo.fit, photo.roomType, maxSide, options));
  }
  return runtime.analyses.get(key);
}

/** Copy of a spec that can be stored (image-based materials become plain colours). */
function storableSpec(spec) {
  const plain = (m) => (m?.type === 'image' ? { type: 'paint', base: m.base ?? '#a07a55', size: 1 } : m);
  return JSON.parse(JSON.stringify({
    ...spec,
    flooring: { ...spec.flooring, material: plain(spec.flooring.material) },
  }));
}

/** Tries to find the far wall automatically for a newly added photo. */
export function autoFit(bitmap, fit) {
  const { lum, width, height } = sampleImage(bitmap, 400);
  const back = guessBackWall(lum, width, height);
  if (!back) return { ...fit, auto: false };
  const vp = { x: Math.min(back.x1 - 0.02, Math.max(back.x0 + 0.02, 0.5)), y: Math.min(back.y1 - 0.02, Math.max(back.y0 + 0.02, 0.5)) };
  return { ...fit, back, vp, auto: true };
}

/** Full spec + references used + warnings for a photo with current settings. */
export async function currentDesign(photo) {
  const refs = await analysedReferences();
  const { spec, used } = resolveSpec({ presetId: store.project.styleId, roomType: photo.roomType, references: refs, overrides: photo.overrides });
  const warnings = detectConflicts({ roomType: photo.roomType, aspect: photo.width / photo.height }, refs).map((w) => w.message);
  for (const c of photo.aiCheck?.conflicts ?? []) {
    const ref = refs[c.index - 1];
    if (ref) warnings.push(`AI check - "${ref.label}": ${c.message}`);
  }
  return { spec, used, refs, warnings };
}

/**
 * Renders a photo and stores the result as a new render record.
 * @param {object} photo
 * @param {{element?: string, note?: string, onStatus?: (text: string) => void}} options
 *   element: when set, only that element changed (single-element edit).
 */
export async function renderPhoto(photo, { element = null, note = '', onStatus = () => {} } = {}) {
  const project = store.project;
  const engine = project.engine;
  const preset = presetById(project.styleId);
  const { spec, used, refs, warnings } = await currentDesign(photo);
  const elements = describeSpec(spec, photo.roomType);
  const started = performance.now();
  let blob;
  let finishBlob = null;
  let plan = null;
  let model = 'Free preview';

  if (engine === 'local') {
    onStatus('Reading the room…');
    await nextFrame();
    const an = await photoAnalysis(photo);
    onStatus('Applying finishes and furniture…');
    await nextFrame();
    const seed = hashString(photo.id);
    const result = renderFinish(an, spec, { seed, styleHint: preset.id });
    blob = await canvasToBlob(result.image, 'image/jpeg', 0.9);
    // Wider, furniture-free version of the finishes for the 3D house.
    onStatus('Preparing the 3D textures…');
    await nextFrame();
    const wide = await photoAnalysis(photo, 2048, { pad: 0.6, openings: an.openings });
    const finish = renderFinish(wide, spec, { seed, styleHint: preset.id, includeFurniture: false, plan: result.plan, gain: result.gain });
    finishBlob = await canvasToBlob(finish.finish, 'image/jpeg', 0.88);
    plan = { items: result.plan.items, openings: an.openings, room: pickRoom(wide.room), spec: storableSpec(spec), styleHint: preset.id, seed };
  } else {
    onStatus(`Sending to ${engine === 'openai' ? 'OpenAI' : 'Gemini'}… this can take up to a minute.`);
    // Single-element edits start from the render being viewed; full renders from the photo.
    const current = element ? currentRender(photo) : null;
    const baseBlob = current?.blob ?? photo.blob;
    const baseBitmap = await createImageBitmap(baseBlob);
    const baseCanvas = toCanvas(baseBitmap, 1536);
    const body = {
      provider: engine,
      base: await blobToDataUrl(await canvasToBlob(baseCanvas, 'image/jpeg', 0.9)),
      aspect: baseCanvas.width / baseCanvas.height,
      references: await Promise.all(
        refs.map(async (r) => ({
          label: r.label,
          role: r.role,
          image: await blobToDataUrl(await canvasToBlob(toCanvas(await runtime.bitmap(r), 768), 'image/jpeg', 0.85)),
        })),
      ),
      brief: {
        roomType: photo.roomType,
        styleName: refs.length ? `${preset.name}, adapted to the reference images` : preset.name,
        styleDescription: preset.description,
        elements,
        references: refs.map((r) => ({ label: r.label, role: r.role })),
        edit: element && current ? { element, description: elements[element] ?? '', note } : null,
        analysisBrief: photo.aiCheck?.styleBrief ?? '',
      },
    };
    // OpenAI accepts a mask that limits the change to one area of the image.
    if (element && current && engine === 'openai' && ['flooring', 'walls', 'ceiling'].includes(element)) {
      const an = await photoAnalysis(photo, 1024);
      const mask = toCanvas(elementMask(an, element), Infinity);
      const scaled = document.createElement('canvas');
      scaled.width = baseCanvas.width;
      scaled.height = baseCanvas.height;
      scaled.getContext('2d').drawImage(mask, 0, 0, scaled.width, scaled.height);
      body.mask = await blobToDataUrl(await canvasToBlob(scaled, 'image/png'));
    }
    const response = await fetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {
      throw new Error('Could not reach the app server. Is it still running?');
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error ?? `The render failed (HTTP ${response.status}).`);
    blob = await (await fetch(json.image)).blob();
    model = json.model;
  }

  const render = {
    id: uid(),
    photoId: photo.id,
    blob,
    finishBlob,
    plan,
    engine,
    model,
    styleId: preset.id,
    styleName: preset.name,
    roomType: photo.roomType,
    referencesUsed: engine === 'local'
      ? used
      : refs.map((r) => ({ id: r.id, label: r.label, role: r.role, effect: `sent to the AI as ${roleById(r.role).label.toLowerCase()} reference` })),
    warnings,
    elements,
    element,
    key: settingsKey(photo),
    seconds: Math.round((performance.now() - started) / 100) / 10,
    createdAt: Date.now(),
    saved: false,
  };
  store.update((p) => p.renders.push(render), 'render');
  store.ui.renderId[photo.id] = render.id;
  return render;
}

/** The render currently shown for a photo (latest by default). */
export function currentRender(photo) {
  const renders = store.project.renders.filter((r) => r.photoId === photo.id);
  const chosen = renders.find((r) => r.id === store.ui.renderId[photo.id]);
  return chosen ?? renders.at(-1) ?? null;
}

/** Runs the optional AI reference check (Claude) for a photo. */
export async function runAiReferenceCheck(photo) {
  const refs = usableReferences();
  const photoCanvas = toCanvas(await runtime.bitmap(photo), 1024);
  const body = {
    roomType: photo.roomType,
    photo: await blobToDataUrl(await canvasToBlob(photoCanvas, 'image/jpeg', 0.85)),
    references: await Promise.all(
      refs.map(async (r) => ({
        label: r.label,
        role: r.role,
        image: await blobToDataUrl(await canvasToBlob(toCanvas(await runtime.bitmap(r), 768), 'image/jpeg', 0.85)),
      })),
    ),
  };
  const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error ?? 'The AI reference check failed.');
  store.update(() => {
    photo.aiCheck = { ...json, at: Date.now() };
  });
  return json;
}

const pickRoom = (room) => ({
  width: room.width, height: room.height, f: room.f, cx: room.cx, cy: room.cy, eyeY: room.eyeY,
  depth: room.depth, ceiling: room.ceiling, xL: room.xL, xR: room.xR, roomWidth: room.roomWidth,
});

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
