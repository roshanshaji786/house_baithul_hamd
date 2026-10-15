/**
 * Minimal IndexedDB wrapper. Projects (including their photos, references
 * and saved renders as Blobs) are stored in the browser, so nothing is
 * uploaded anywhere unless an AI engine is used.
 */
const DB_NAME = 'home-finish-visualizer';
const VERSION = 1;
let dbPromise = null;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Storage transaction aborted'));
  });
}

export const db = {
  getProject: (id) => tx('projects', 'readonly', (s) => s.get(id)),
  putProject: (project) => tx('projects', 'readwrite', (s) => s.put(project)),
  deleteProject: (id) => tx('projects', 'readwrite', (s) => s.delete(id)),
  async listProjects() {
    const all = await tx('projects', 'readonly', (s) => s.getAll());
    return all.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  getMeta: (key) => tx('meta', 'readonly', (s) => s.get(key)),
  setMeta: (key, value) => tx('meta', 'readwrite', (s) => s.put(value, key)),
};
