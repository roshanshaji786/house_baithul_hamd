/**
 * Smaller panels: preset style picker, saved-renders gallery, the project
 * bar, the render-engine selector and the tabs.
 */
import { store, runtime } from '../state.js';
import { STYLE_PRESETS, roomLabel, roleById } from '../catalog.js';
import { usableReferences } from '../render/engine.js';
import { $, $$, h, toast, downloadBlob, slug } from './dom.js';

// ---------------------------------------------------------------------------
// Preset styles
// ---------------------------------------------------------------------------
function renderStylePicker() {
  const grid = $('#style-grid');
  const hasRefs = usableReferences().length > 0;
  $('#preset-title').textContent = hasRefs ? 'Base style' : 'Preset style';
  $('#preset-help').textContent = hasRefs
    ? 'Your reference images lead. The base style fills in anything they do not cover (for example furniture shapes or ceiling type).'
    : 'No reference images? Pick a look for your space.';
  grid.replaceChildren(
    ...STYLE_PRESETS.map((s) => h('button', {
      type: 'button', role: 'radio', class: 'style-card', 'aria-checked': String(store.project.styleId === s.id), title: s.description,
      onclick: () => store.update((p) => { p.styleId = s.id; }),
    },
    h('span', { class: 'swatches', 'aria-hidden': 'true' }, s.swatches.map((c) => h('span', { style: { background: c } }))),
    h('strong', {}, s.name))),
  );
}

// ---------------------------------------------------------------------------
// Saved gallery
// ---------------------------------------------------------------------------
function renderGallery() {
  const saved = store.project.renders.filter((r) => r.saved);
  $('#saved-count').textContent = saved.length;
  const gallery = $('#gallery');
  if (!saved.length) {
    gallery.replaceChildren(h('p', { class: 'muted' }, 'Nothing saved yet. Press "Save" under a render to keep it here.'));
    return;
  }
  gallery.replaceChildren(
    ...saved.slice().reverse().map((r) => {
      const photo = store.project.photos.find((p) => p.id === r.photoId);
      const name = photo?.name ?? 'Removed photo';
      return h('figure', {},
        h('img', { src: runtime.url(r.blob), alt: `${name}, ${r.styleName}` }),
        h('figcaption', {},
          h('strong', {}, name),
          h('span', { class: 'muted' }, `${roomLabel(r.roomType)} · ${r.styleName} · ${r.engine === 'local' ? 'Free preview' : r.model}`),
          r.referencesUsed.length
            ? h('span', { class: 'small' }, 'References: ', r.referencesUsed.filter((u) => !u.skipped).map((u) => `${u.label} (${roleById(u.role)?.label.toLowerCase()})`).join(', '))
            : h('span', { class: 'small muted' }, 'No references (preset style)'),
          h('div', { class: 'actions' },
            h('button', { type: 'button', class: 'btn small secondary', onclick: () => downloadBlob(r.blob, `${slug(name)}-${slug(r.styleName)}.jpg`) }, 'Download'),
            photo ? h('button', {
              type: 'button', class: 'btn small secondary',
              onclick: () => {
                store.ui.renderId[photo.id] = r.id;
                store.setUi({ photoId: photo.id, tab: 'design' }, 'tab');
              },
            }, 'Open') : null,
            h('button', { type: 'button', class: 'btn small secondary', onclick: () => store.update(() => { r.saved = false; }, 'saved') }, 'Remove'),
          ),
        ),
      );
    }),
  );
}

// ---------------------------------------------------------------------------
// Project bar and engine selector
// ---------------------------------------------------------------------------
function renderProjectBar() {
  const select = $('#project-select');
  const list = store.projects.some((p) => p.id === store.project.id) ? store.projects : [{ id: store.project.id, name: store.project.name }, ...store.projects];
  select.replaceChildren(...list.map((p) => h('option', { value: p.id, selected: p.id === store.project.id }, p.id === store.project.id ? store.project.name : p.name)));

  const engine = $('#engine-select');
  const providers = store.config.providers;
  engine.replaceChildren(
    ...Object.entries(providers).map(([id, p]) => h('option', { value: id, selected: store.project.engine === id, disabled: !p.available },
      `${p.label ?? id}${p.available ? '' : ' - needs API key'}`)),
  );
}

function renderTabs() {
  $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === store.ui.tab)));
  $('#tab-design').hidden = store.ui.tab !== 'design';
  $('#tab-house').hidden = store.ui.tab !== 'house';
  $('#tab-saved').hidden = store.ui.tab !== 'saved';
}

export function initPanels() {
  $('#project-select').addEventListener('change', (e) => store.switchProject(e.target.value));
  $('#project-new').addEventListener('click', async () => {
    const name = prompt('Name for the new project', 'My house');
    if (name) await store.createProject(name.trim().slice(0, 60));
  });
  $('#project-rename').addEventListener('click', () => {
    const name = prompt('Rename project', store.project.name);
    if (name) store.update((p) => { p.name = name.trim().slice(0, 60); });
  });
  $('#project-delete').addEventListener('click', async () => {
    if (confirm(`Delete "${store.project.name}" with all its photos and renders? This cannot be undone.`)) await store.deleteProject();
  });
  $('#engine-select').addEventListener('change', (e) => {
    store.update((p) => { p.engine = e.target.value; });
    if (e.target.value !== 'local') toast('AI engines are paid services. Each render sends your photo and references to that provider.', 'info', 7000);
  });
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => store.setUi({ tab: b.dataset.tab }, 'tab')));
  $('#disclaimer-hide').addEventListener('click', () => {
    $('#disclaimer').hidden = true;
    try { localStorage.setItem('hideDisclaimer', '1'); } catch { /* storage unavailable */ }
  });
  try { $('#disclaimer').hidden = localStorage.getItem('hideDisclaimer') === '1'; } catch { /* ignore */ }

  const render = () => {
    renderStylePicker();
    renderGallery();
    renderProjectBar();
    renderTabs();
  };
  store.on((reason) => {
    if (reason === 'storage-error') toast('Could not save to browser storage (it may be full). Download renders you want to keep.', 'error', 8000);
    render();
  });
  render();
}
