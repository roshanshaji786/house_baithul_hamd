/**
 * Upload panels: photos of the unfinished space and reference images.
 * Handles drag-and-drop, thumbnails, image quality checks, room types and
 * reference roles.
 */
import { store, runtime, newPhoto, uid } from '../state.js';
import { ROOM_TYPES, REFERENCE_ROLES, MAX_REFERENCES, MAX_PHOTOS, roleById } from '../catalog.js';
import { decodeImage, ImageLoadError, toCanvas, canvasToBlob, sampleImage, measureQuality, judgeQuality } from '../lib/imageTools.js';
import { defaultFit } from '../lib/geometry.js';
import { autoFit } from '../render/engine.js';
import { $, h, toast, dropzone } from './dom.js';

const STORE_MAX_SIDE = 2400; // photos are stored at most this large

/** Decodes, checks and normalises an uploaded file. */
async function ingest(file, kind) {
  const bitmap = await decodeImage(file);
  const { lum, width, height } = sampleImage(bitmap, 512);
  const stats = measureQuality(lum, width, height);
  const quality = { ...judgeQuality(stats, bitmap.width, bitmap.height, kind), stats };
  const canvas = toCanvas(bitmap, STORE_MAX_SIDE);
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
  return { bitmap, blob, quality, width: canvas.width, height: canvas.height };
}

/** Guesses a room type from a file name ("kitchen-1.jpg" -> kitchen). */
function roomFromName(name) {
  const n = name.toLowerCase();
  if (/kitchen|cook/.test(n)) return 'kitchen';
  if (/bed/.test(n)) return 'bedroom';
  if (/bath|toilet|wash|shower/.test(n)) return 'bathroom';
  if (/ext|front|facade|outside|elevation/.test(n)) return 'exterior';
  return null;
}

export async function addPhotos(files) {
  const room = MAX_PHOTOS - store.project.photos.length;
  if (room <= 0) return toast(`A project can hold up to ${MAX_PHOTOS} photos. Remove one first.`, 'error');
  if (files.length > room) toast(`Only the first ${room} photo(s) were added (limit ${MAX_PHOTOS}).`);
  for (const file of files.slice(0, room)) {
    try {
      const { bitmap, blob, quality, width, height } = await ingest(file, 'photo');
      const fallbackRoom = store.photo?.roomType ?? 'living';
      const photo = newPhoto({
        name: file.name.replace(/\.[^.]+$/, ''),
        blob, width, height, quality,
        roomType: roomFromName(file.name) ?? fallbackRoom,
        fit: autoFit(bitmap, defaultFit()),
      });
      if (file.fit) photo.fit = file.fit; // sample photos come pre-fitted
      if (file.roomType) photo.roomType = file.roomType;
      store.update((p) => p.photos.push(photo));
      store.setUi({ photoId: photo.id });
      if (quality.errors.length) toast(`"${photo.name}": ${quality.errors[0]}`, 'error', 7000);
    } catch (error) {
      toast(error instanceof ImageLoadError ? error.message : `Could not add "${file.name}".`, 'error', 7000);
    }
  }
}

export async function addReferences(files) {
  const room = MAX_REFERENCES - store.project.references.length;
  if (room <= 0) return toast(`Up to ${MAX_REFERENCES} reference images per project. Remove one to add another.`, 'error');
  if (files.length > room) toast(`Only ${room} more reference(s) fit (limit ${MAX_REFERENCES}).`);
  for (const file of files.slice(0, room)) {
    try {
      const { blob, quality, width, height } = await ingest(file, 'reference');
      const name = file.name.replace(/\.[^.]+$/, '');
      const guess = /floor|tile|wood|marble|parquet/i.test(name) ? 'flooring'
        : /palette|colou?r|swatch/i.test(name) ? 'palette'
        : /kitchen/i.test(name) ? 'kitchen'
        : /sofa|chair|bed|furniture/i.test(name) ? 'furniture' : 'style';
      const ref = { id: uid(), name, label: name.slice(0, 40), role: file.role ?? guess, blob, width, height, quality, useAnyway: false };
      store.update((p) => p.references.push(ref));
      if (quality.errors.length) toast(`Reference "${name}": ${quality.errors[0]}`, 'error', 7000);
    } catch (error) {
      toast(error instanceof ImageLoadError ? error.message : `Could not add "${file.name}".`, 'error', 7000);
    }
  }
}

/** Loads the bundled sample photos (pre-fitted room boxes). */
export async function loadSamples() {
  const samples = [
    { file: 'sample-living.jpg', name: 'Living room (sample).jpg', roomType: 'living', fit: { back: { x0: 0.181, y0: 0.215, x1: 0.831, y1: 0.748 }, vp: { x: 0.5, y: 0.4833 }, lens: 'main', auto: false } },
    { file: 'sample-bedroom.jpg', name: 'Bedroom (sample).jpg', roomType: 'bedroom', fit: { back: { x0: 0.17, y0: 0.187, x1: 0.845, y1: 0.853 }, vp: { x: 0.5, y: 0.508 }, lens: 'main', auto: false } },
    { file: 'sample-kitchen.jpg', name: 'Kitchen (sample).jpg', roomType: 'kitchen', fit: { back: { x0: 0.204, y0: 0.142, x1: 0.944, y1: 0.871 }, vp: { x: 0.5, y: 0.5 }, lens: 'main', auto: false } },
    { file: 'sample-exterior.jpg', name: 'Front of house (sample).jpg', roomType: 'exterior', fit: { back: { x0: 0.047, y0: 0.03, x1: 0.953, y1: 0.755 }, vp: { x: 0.5, y: 0.58 }, lens: 'main', auto: false } },
  ];
  const files = [];
  for (const s of samples) {
    const blob = await (await fetch(`samples/${s.file}`)).blob();
    const file = new File([blob], s.name, { type: 'image/jpeg' });
    file.fit = s.fit;
    file.roomType = s.roomType;
    files.push(file);
  }
  await addPhotos(files);
  store.setUi({ photoId: store.project.photos.find((p) => p.name.startsWith('Living'))?.id ?? store.ui.photoId });
}

export async function loadSampleReferences() {
  const files = [];
  for (const [file, name, role] of [['ref-oak-floor.jpg', 'Oak floor sample.jpg', 'flooring'], ['ref-palette.jpg', 'Earthy palette.jpg', 'palette']]) {
    const blob = await (await fetch(`samples/${file}`)).blob();
    const f = new File([blob], name, { type: 'image/jpeg' });
    f.role = role;
    files.push(f);
  }
  await addReferences(files);
}

// ---------------------------------------------------------------------------
// Rendering the lists
// ---------------------------------------------------------------------------
function issues(quality, useAnyway, onUseAnyway) {
  const out = [];
  for (const e of quality?.errors ?? []) out.push(h('div', { class: 'issue error' }, e));
  if (quality?.errors?.length && !useAnyway) {
    out.push(h('button', { type: 'button', class: 'link-btn small', onclick: onUseAnyway }, 'Use it anyway'));
  }
  for (const w of quality?.warnings ?? []) out.push(h('div', { class: 'issue warn' }, w));
  return out;
}

function renderPhotoList() {
  const list = $('#photo-list');
  const { photos, renders } = store.project;
  list.replaceChildren(
    ...photos.map((photo) => {
      const blocked = photo.quality?.errors?.length && !photo.useAnyway;
      const rendered = renders.some((r) => r.photoId === photo.id);
      const select = () => store.setUi({ photoId: photo.id, fitting: false });
      return h('li', { class: `file-item${photo.id === store.ui.photoId ? ' selected' : ''}${blocked ? ' blocked' : ''}` },
        h('button', { type: 'button', class: 'thumb', onclick: select, 'aria-label': `Show ${photo.name}` }, h('img', { src: runtime.url(photo.blob), alt: '' })),
        h('div', { class: 'meta' },
          h('button', { type: 'button', class: 'name link-btn', style: { padding: 0, textAlign: 'left', color: 'inherit' }, onclick: select }, photo.name),
          h('div', { class: 'row' },
            h('select', {
              'aria-label': `Room type for ${photo.name}`,
              onchange: (e) => store.update(() => { photo.roomType = e.target.value; }),
            }, ROOM_TYPES.map((r) => h('option', { value: r.id, selected: r.id === photo.roomType }, r.label))),
            rendered ? h('span', { class: 'badge done' }, 'Rendered') : null,
            !photo.quality?.errors?.length && !photo.quality?.warnings?.length ? h('span', { class: 'badge ok' }, '✓ Clear') : null,
          ),
          issues(photo.quality, photo.useAnyway, () => store.update(() => { photo.useAnyway = true; })),
        ),
        h('button', {
          type: 'button', class: 'icon-btn', 'aria-label': `Remove ${photo.name}`, title: 'Remove',
          onclick: () => removePhoto(photo),
        }, '✕'),
      );
    }),
  );
}

function removePhoto(photo) {
  if (!confirm(`Remove "${photo.name}" and its renders (saved renders are kept)?`)) return;
  runtime.forget(photo.id);
  store.update((p) => {
    p.photos = p.photos.filter((x) => x.id !== photo.id);
    p.renders = p.renders.filter((r) => r.photoId !== photo.id || r.saved);
  });
  if (store.ui.photoId === photo.id) store.setUi({ photoId: store.project.photos[0]?.id ?? null });
}

function renderReferenceList() {
  const list = $('#ref-list');
  const refs = store.project.references;
  list.replaceChildren(
    ...refs.map((ref) => {
      const role = roleById(ref.role);
      return h('li', { class: `file-item${ref.quality?.errors?.length && !ref.useAnyway ? ' blocked' : ''}` },
        h('span', { class: 'thumb' }, h('img', { src: runtime.url(ref.blob), alt: '' })),
        h('div', { class: 'meta' },
          h('input', {
            type: 'text', value: ref.label, maxLength: 40, 'aria-label': 'Reference label',
            onchange: (e) => store.update(() => { ref.label = e.target.value.trim() || ref.name; }, 'references'),
          }),
          h('div', { class: 'row' },
            h('select', {
              'aria-label': `Role of ${ref.label}`,
              onchange: (e) => {
                runtime.references.delete(ref.id);
                store.update(() => { ref.role = e.target.value; }, 'references');
              },
            }, REFERENCE_ROLES.map((r) => h('option', { value: r.id, selected: r.id === ref.role }, r.label))),
          ),
          h('div', { class: 'role-hint' }, role.hint),
          issues(ref.quality, ref.useAnyway, () => store.update(() => { ref.useAnyway = true; }, 'references')),
        ),
        h('button', {
          type: 'button', class: 'icon-btn', 'aria-label': `Remove ${ref.label}`, title: 'Remove',
          onclick: () => {
            runtime.references.delete(ref.id);
            store.update((p) => { p.references = p.references.filter((r) => r.id !== ref.id); }, 'references');
          },
        }, '✕'),
      );
    }),
  );
  if (refs.length < MAX_REFERENCES) {
    list.append(h('li', { class: 'muted small' }, `${MAX_REFERENCES - refs.length} more reference${MAX_REFERENCES - refs.length === 1 ? '' : 's'} allowed. `,
      refs.length === 0 ? h('button', { type: 'button', class: 'link-btn small', onclick: loadSampleReferences }, 'Try sample references') : null));
  }
  $('#ai-check-box').hidden = !(store.config.analysis?.claude && refs.length && store.photo);
}

export function initUploads() {
  dropzone($('#photo-drop'), $('#photo-input'), addPhotos);
  dropzone($('#ref-drop'), $('#ref-input'), addReferences);
  $('#load-samples').addEventListener('click', loadSamples);
  const render = () => {
    renderPhotoList();
    renderReferenceList();
  };
  store.on(render);
  render();
}
