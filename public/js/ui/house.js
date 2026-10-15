/**
 * "3D house & video" tab: room order, 3D preview (walkthrough playback or
 * free exploring), MP4 export with progress and GLB model download.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { store, runtime } from '../state.js';
import { roomLabel } from '../catalog.js';
import { currentRender } from '../render/engine.js';
import { buildHouse, buildTimeline, drawOverlay, disposeHouse } from '../three/house.js';
import { exportMp4 } from '../three/videoExport.js';
import { $, $$, h, toast, downloadBlob, slug } from './dom.js';

let renderer = null;
let house = null;
let timeline = null;
let houseKey = '';
let building = null;
let mode = 'walk';
let playing = false;
let time = 0;
let last = 0;
let controls = null;
let exploreCamera = null;
let exporting = null;
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 500);
const view = h('canvas', { 'aria-label': '3D walkthrough preview' });
const viewCtx = view.getContext('2d');

function getRenderer() {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.setPixelRatio(1);
  }
  return renderer;
}

/** Rooms that can go into the house: photos with a render, in the chosen order. */
function houseEntries() {
  const p = store.project;
  const withRender = p.photos.filter((photo) => currentRender(photo));
  const order = p.house.order.filter((id) => withRender.some((x) => x.id === id));
  for (const photo of withRender) if (!order.includes(photo.id)) order.push(photo.id);
  const excluded = new Set(p.house.excluded ?? []);
  return order.map((id) => {
    const photo = withRender.find((x) => x.id === id);
    return { id, photo, name: photo.name, roomType: photo.roomType, render: currentRender(photo), included: !excluded.has(id) };
  });
}

function renderRoomList() {
  const list = $('#room-order');
  const entries = houseEntries();
  if (!entries.length) {
    list.replaceChildren(h('li', { class: 'muted small', style: { cursor: 'default' } }, 'No rendered rooms yet.'));
    return;
  }
  const move = (id, dir) => {
    const order = entries.map((e) => e.id);
    const i = order.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    store.update((p) => { p.house.order = order; }, 'house');
  };
  list.replaceChildren(
    ...entries.map((e, i) => h('li', {},
      h('input', {
        type: 'checkbox', checked: e.included, 'aria-label': `Include ${e.name}`,
        onchange: (ev) => store.update((p) => {
          const ex = new Set(p.house.excluded ?? []);
          if (ev.target.checked) ex.delete(e.id);
          else ex.add(e.id);
          p.house.excluded = [...ex];
        }, 'house'),
      }),
      h('img', { src: runtime.url(e.render.blob), alt: '' }),
      h('span', { class: 'small' }, h('strong', {}, e.name), h('br'), h('span', { class: 'muted' }, `${roomLabel(e.roomType)}${e.render.engine !== 'local' ? ' · AI render, flat furniture' : e.roomType === 'exterior' ? ' · opens the video' : ' · with 3D furniture'}`)),
      h('span', { class: 'move' },
        h('button', { type: 'button', 'aria-label': `Move ${e.name} up`, disabled: i === 0, onclick: () => move(e.id, -1) }, '▲'),
        h('button', { type: 'button', 'aria-label': `Move ${e.name} down`, disabled: i === entries.length - 1, onclick: () => move(e.id, 1) }, '▼')),
    )),
  );
}

/** (Re)builds the 3D house when its inputs changed. */
async function ensureHouse(force = false) {
  const entries = houseEntries().filter((e) => e.included);
  const key = JSON.stringify(entries.map((e) => [e.id, e.render.id, e.roomType])) + store.project.name;
  if (!entries.length) {
    disposeHouse(house);
    house = null;
    timeline = null;
    houseKey = '';
    showEmpty(true);
    return;
  }
  if (!force && key === houseKey && house) return;
  if (building) return building;
  showEmpty(false);
  $('#house-time').textContent = 'Building 3D house…';
  building = (async () => {
    try {
      const next = await buildHouse(entries);
      disposeHouse(house);
      house = next;
      houseKey = key;
      timeline = buildTimeline(house, store.project.name, Number($('#video-speed').value));
      // Show a "poster" frame just after the opening fade-in rather than black.
      time = time === 0 ? Math.min(1, timeline.duration) : Math.min(time, timeline.duration);
      setupExplore();
      drawPreview();
    } catch (error) {
      console.error(error);
      toast(`Could not build the 3D house: ${error.message}`, 'error');
    } finally {
      building = null;
    }
  })();
  return building;
}

function showEmpty(empty) {
  $('#house-empty').hidden = !empty;
  view.hidden = empty;
  $('#house-player').hidden = empty || mode !== 'walk';
  $('#video-btn').disabled = empty;
  $('#glb-btn').disabled = empty;
}

function setupExplore() {
  exploreCamera ??= new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 500);
  const size = house.bounds.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.z) * 0.8 + 5;
  exploreCamera.position.set(house.center.x + r * 0.4, r * 0.75, house.center.z + r * 0.8);
  controls?.dispose();
  controls = new OrbitControls(exploreCamera, view);
  controls.target.set(house.center.x, 0.8, house.center.z);
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 1.5;
  controls.maxDistance = 80;
  controls.enableDamping = true;
  controls.enabled = mode === 'explore';
  controls.update();
}

/** Renders the scene at time t into a 2D canvas of the given size, with overlays. */
function renderFrame(t, target, width, height, cam = null) {
  const r = getRenderer();
  const size = r.getSize(new THREE.Vector2());
  if (size.x !== width || size.y !== height) r.setSize(width, height, false);
  let useCam = cam;
  house.showLabels(Boolean(cam) || ['overview', 'outro'].includes(timeline.overlayAt(t).kind));
  if (!useCam) {
    const c = timeline.cameraAt(t);
    camera.fov = c.fov;
    camera.aspect = width / height;
    camera.position.copy(c.pos);
    camera.lookAt(c.target);
    camera.updateProjectionMatrix();
    useCam = camera;
  }
  r.render(house.scene, useCam);
  const ctx = target.getContext('2d');
  ctx.drawImage(r.domElement, 0, 0, width, height);
  if (!cam) drawOverlay(ctx, width, height, timeline.overlayAt(t), store.project.name);
  return target;
}

function drawPreview() {
  if (!house || !timeline) return;
  const stage = $('#house-stage');
  const width = Math.max(320, Math.round(Math.min(1280, stage.clientWidth * Math.min(1.5, devicePixelRatio))));
  const height = Math.round((width * 9) / 16);
  if (view.width !== width) {
    view.width = width;
    view.height = height;
  }
  if (mode === 'explore') {
    exploreCamera.aspect = width / height;
    exploreCamera.updateProjectionMatrix();
    controls.update();
    renderFrame(0, view, width, height, exploreCamera);
  } else {
    renderFrame(time, view, width, height);
    $('#house-scrub').value = String(Math.round((time / timeline.duration) * 1000));
    $('#house-time').textContent = `${fmt(time)} / ${fmt(timeline.duration)}`;
  }
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function loop(now) {
  requestAnimationFrame(loop);
  if (store.ui.tab !== 'house' || !house || exporting) {
    last = now;
    return;
  }
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (mode === 'walk' && playing) {
    time += dt;
    if (time >= timeline.duration) {
      time = timeline.duration;
      setPlaying(false);
    }
  }
  if (mode === 'explore' || playing) drawPreview();
}

function setPlaying(value) {
  playing = Boolean(value) && Boolean(timeline);
  if (playing && time >= timeline.duration - 0.01) time = 0;
  $('#house-play').textContent = playing ? '❚❚' : '▶';
  $('#house-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

async function downloadVideo() {
  await ensureHouse();
  if (!house || exporting) return;
  setPlaying(false);
  const res = Number($('#video-quality').value);
  const width = res === 1080 ? 1920 : 1280;
  const height = res === 1080 ? 1080 : 720;
  const fps = 30;
  const canvas = h('canvas', { width, height });
  const controller = new AbortController();
  exporting = controller;
  $('#video-progress').hidden = false;
  $('#video-btn').disabled = true;
  const bar = $('#video-bar');
  const status = $('#video-status');
  try {
    const blob = await exportMp4({
      width, height, fps,
      duration: timeline.duration,
      drawFrame: (t) => renderFrame(t, canvas, width, height),
      onProgress: (p, label) => {
        bar.value = Math.round(p * 100);
        status.textContent = `${label} (${Math.round(p * 100)}%)`;
      },
      serverAvailable: Boolean(store.config.video?.serverEncoder),
      signal: controller.signal,
    });
    downloadBlob(blob, `${slug(store.project.name)}-walkthrough.mp4`);
    toast(`Walkthrough video ready (${(blob.size / 1e6).toFixed(1)} MB).`);
    status.textContent = 'Done. Your download has started.';
  } catch (error) {
    if (error.name === 'AbortError') status.textContent = 'Export cancelled.';
    else {
      console.error(error);
      status.textContent = error.message;
      toast(error.message, 'error', 8000);
    }
  } finally {
    exporting = null;
    $('#video-btn').disabled = false;
    getRenderer().setSize(view.width, view.height, false);
    drawPreview();
  }
}

async function downloadModel() {
  await ensureHouse();
  if (!house) return;
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  // Hide helpers (labels, outlines, shadow catchers, ground) during export.
  const hidden = [];
  house.scene.traverse((o) => {
    if (o.userData.noExport && o.visible) {
      o.visible = false;
      hidden.push(o);
    }
  });
  try {
    const result = await new GLTFExporter().parseAsync(house.scene, { binary: true, onlyVisible: true, maxTextureSize: 2048 });
    downloadBlob(new Blob([result], { type: 'model/gltf-binary' }), `${slug(store.project.name)}-3d-house.glb`);
  } catch (error) {
    toast(`Could not export the 3D model: ${error.message}`, 'error');
  } finally {
    for (const o of hidden) o.visible = true;
  }
}

export function initHouse() {
  $('#house-stage').append(view);
  view.hidden = true;
  showEmpty(true);
  $('#house-play').addEventListener('click', () => setPlaying(!playing));
  $('#house-scrub').addEventListener('input', (e) => {
    if (!timeline) return;
    time = (Number(e.target.value) / 1000) * timeline.duration;
    drawPreview();
  });
  $$('[data-house-mode]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.houseMode;
    $$('[data-house-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (controls) controls.enabled = mode === 'explore';
    $('#house-player').hidden = mode !== 'walk' || !house;
    setPlaying(false);
    drawPreview();
  }));
  $('#house-rebuild').addEventListener('click', () => ensureHouse(true));
  $('#video-speed').addEventListener('change', () => {
    if (!house) return;
    timeline = buildTimeline(house, store.project.name, Number($('#video-speed').value));
    time = Math.min(time, timeline.duration);
    drawPreview();
  });
  $('#video-btn').addEventListener('click', downloadVideo);
  $('#video-cancel').addEventListener('click', () => exporting?.abort());
  $('#glb-btn').addEventListener('click', downloadModel);
  new ResizeObserver(() => drawPreview()).observe($('#house-stage'));

  store.on((reason) => {
    renderRoomList();
    if (store.ui.tab === 'house' && reason !== 'progress') ensureHouse();
  });
  renderRoomList();
  requestAnimationFrame(loop);
}
