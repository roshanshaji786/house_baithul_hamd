/**
 * "Edit one element" panel. Changes are stored per photo as overrides of a
 * single element (see styles.applyOverrides) and re-rendered, so the rest
 * of the design stays exactly the same.
 */
import { store, runtime } from '../state.js';
import { ELEMENTS } from '../catalog.js';
import {
  FLOOR_OPTIONS, ACCENT_OPTIONS, TILE_OPTIONS, COUNTER_OPTIONS, METALS, PENDANTS, CEILING_TYPES, TEMPERATURES, colorName,
} from '../render/styles.js';
import { materialCanvas } from '../render/materials.js';
import { currentDesign, analysedReferences } from '../render/engine.js';
import { h } from './dom.js';

let selected = 'flooring';
let draft = null; // pending patch for the selected element
let draftPhotoId = null; // the photo the draft was started on

/** Small swatch canvas for a material option. */
const swatchCache = new Map();
function swatch(material) {
  const key = JSON.stringify(material);
  if (!swatchCache.has(key)) {
    const c = document.createElement('canvas');
    c.width = 220;
    c.height = 96;
    const src = materialCanvas(material, 3);
    const scale = Math.min(1, (material.size ?? 1) / 1.2);
    c.getContext('2d').drawImage(src, 0, 0, src.width * scale, src.height * scale * 0.44, 0, 0, 220, 96);
    swatchCache.set(key, c);
  }
  const copy = document.createElement('canvas');
  copy.width = 220;
  copy.height = 96;
  copy.getContext('2d').drawImage(swatchCache.get(key), 0, 0);
  return copy;
}

const row = (label, ...controls) => h('div', { class: 'form-row' }, h('label', {}, label), ...controls);

function colorInput(value, onInput, label) {
  // "change" (not "input") so the native picker is not rebuilt while it is open.
  return h('input', { type: 'color', value, 'aria-label': label, onchange: (e) => onInput(e.target.value) });
}

function select(options, value, onChange, label) {
  return h('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value) },
    options.map((o) => h('option', { value: o.id, selected: String(o.id) === String(value) }, o.label)));
}

function optionGrid(options, isSelected, onPick) {
  return h('div', { class: 'option-grid' },
    options.map((o) => h('button', { type: 'button', class: 'option', 'aria-pressed': String(isSelected(o)), onclick: () => onPick(o) },
      o.thumb ? h('img', { class: 'sw', src: o.thumb, alt: '', style: { objectFit: 'cover' } })
        : o.material ? swatch(o.material)
        : o.color ? h('span', { class: 'sw', style: { background: o.color } })
        : h('span', { class: 'sw', style: { background: 'var(--surface-2)' } }),
      o.label)));
}

/** Colours from the preset and the references, offered as quick picks. */
async function paletteSwatches(spec) {
  const refs = await analysedReferences();
  const colors = new Set([spec.walls.paint, spec.furniture?.upholstery, spec.furniture?.accent, spec.furniture?.accent2, spec.cabinets?.color].filter(Boolean));
  for (const r of refs) for (const c of r.analysis.palette.slice(0, 5)) colors.add(c.hex);
  return [...colors].slice(0, 14);
}

function swatchRow(colors, onPick) {
  return h('div', { class: 'swatch-row' }, colors.map((c) => h('button', { type: 'button', style: { background: c }, title: colorName(c), 'aria-label': colorName(c), onclick: () => onPick(c) })));
}

/** Builds the form for one element; `value` is the element's current spec. */
async function buildForm(element, value, spec, photo, rerender) {
  const set = (patch) => {
    draft = { ...(draft ?? {}), ...patch };
    rerender();
  };
  const v = { ...value, ...(draft ?? {}) };
  const exterior = photo.roomType === 'exterior';
  const colors = await paletteSwatches(spec);

  switch (element) {
    case 'flooring': {
      if (exterior) {
        return [row('Path paving colour', colorInput(v.material.base ?? '#cccccc', (c) => set({ material: { ...v.material, base: c }, name: 'Lawn with a paved path' }), 'Paving colour'))];
      }
      const refs = (await analysedReferences()).filter((r) => r.role === 'flooring');
      const options = [
        ...FLOOR_OPTIONS,
        ...refs.map((r) => ({ id: `ref-${r.id}`, label: `From "${r.label}"`, thumb: runtime.url(r.blob), refId: r.id })),
      ];
      return [optionGrid(
        options,
        (o) => (o.refId ? v.useReference === o.refId || v.fromReference === o.refId : !v.useReference && v.name === o.label),
        (o) => (o.refId ? set({ useReference: o.refId }) : set({ material: o.material, name: o.label, useReference: undefined, fromReference: undefined })),
      )];
    }
    case 'walls': {
      const out = [
        row(exterior ? 'Facade colour' : 'Paint colour', colorInput(v.paint, (c) => set({ paint: c }), 'Paint colour'), h('span', { class: 'small muted' }, colorName(v.paint))),
        swatchRow(colors, (c) => set({ paint: c })),
        row('Finish', select([{ id: 'paint', label: 'Smooth paint' }, { id: 'plaster', label: 'Limewash / textured plaster' }], v.finish, (f) => set({ finish: f }), 'Wall finish')),
      ];
      if (!exterior) {
        const accentId = ACCENT_OPTIONS.find((o) => o.label === v.accent?.name)?.id ?? 'none';
        out.push(row('Feature wall (far wall)', select(ACCENT_OPTIONS, accentId, (id) => {
          const o = structuredClone(ACCENT_OPTIONS.find((x) => x.id === id));
          set({ accent: o.material ? { material: o.material, name: o.label } : null });
        }, 'Feature wall')));
        if (v.accent?.material?.type === 'paint') {
          out.push(row('Feature colour', colorInput(v.accent.material.base, (c) => set({ accent: { ...v.accent, material: { ...v.accent.material, base: c } } }), 'Feature wall colour')));
        }
        if (photo.roomType === 'bathroom' || v.lower) {
          const lowerId = TILE_OPTIONS.find((o) => o.label === v.lower?.name)?.id ?? 'none';
          out.push(row('Wall tiles', select([{ id: 'none', label: 'No tiles' }, ...TILE_OPTIONS], lowerId, (id) => {
            const o = TILE_OPTIONS.find((x) => x.id === id);
            set({ lower: o ? { material: o.material, name: o.label, height: v.lower?.height ?? 2.1 } : null });
          }, 'Wall tiles')));
        }
      }
      return out;
    }
    case 'ceiling':
      if (exterior) {
        return [row('Sky', select([{ id: 'clear', label: 'Clear blue sky' }, { id: 'golden', label: 'Warm late afternoon' }], v.sky, (sky) => set({ sky }), 'Sky'))];
      }
      return [
        row('Type', select(CEILING_TYPES, v.type, (type) => set({ type }), 'Ceiling type')),
        row('Colour', colorInput(v.color, (c) => set({ color: c }), 'Ceiling colour'), h('span', { class: 'small muted' }, colorName(v.color))),
        v.type === 'slats' ? row('Slat wood', colorInput(v.wood ?? '#a87b52', (c) => set({ wood: c }), 'Slat colour')) : null,
      ];
    case 'lighting':
      return [
        row('Mood', select([{ id: 'day', label: 'Daylight' }, { id: 'evening', label: 'Evening, lamps on' }], v.mood, (mood) => set({ mood }), 'Mood')),
        row('Colour temperature', select(TEMPERATURES, v.temperature, (t) => set({ temperature: Number(t) }), 'Colour temperature')),
        exterior ? null : row('Recessed downlights', h('input', { type: 'checkbox', checked: v.downlights, onchange: (e) => set({ downlights: e.target.checked }) })),
        row('Brightness', h('input', { type: 'range', min: 0.7, max: 1.3, step: 0.05, value: v.level, 'aria-label': 'Brightness', onchange: (e) => set({ level: Number(e.target.value) }) })),
      ];
    case 'fixtures': {
      const metal = METALS.find((m) => m.id === v.metal) ?? METALS[0];
      return [
        row('Metal finish', select(METALS, metal.id, (id) => {
          const m = METALS.find((x) => x.id === id);
          set({ metal: m.id, metalColor: m.color, metalName: m.label });
        }, 'Metal finish')),
        exterior ? null : row('Pendant light', select(PENDANTS, v.pendant, (pendant) => set({ pendant }), 'Pendant light')),
        row('Window frames', colorInput(v.frames, (c) => set({ frames: c }), 'Window frame colour'), h('span', { class: 'small muted' }, colorName(v.frames))),
        row(exterior ? 'Front door' : 'Doors', colorInput(v.door, (c) => set({ door: c }), 'Door colour'), h('span', { class: 'small muted' }, colorName(v.door))),
        exterior ? null : row('Skirting boards', h('input', { type: 'checkbox', checked: Boolean(v.skirting), onchange: (e) => set({ skirting: e.target.checked ? spec.walls.paint : null }) })),
      ];
    }
    case 'cabinets': {
      const counter = COUNTER_OPTIONS.find((c) => c.label === v.counterName) ?? COUNTER_OPTIONS[0];
      const splashId = TILE_OPTIONS.find((o) => o.label === v.splash?.name)?.id ?? TILE_OPTIONS[0].id;
      const handle = METALS.find((m) => m.color === v.handles) ?? METALS[0];
      return [
        row(photo.roomType === 'bathroom' ? 'Vanity colour' : 'Cabinet colour', colorInput(v.color, (c) => set({ color: c }), 'Cabinet colour'), h('span', { class: 'small muted' }, colorName(v.color))),
        swatchRow(colors, (c) => set({ color: c })),
        row('Worktop', select(COUNTER_OPTIONS, counter.id, (id) => {
          const c = COUNTER_OPTIONS.find((x) => x.id === id);
          set({ counter: c.color, counterName: c.label });
        }, 'Worktop')),
        photo.roomType === 'kitchen' ? row('Splashback', select(TILE_OPTIONS, splashId, (id) => {
          const o = TILE_OPTIONS.find((x) => x.id === id);
          set({ splash: { material: o.material, name: o.label } });
        }, 'Splashback')) : null,
        row('Handles', select(METALS, handle.id, (id) => {
          const m = METALS.find((x) => x.id === id);
          set({ handles: m.color, handlesName: m.label });
        }, 'Handles')),
      ];
    }
    case 'furniture':
      return [
        row(exterior ? 'Planter colour' : 'Main fabric', colorInput(v.upholstery, (c) => set({ upholstery: c }), 'Main fabric colour'), h('span', { class: 'small muted' }, colorName(v.upholstery))),
        swatchRow(colors, (c) => set({ upholstery: c })),
        row('Accent colour', colorInput(v.accent, (c) => set({ accent: c }), 'Accent colour')),
        row('Second accent', colorInput(v.accent2 ?? v.accent, (c) => set({ accent2: c }), 'Second accent colour')),
        row('Wood tone', colorInput(v.wood, (c) => set({ wood: c }), 'Wood tone'), h('span', { class: 'small muted' }, colorName(v.wood))),
        row('Rug', select([{ id: 'border', label: 'Bordered' }, { id: 'stripes', label: 'Striped' }, { id: 'diamond', label: 'Kilim pattern' }, { id: 'plain', label: 'Plain' }], v.rugPattern, (rugPattern) => set({ rugPattern }), 'Rug pattern')),
        row('Amount of furniture', select([{ id: 'minimal', label: 'Minimal' }, { id: 'cosy', label: 'Cosy, more pieces' }], v.density, (density) => set({ density }), 'Amount of furniture')),
      ];
    default:
      return [];
  }
}

/**
 * Renders the editor for the selected photo.
 * @param {(element: string, note: string) => Promise<void>} onApply
 */
export async function renderElementEditor(onApply) {
  const tabs = document.getElementById('element-tabs');
  const form = document.getElementById('element-form');
  const photo = store.photo;
  if (!photo) {
    tabs.replaceChildren();
    form.replaceChildren(h('p', { class: 'muted small' }, 'Add a photo to edit its finishes.'));
    return;
  }
  const available = ELEMENTS.filter((e) => e.id !== 'cabinets' || ['kitchen', 'bathroom'].includes(photo.roomType));
  if (!available.some((e) => e.id === selected)) selected = 'flooring';
  // A draft belongs to the photo it was made on; switching photos discards it
  // so one photo's pending change is never applied to another.
  if (draftPhotoId !== photo.id) {
    draft = null;
    draftPhotoId = photo.id;
  }
  const { spec } = await currentDesign(photo);

  tabs.replaceChildren(
    ...available.map((e) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(e.id === selected), class: photo.overrides[e.id] ? 'changed' : '',
      title: photo.overrides[e.id] ? 'Changed for this photo' : '',
      onclick: () => {
        selected = e.id;
        draft = null;
        renderElementEditor(onApply);
      },
    }, photo.roomType === 'exterior' ? exteriorLabel(e) : e.label)),
  );

  const rerender = () => renderElementEditor(onApply);
  const fields = await buildForm(selected, spec[selected] ?? {}, spec, photo, rerender);
  const ai = store.project.engine !== 'local';
  const note = ai ? h('textarea', { rows: 2, placeholder: 'Optional note for the AI, e.g. "matte finish, no pattern"', 'aria-label': 'Note for the AI' }) : null;
  form.replaceChildren(...[
    ...fields,
    note,
    h('div', { class: 'form-actions' },
      h('button', {
        type: 'button', class: 'btn primary small', disabled: !draft && !(ai && note),
        onclick: async () => {
          const patch = draft;
          draft = null;
          if (patch) store.update(() => { photo.overrides[selected] = { ...(photo.overrides[selected] ?? {}), ...patch }; });
          await onApply(selected, note?.value ?? '');
        },
      }, `Apply ${(available.find((e) => e.id === selected)?.label ?? '').toLowerCase()} change`),
      photo.overrides[selected] ? h('button', {
        type: 'button', class: 'btn secondary small',
        onclick: async () => {
          draft = null;
          store.update(() => { delete photo.overrides[selected]; });
          await onApply(selected, '');
        },
      }, 'Reset to style') : null,
      draft ? h('span', { class: 'small muted' }, 'Not applied yet') : null,
    ),
  ].filter(Boolean));
}

function exteriorLabel(e) {
  return { flooring: 'Garden & path', walls: 'Facade', ceiling: 'Sky', furniture: 'Planting' }[e.id] ?? e.label;
}
