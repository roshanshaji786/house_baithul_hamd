/**
 * Application state.
 *
 * `store.project` is the current project (saved to IndexedDB automatically).
 * `store.ui` holds view state that is not saved (selected photo, tab...).
 * Decoded images and analyses are cached in `runtime` because they cannot be
 * stored and are cheap to rebuild from the saved Blobs.
 *
 * Modules call `store.update(fn)` to change the project and subscribe with
 * `store.on(listener)` to re-render their part of the page.
 */
import { db } from './lib/db.js';
import { defaultFit } from './lib/geometry.js';

const uid = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
export { uid };

export function newProject(name = 'My house') {
  return {
    id: uid(),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    styleId: 'minimalist',
    engine: 'local',
    photos: [],
    references: [],
    renders: [],
    house: { order: [] },
  };
}

export function newPhoto({ name, blob, width, height, roomType = 'living', quality, fit }) {
  return {
    id: uid(),
    name,
    blob,
    width,
    height,
    roomType,
    fit: fit ?? defaultFit(),
    quality,
    useAnyway: false,
    overrides: {},
    aiCheck: null,
  };
}

const listeners = new Set();
let saveTimer = null;

export const store = {
  project: newProject(),
  projects: [],
  config: { providers: { local: { available: true } }, analysis: {}, video: {} },
  ui: {
    tab: 'design',
    photoId: null,
    renderId: {}, // photoId -> render id being viewed
    compareMode: 'slider',
    fitting: false,
    busy: null, // { label, progress }
    autoUpdate: true,
  },

  on(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  emit(reason = 'change') {
    // One failing panel must not stop the others from updating.
    for (const l of listeners) {
      try {
        l(reason);
      } catch (error) {
        console.error(error);
      }
    }
  },

  /** Mutates the project through `fn`, then notifies and schedules a save. */
  update(fn, reason = 'project') {
    fn(this.project);
    this.project.updatedAt = Date.now();
    this.emit(reason);
    this.scheduleSave();
  },

  setUi(patch, reason = 'ui') {
    Object.assign(this.ui, patch);
    this.emit(reason);
  },

  scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => this.save(), 600);
  },

  async save() {
    try {
      pruneRenders(this.project);
      await db.putProject(this.project);
      await db.setMeta('currentProject', this.project.id);
      this.projects = await db.listProjects();
    } catch (error) {
      console.warn('Could not save project', error);
      this.emit('storage-error');
    }
  },

  async load() {
    try {
      this.projects = await db.listProjects();
      const id = await db.getMeta('currentProject');
      const project = id ? await db.getProject(id) : null;
      if (project) this.project = migrate(project);
      else if (this.projects[0]) this.project = migrate(await db.getProject(this.projects[0].id));
    } catch (error) {
      console.warn('Storage unavailable; starting a fresh project', error);
    }
    this.ui.photoId = this.project.photos[0]?.id ?? null;
  },

  async switchProject(id, { save = true } = {}) {
    // Only persist the outgoing project when it still exists: right after a
    // deletion `this.project` points at a project that is no longer in the
    // database, and saving it would resurrect it.
    if (save) await this.save();
    const project = await db.getProject(id);
    if (!project) return;
    this.project = migrate(project);
    this.ui.photoId = this.project.photos[0]?.id ?? null;
    this.ui.renderId = {};
    await db.setMeta('currentProject', id);
    this.emit('project-switch');
  },

  async createProject(name, { saveFirst = true } = {}) {
    if (saveFirst) await this.save();
    this.project = newProject(name);
    this.ui.photoId = null;
    this.ui.renderId = {};
    await this.save();
    this.emit('project-switch');
  },

  async deleteProject() {
    const id = this.project.id;
    await db.deleteProject(id);
    this.projects = await db.listProjects();
    // Switch without saving: the current (deleted) project must not be
    // written back to the database.
    if (this.projects[0]) await this.switchProject(this.projects[0].id, { save: false });
    else await this.createProject('My house', { saveFirst: false });
  },

  get photo() {
    return this.project.photos.find((p) => p.id === this.ui.photoId) ?? null;
  },
};

/** Fills in fields added in later versions so old projects keep working. */
function migrate(project) {
  project.house ??= { order: [] };
  project.renders ??= [];
  project.photos ??= [];
  project.references ??= [];
  for (const p of project.photos) {
    p.overrides ??= {};
    p.fit ??= defaultFit();
  }
  return project;
}

/** Keeps saved renders and the latest few per photo, so storage stays small. */
function pruneRenders(project) {
  const keepPerPhoto = 6;
  const counts = {};
  project.renders = project.renders
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((r) => {
      if (!project.photos.some((p) => p.id === r.photoId)) return r.saved;
      counts[r.photoId] = (counts[r.photoId] ?? 0) + 1;
      return r.saved || counts[r.photoId] <= keepPerPhoto;
    })
    .sort((a, b) => a.createdAt - b.createdAt);
}

// ---------------------------------------------------------------------------
// Runtime caches (not saved)
// ---------------------------------------------------------------------------
const bitmaps = new Map();
const urls = new Map();

export const runtime = {
  /** Decoded ImageBitmap for a Blob owner (photo, reference or render). */
  async bitmap(owner, blob = owner.blob) {
    const key = owner.id;
    if (!bitmaps.has(key)) bitmaps.set(key, createImageBitmap(blob));
    return bitmaps.get(key);
  },

  /** Object URL for a Blob (created once per Blob). */
  url(blob) {
    if (!blob) return '';
    if (!urls.has(blob)) urls.set(blob, URL.createObjectURL(blob));
    return urls.get(blob);
  },

  forget(id) {
    bitmaps.delete(id);
    for (const key of [...this.analyses.keys()]) if (key.startsWith(id)) this.analyses.delete(key);
  },

  /** Photo analyses keyed by photo id + fit + room type. */
  analyses: new Map(),
  /** Reference analyses keyed by reference id. */
  references: new Map(),
};
