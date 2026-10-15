/**
 * App entry point: loads the saved project, asks the server what optional
 * services are configured, then starts each part of the UI.
 */
import { store } from './state.js';
import { initPanels } from './ui/panels.js';
import { initUploads } from './ui/uploads.js';
import { initWorkspace } from './ui/workspace.js';
import { initHouse } from './ui/house.js';
import { toast } from './ui/dom.js';

/** Capabilities when the page is opened without the Node server (static demo). */
const STATIC_CONFIG = {
  static: true,
  providers: {
    local: { available: true, label: 'Free preview (in your browser)' },
    openai: { available: false, label: 'OpenAI (self-hosted version only)' },
    gemini: { available: false, label: 'Google Gemini (self-hosted version only)' },
  },
  analysis: { claude: false },
  video: { serverEncoder: false },
};

async function loadConfig() {
  store.config = STATIC_CONFIG;
  try {
    const res = await fetch('api/config');
    if (res.ok) store.config = await res.json();
  } catch {
    // Opened without the server (e.g. GitHub Pages): free features still work.
  }
  // Fall back to the free engine if the saved choice is no longer available.
  if (!store.config.providers[store.project.engine]?.available) store.project.engine = 'local';
}

async function start() {
  await store.load();
  await loadConfig();
  initPanels();
  initUploads();
  initWorkspace();
  initHouse();
  window.addEventListener('beforeunload', () => store.save());
  window.addEventListener('unhandledrejection', (e) => {
    console.error(e.reason);
    toast(e.reason?.message ?? 'Something went wrong.', 'error');
  });
}

start();
