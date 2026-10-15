/**
 * The main workspace for the selected photo: render button, before/after
 * viewer, room box fitting, render details (references used, warnings,
 * finishes), saving/downloading and the render history.
 */
import { store, runtime } from '../state.js';
import { ROOM_TYPES, roleById, elementLabel } from '../catalog.js';
import { solveRoom, describeRoomSize } from '../lib/geometry.js';
import { renderPhoto, currentRender, settingsKey, autoFit, runAiReferenceCheck, currentDesign } from '../render/engine.js';
import { compareView, comparisonImage } from './compare.js';
import { fitEditor } from './fitEditor.js';
import { renderElementEditor } from './elementEditor.js';
import { $, $$, h, toast, downloadBlob, slug } from './dom.js';

let autoTimer = null;

/** Runs a render for the selected photo with progress and error handling. */
export async function runRender(options = {}) {
  const photo = store.photo;
  if (!photo || store.ui.busy) return;
  if (photo.quality?.errors?.length && !photo.useAnyway) {
    toast('This photo has a problem (see the photo list). Fix it or choose "Use it anyway".', 'error');
    return;
  }
  $('#render-error').hidden = true;
  store.setUi({ busy: { photoId: photo.id, label: 'Starting…' }, fitting: false });
  try {
    await renderPhoto(photo, {
      ...options,
      onStatus: (label) => {
        store.ui.busy = { photoId: photo.id, label };
        $('#progress-text').textContent = label;
      },
    });
  } catch (error) {
    console.error(error);
    const box = $('#render-error');
    box.textContent = error.message || 'The render failed. Please try again.';
    box.hidden = false;
  } finally {
    store.setUi({ busy: null });
  }
}

function renderToolbar(photo) {
  const roomSelect = $('#room-type');
  roomSelect.replaceChildren(...ROOM_TYPES.map((r) => h('option', { value: r.id, selected: r.id === photo?.roomType }, r.label)));
  roomSelect.disabled = !photo;
  $('#workspace-photo-name').textContent = photo ? photo.name : 'Your finished space';
  $('#render-btn').disabled = !photo || Boolean(store.ui.busy);
  $('#render-btn').textContent = store.ui.busy ? 'Rendering…' : currentRender(photo ?? {}) ? 'Render again' : 'Render';
  $('#fit-toggle').disabled = !photo;
  $('#fit-toggle').setAttribute('aria-pressed', String(store.ui.fitting));
  $('#fit-toggle').textContent = store.ui.fitting ? 'Close room box' : 'Adjust room box';
  $('#room-size').textContent = photo
    ? `Estimated room: ${describeRoomSize(solveRoom(photo.fit, photo.width, photo.height))}${photo.fit.auto ? ' (far wall detected automatically)' : ''}`
    : '';
}

let emptyState = null; // the "add a photo" message, kept so it can be re-attached

function renderViewer(photo, render) {
  const viewer = $('#viewer');
  emptyState ??= $('#viewer-empty');
  const empty = emptyState;
  if (!photo) {
    viewer.replaceChildren(empty);
    empty.hidden = false;
    $('#viewer-controls').hidden = true;
    return;
  }
  const photoUrl = runtime.url(photo.blob);
  if (store.ui.fitting) {
    viewer.replaceChildren(fitEditor(photoUrl, photo, {
      onChange: (fit) => {
        photo.fit = fit; // mutate without re-rendering while dragging
        store.scheduleSave();
      },
      onDone: () => {
        store.ui.fitting = false;
        store.update(() => {}, 'project'); // re-renders (and auto-updates) with the new box
      },
      onAuto: async () => {
        const fit = autoFit(await runtime.bitmap(photo), photo.fit);
        if (!fit.auto) toast('Could not find the far wall automatically. Please drag the corners.', 'error');
        store.update(() => { photo.fit = fit; });
        store.setUi({ fitting: true });
      },
    }));
    $('#viewer-controls').hidden = true;
    return;
  }
  if (!render) {
    viewer.replaceChildren(h('img', { src: photoUrl, alt: `Unfinished photo: ${photo.name}`, style: { width: '100%' } }));
    $('#viewer-controls').hidden = true;
    return;
  }
  viewer.replaceChildren(compareView(photoUrl, runtime.url(render.blob), store.ui.compareMode));
  $('#viewer-controls').hidden = false;
  $$('[data-compare]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.compare === store.ui.compareMode)));
  $('#save-btn').textContent = render.saved ? '★ Saved' : 'Save';
  $('#save-btn').setAttribute('aria-pressed', String(Boolean(render.saved)));
}

function renderInfo(photo, render) {
  const box = $('#render-info');
  if (!photo || !render || store.ui.fitting) {
    box.replaceChildren();
    return;
  }
  const refs = store.project.references;
  const chips = render.referencesUsed.length
    ? render.referencesUsed.map((u) => {
        const ref = refs.find((r) => r.id === u.id);
        return h('span', { class: `chip${u.skipped ? ' skipped' : ''}`, title: u.effect },
          ref ? h('img', { src: runtime.url(ref.blob), alt: '' }) : null,
          h('span', {}, h('strong', {}, u.label), ` · ${roleById(u.role)?.label ?? u.role}: ${u.effect}`));
      })
    : [h('span', { class: 'muted small' }, `No reference images: preset style "${render.styleName}".`)];

  box.replaceChildren(...[
    h('div', { class: 'small muted' },
      `${render.engine === 'local' ? 'Free preview' : render.model} · ${render.styleName}${render.element ? ` · changed: ${elementLabel(render.element)}` : ''} · ${new Date(render.createdAt).toLocaleString()}${render.seconds ? ` · ${render.seconds}s` : ''}`),
    h('div', {}, h('strong', { class: 'small' }, 'References used: '), h('div', { class: 'chips' }, chips)),
    render.warnings.length
      ? h('div', { class: 'warnings' },
          render.warnings.map((w) => h('div', { class: 'issue warn' }, '⚠ ', w)),
          h('div', { class: 'small muted' }, 'The layout from your photo was kept in every case.'))
      : null,
    h('details', {},
      h('summary', { class: 'small' }, 'Finishes in this render'),
      h('dl', { class: 'spec-list' }, Object.entries(render.elements).flatMap(([k, v]) => [h('dt', {}, elementLabel(k)), h('dd', {}, v)]))),
  ].filter(Boolean));
}

function renderHistory(photo, render) {
  const box = $('#history');
  const renders = photo ? store.project.renders.filter((r) => r.photoId === photo.id) : [];
  if (renders.length < 2) {
    box.replaceChildren();
    return;
  }
  box.replaceChildren(
    ...renders.map((r) => h('button', {
      type: 'button', 'aria-current': String(r.id === render?.id), title: `${r.styleName}${r.element ? ` (changed ${elementLabel(r.element)})` : ''}`,
      onclick: () => {
        store.ui.renderId[photo.id] = r.id;
        store.emit('ui');
      },
    }, h('img', { src: runtime.url(r.blob), alt: '' }), h('span', {}, r.element ? `${elementLabel(r.element)} edit` : r.styleName))),
  );
}

/** Shows "out of date" and re-renders automatically for the free engine. */
function renderStale(photo, render, reason) {
  const banner = $('#stale-banner');
  const stale = Boolean(photo && render && render.key !== settingsKey(photo));
  banner.hidden = !stale || Boolean(store.ui.busy);
  $('#auto-update').checked = store.ui.autoUpdate;
  const autoAllowed = store.project.engine === 'local' && store.ui.autoUpdate;
  if (stale && autoAllowed && !store.ui.busy && !store.ui.fitting && ['project', 'references'].includes(reason)) {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => runRender(), 350);
  }
}

function render(reason) {
  const photo = store.photo;
  const current = photo ? currentRender(photo) : null;
  renderToolbar(photo);
  if (reason !== 'progress') renderViewer(photo, current);
  renderInfo(photo, current);
  renderHistory(photo, current);
  renderStale(photo, current, reason);
  $('#progress').hidden = !store.ui.busy;
  if (store.ui.busy) $('#progress-text').textContent = store.ui.busy.label;
  if (['project', 'references', 'project-switch', 'ui', 'render', 'init'].includes(reason)) renderElementEditor((element, note) => runRender({ element, note }));
}

export function initWorkspace() {
  $('#render-btn').addEventListener('click', () => runRender());
  $('#stale-update').addEventListener('click', () => runRender());
  $('#auto-update').addEventListener('change', (e) => store.setUi({ autoUpdate: e.target.checked }));
  $('#room-type').addEventListener('change', (e) => {
    const photo = store.photo;
    if (photo) store.update(() => { photo.roomType = e.target.value; });
  });
  $('#fit-toggle').addEventListener('click', () => store.setUi({ fitting: !store.ui.fitting }));
  $$('[data-compare]').forEach((b) => b.addEventListener('click', () => store.setUi({ compareMode: b.dataset.compare })));

  $('#save-btn').addEventListener('click', () => {
    const r = currentRender(store.photo);
    if (!r) return;
    store.update(() => { r.saved = !r.saved; }, 'saved');
    toast(r.saved ? 'Saved to this project (see the Saved tab).' : 'Removed from saved renders.');
  });
  $('#download-btn').addEventListener('click', () => {
    const photo = store.photo;
    const r = currentRender(photo);
    if (r) downloadBlob(r.blob, `${slug(photo.name)}-${slug(r.styleName)}-finished.jpg`);
  });
  $('#download-compare-btn').addEventListener('click', async () => {
    const photo = store.photo;
    const r = currentRender(photo);
    if (!r) return;
    const blob = await comparisonImage(photo.blob, r.blob, `${photo.name} · ${r.styleName}`);
    downloadBlob(blob, `${slug(photo.name)}-before-after.jpg`);
  });
  $('#ai-check').addEventListener('click', async () => {
    const photo = store.photo;
    if (!photo) return;
    const btn = $('#ai-check');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      const result = await runAiReferenceCheck(photo);
      toast(result.conflicts.length ? `AI check found ${result.conflicts.length} conflict(s). They are listed with the render.` : 'AI check: no layout or scale conflicts found.');
      if (result.photoIssue) toast(`AI check about your photo: ${result.photoIssue}`, 'error', 8000);
      await currentDesign(photo);
    } catch (error) {
      toast(error.message, 'error', 8000);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Check references with AI';
    }
  });

  store.on(render);
  render('init');
}
