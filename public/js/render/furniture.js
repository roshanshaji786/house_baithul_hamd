/**
 * Furniture, soft furnishings and light fittings for the free renderer and
 * the 3D house.
 *
 * planRoom()  decides WHAT goes WHERE, in metres, from the room size, the
 *             room type, the style spec and the doors/windows found in the
 *             photo (a sofa never blocks a doorway, curtains hang at windows).
 * buildRoomObjects() turns that plan into three.js meshes.
 *
 * Room space: floor y = 0, far wall z = -depth, side walls x = xL / xR,
 * the photo's camera at (0, eyeY, 0) looking down -z.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { materialCanvas } from './materials.js';
import { seededRandom, mixHex } from '../lib/imageTools.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/** Distance from the camera plane to the nearest floor point in the photo. */
export function nearestVisibleDepth(room) {
  return (room.eyeY * room.f) / Math.max(1, room.height - room.cy);
}

/**
 * Wall helpers. Positions along a wall: back wall uses x; side walls use
 * p = distance from the camera plane (p = -z).
 */
function wallTools(room, openings, pNear) {
  const ranges = {
    back: [room.xL + 0.1, room.xR - 0.1],
    left: [pNear + 0.2, room.depth - 0.1],
    right: [pNear + 0.2, room.depth - 0.1],
  };
  const along = (o) => (o.surface === 'back' ? [o.a0, o.a1] : o.surface === 'left' ? [o.a0, o.a1] : [-o.a1, -o.a0]);

  /** Intervals blocked by openings whose sill is lower than `height`. */
  const blocked = (surface, height) =>
    openings.filter((o) => o.surface === surface && o.y0 < height).map((o) => {
      const [a, b] = along(o);
      return [a - 0.12, b + 0.12];
    });

  /** Centre for an item of `length` on `surface`, nearest to `preferred`. */
  const fit = (surface, length, preferred, height = 3) => {
    const [lo, hi] = ranges[surface];
    if (hi - lo < length) return null;
    const blocks = blocked(surface, height).sort((a, b) => a[0] - b[0]);
    const spans = [];
    let start = lo;
    for (const [a, b] of blocks) {
      if (a > start) spans.push([start, Math.min(a, hi)]);
      start = Math.max(start, b);
    }
    if (start < hi) spans.push([start, hi]);
    let best = null;
    for (const [a, b] of spans) {
      if (b - a < length) continue;
      const c = clamp(preferred, a + length / 2, b - length / 2);
      if (!best || Math.abs(c - preferred) < Math.abs(best - preferred)) best = c;
    }
    return best;
  };

  /** Converts a wall position into an item placement facing into the room. */
  const place = (surface, pos, depth, gap = 0.02) => {
    if (surface === 'back') return { x: pos, z: -room.depth + depth / 2 + gap, rot: 0 };
    if (surface === 'left') return { x: room.xL + depth / 2 + gap, z: -pos, rot: Math.PI / 2 };
    return { x: room.xR - depth / 2 - gap, z: -pos, rot: -Math.PI / 2 };
  };

  return { ranges, blocked, fit, place, along };
}

/**
 * Plans furniture, fittings and wall bands (e.g. kitchen splashback).
 * @returns {{items: object[], bands: object[], downlights: number[][], glows: object[]}}
 */
export function planRoom({ room, roomType, spec, openings = [], seed = 1, styleHint = 'minimalist' }) {
  const rand = seededRandom(seed);
  const pNear = nearestVisibleDepth(room);
  const tools = wallTools(room, openings, pNear);
  const W = room.xR - room.xL;
  const D = room.depth;
  const midX = (room.xL + room.xR) / 2;
  const items = [];
  const bands = [];
  const add = (item) => items.push(item);
  const fx = spec.fixtures;
  const fu = spec.furniture;

  // Curtains at every window (indoors). They sit just in front of the wall.
  if (roomType !== 'exterior' && roomType !== 'bathroom' && fu) {
    for (const o of openings.filter((w) => w.kind === 'window')) {
      const [a, b] = tools.along(o);
      const top = Math.min(room.ceiling - 0.05, o.y1 + 0.35);
      for (const [pos, side] of [[a - 0.22, -1], [b + 0.22, 1]]) {
        const p = tools.place(o.surface, pos, 0.08, 0.06);
        add({ kind: 'curtain', ...p, w: 0.5, h: top - 0.02, side, color: fu.curtain ?? mixHex(spec.walls.paint, '#f3eee4', 0.6) });
      }
      add({ kind: 'rod', ...tools.place(o.surface, (a + b) / 2, 0.02, 0.1), w: b - a + 1.0, y: top + 0.02 });
    }
  }

  if (roomType === 'living') planLiving();
  else if (roomType === 'bedroom') planBedroom();
  else if (roomType === 'kitchen') planKitchen();
  else if (roomType === 'bathroom') planBathroom();
  else if (roomType === 'exterior') planExterior();

  // Recessed downlights on a grid across the ceiling (interiors).
  const downlights = [];
  if (roomType !== 'exterior' && spec.lighting.downlights) {
    const inset = spec.ceiling.type === 'cove' ? 0.9 : 0.7;
    const zFar = -D + inset;
    const zNear = Math.max(-pNear + 0.2, -D * 0.25);
    const nx = clamp(Math.round((W - 2 * inset) / 1.5) + 1, 1, 4);
    const nz = clamp(Math.round((zNear - zFar) / 1.5) + 1, 1, 3);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = nx === 1 ? midX : room.xL + inset + ((W - 2 * inset) * i) / (nx - 1);
        const z = nz === 1 ? (zFar + zNear) / 2 : zFar + ((zNear - zFar) * j) / (nz - 1);
        downlights.push([x, room.ceiling, z]);
      }
    }
  }

  return { items, bands, downlights, glows: collectGlows(items) };

  // ----- room types ---------------------------------------------------------
  function planLiving() {
    const sofaLen = clamp(W * 0.55, 1.7, 2.7);
    const sofaD = 0.95;
    let wall = 'back';
    let pos = tools.fit('back', sofaLen + 0.1, midX, 0.85);
    if (pos === null) {
      wall = tools.ranges.left[1] - tools.ranges.left[0] > tools.ranges.right[1] - tools.ranges.right[0] ? 'left' : 'right';
      pos = tools.fit(wall, sofaLen, (pNear + D) / 2 + 0.3, 0.85) ?? tools.fit(wall === 'left' ? 'right' : 'left', sofaLen, (pNear + D) / 2, 0.85);
      if (pos === null) return;
    }
    const sofa = { kind: 'sofa', ...tools.place(wall, pos, sofaD), w: sofaLen, d: sofaD };
    add(sofa);
    const forward = [Math.sin(sofa.rot), Math.cos(sofa.rot)];
    const at = (dist, side = 0) => ({
      x: sofa.x + forward[0] * dist + Math.cos(sofa.rot) * side,
      z: sofa.z + forward[1] * dist - Math.sin(sofa.rot) * side,
    });
    const rugW = clamp(sofaLen + 0.9, 2.0, 3.2);
    const rugD = clamp(D * 0.42, 1.6, 2.3);
    add({ kind: 'rug', ...at(rugD / 2 + 0.05), rot: sofa.rot, w: rugW, d: rugD });
    add({ kind: 'coffeeTable', ...at(0.95), rot: sofa.rot, w: Math.min(1.15, sofaLen * 0.5), d: 0.6 });
    const sideOffset = sofaLen / 2 + 0.32;
    add({ kind: 'sideTable', ...at(-0.1, sideOffset), rot: sofa.rot });
    add({ kind: 'floorLamp', ...at(-0.05, -sideOffset - 0.05), rot: sofa.rot });
    if (W > 3.3 && fu.density !== 'minimal') {
      const chair = at(1.25, sofaLen / 2 + 0.75);
      add({ kind: 'armchair', ...chair, rot: sofa.rot + (Math.PI / 2) * 0.75, w: 0.85, d: 0.85 });
    }
    // Art above the sofa if that wall is free of windows.
    if (wall === 'back' && !tools.blocked('back', 2.2).some(([a, b]) => b > pos - sofaLen / 2 && a < pos + sofaLen / 2)) {
      add({ kind: 'art', x: pos, z: -D + 0.025, rot: 0, w: Math.min(1.4, sofaLen * 0.55), h: 0.8, y: 1.55 });
    }
    addPlantInCorner();
    // A low sideboard on the longer free side wall.
    const sbWall = ['left', 'right'].find((s) => tools.fit(s, 1.8, (pNear + D) / 2, 0.9) !== null && s !== wall);
    if (sbWall && fu.density !== 'minimal') {
      const p = tools.fit(sbWall, 1.8, (pNear + D) / 2, 0.9);
      add({ kind: 'sideboard', ...tools.place(sbWall, p, 0.45), w: 1.8, d: 0.45 });
    }
    if (fx.pendant !== 'none') {
      const c = at(0.95);
      add({ kind: 'pendant', x: c.x, z: c.z, drop: clamp(room.ceiling - 2.0, 0.4, 1.2) });
    }
  }

  function planBedroom() {
    const bedW = W < 2.9 ? 1.4 : 1.6;
    const bedL = 2.05;
    let wall = 'back';
    let pos = tools.fit('back', bedW + 1.1, midX, 0.05);
    if (pos === null) {
      wall = 'left';
      pos = tools.fit('left', bedW + 1.1, (pNear + D) / 2 + 0.4, 0.05) ?? tools.fit('right', bedW + 1.1, (pNear + D) / 2, 0.05);
      if (pos === null) return;
      if (tools.fit('left', bedW + 1.1, (pNear + D) / 2 + 0.4, 0.05) === null) wall = 'right';
    }
    // Keep the headboard below any window sill on that wall.
    const sill = openings.filter((o) => o.surface === wall && o.kind === 'window').reduce((m, o) => Math.min(m, o.y0), 9);
    const headH = clamp(sill - 0.05, 0.85, 1.2);
    const bed = { kind: 'bed', ...tools.place(wall, pos, bedL), w: bedW, d: bedL, headH };
    add(bed);
    const forward = [Math.sin(bed.rot), Math.cos(bed.rot)];
    const at = (dist, side = 0) => ({
      x: bed.x + forward[0] * dist + Math.cos(bed.rot) * side,
      z: bed.z + forward[1] * dist - Math.sin(bed.rot) * side,
    });
    add({ kind: 'rug', ...at(0.35), rot: bed.rot, w: bedW + 1.3, d: Math.min(2.4, D * 0.5) });
    // Bedside pendants replace table lamps in cosy styles.
    const bedsidePendants = fx.pendant !== 'none' && fu.density === 'cosy' && W > 3;
    for (const side of [-1, 1]) {
      const n = at(-bedL / 2 + 0.22, side * (bedW / 2 + 0.3));
      add({ kind: 'nightstand', ...n, rot: bed.rot });
      if (bedsidePendants) add({ kind: 'pendant', x: n.x, z: n.z, drop: room.ceiling - 1.25, small: true });
      else add({ kind: 'tableLamp', ...n, rot: bed.rot, y: 0.55 });
    }
    if (bedL + 0.9 < D - pNear) add({ kind: 'bench', ...at(bedL / 2 + 0.35), rot: bed.rot, w: bedW * 0.75, d: 0.4 });
    if (wall === 'back' && sill > 2.2) add({ kind: 'art', x: pos, z: -D + 0.025, rot: 0, w: bedW * 0.7, h: 0.6, y: headH + 0.55 });
    addPlantInCorner();
  }

  function planKitchen() {
    const c = spec.cabinets;
    // Base run along the far wall, split around doorways.
    const doors = tools.blocked('back', 0.3).sort((a, b) => a[0] - b[0]);
    const runs = [];
    let start = room.xL + 0.01;
    for (const [a, b] of doors) {
      if (a - start > 0.6) runs.push([start, a]);
      start = Math.max(start, b);
    }
    if (room.xR - 0.01 - start > 0.6) runs.push([start, room.xR - 0.01]);
    const windows = openings.filter((o) => o.surface === 'back' && o.kind === 'window');
    const longest = runs.reduce((m, r) => (!m || r[1] - r[0] > m[1] - m[0] ? r : m), null);
    // Tall fridge column at the end of a long run (the run is shortened to fit it).
    if (longest && longest[1] - longest[0] > 3.2) {
      add({ kind: 'tallUnit', x: longest[1] - 0.31, z: -D + 0.31, rot: 0, w: 0.6, d: 0.62 });
      longest[1] -= 0.62;
    }
    for (const [a, b] of runs) {
      add({ kind: 'baseRun', x: (a + b) / 2, z: -D + 0.3, rot: 0, w: b - a, d: 0.6 });
      bands.push({ surface: 'back', a0: a, a1: b, y0: 0.91, y1: 1.45, material: c.splash.material });
    }
    if (longest) {
      const [a, b] = longest;
      const sinkX = windows.length ? clamp((windows[0].a0 + windows[0].a1) / 2, a + 0.5, b - 0.5) : a + (b - a) * 0.3;
      const hobX = clamp(sinkX + (b - a > 2.4 ? 1.3 : -1.0) * (sinkX < (a + b) / 2 ? 1 : -1), a + 0.45, b - 0.45);
      add({ kind: 'sink', x: sinkX, z: -D + 0.32, rot: 0 });
      add({ kind: 'hob', x: hobX, z: -D + 0.32, rot: 0 });
      add({ kind: 'hood', x: hobX, z: -D + 0.25, rot: 0, y: 1.65 });
      // Wall cabinets, skipping windows and the hood.
      const avoid = [...windows.map((w) => [w.a0 - 0.1, w.a1 + 0.1]), [hobX - 0.45, hobX + 0.45]].sort((p, q) => p[0] - q[0]);
      let s = a;
      const openShelves = ['scandinavian', 'industrial'].includes(styleHint) || c.open;
      for (const [p, q] of [...avoid, [b, b]]) {
        if (p - s > 0.55) add({ kind: openShelves ? 'shelf' : 'wallCabinet', x: (s + Math.min(p, b)) / 2, z: -D + 0.175, rot: 0, w: Math.min(p, b) - s, d: 0.35, y: 1.45 });
        s = Math.max(s, q);
      }
    }
    // Island with stools when there is room in front of the run.
    if (D - pNear > 3.4 && W > 2.6) {
      const iz = -D + 0.6 + 1.15 + 0.45;
      const iw = clamp(W * 0.5, 1.4, 2.4);
      add({ kind: 'island', x: midX, z: iz, rot: 0, w: iw, d: 0.9 });
      const stools = iw > 1.9 ? 3 : 2;
      for (let i = 0; i < stools; i++) add({ kind: 'stool', x: midX - iw / 2 + (iw * (i + 0.5)) / stools, z: iz + 0.65, rot: 0 });
      if (fx.pendant !== 'none') {
        for (const dx of iw > 1.9 ? [-0.55, 0, 0.55] : [-0.35, 0.35]) add({ kind: 'pendant', x: midX + dx, z: iz, drop: room.ceiling - 1.75, small: true });
      }
    } else {
      addPlantInCorner();
    }
  }

  function planBathroom() {
    const vanityW = clamp(W * 0.35, 0.8, 1.4);
    const pos = tools.fit('back', vanityW + 0.1, room.xL + 0.3 + vanityW / 2, 0.85) ?? tools.fit('back', vanityW, midX, 0.85);
    if (pos !== null) {
      add({ kind: 'vanity', x: pos, z: -D + 0.25, rot: 0, w: vanityW, d: 0.48 });
      const free = !openings.some((o) => o.surface === 'back' && o.a1 > pos - vanityW / 2 && o.a0 < pos + vanityW / 2 && o.y0 < 1.9);
      if (free) add({ kind: 'mirror', x: pos, z: -D + 0.02, rot: 0, w: vanityW * 0.85, h: 0.9, y: 1.05 });
      for (const side of [-1, 1]) if (free) add({ kind: 'sconce', x: pos + side * (vanityW * 0.43 + 0.12), z: -D + 0.06, rot: 0, y: 1.65 });
    }
    // Walk-in shower behind a glass screen on the side with more space.
    const showerSide = pos !== null && pos < midX ? 'right' : 'left';
    const sx = showerSide === 'right' ? room.xR - 0.95 : room.xL + 0.95;
    add({ kind: 'showerScreen', x: sx, z: -D + 0.6, rot: Math.PI / 2, w: 1.2, h: 2.0 });
    add({ kind: 'showerHead', x: (sx + (showerSide === 'right' ? room.xR : room.xL)) / 2, z: -D + 0.5, y: Math.min(2.2, room.ceiling - 0.1) });
    const railWall = showerSide === 'right' ? 'left' : 'right';
    const railPos = tools.fit(railWall, 0.7, D * 0.55, 1.6);
    if (railPos !== null) add({ kind: 'towelRail', ...tools.place(railWall, railPos, 0.1, 0.03), w: 0.6, y: 1.0 });
    add({ kind: 'bathMat', x: pos ?? midX, z: -D + 0.9, rot: 0, w: 0.8, d: 0.5 });
    addPlantInCorner(0.6);
  }

  function planExterior() {
    // Shrubs along the facade, a tree to one side, wall lights by the door.
    const door = openings.find((o) => o.kind === 'door' && o.surface === 'back');
    const doorX = door ? (door.a0 + door.a1) / 2 : 0;
    const halfPath = door ? Math.max(0.7, (door.a1 - door.a0) / 2 + 0.3) : 0.8;
    for (let x = room.xL + 0.5; x < room.xR - 0.4; x += 0.75 + rand() * 0.3) {
      if (Math.abs(x - doorX) < halfPath + 0.4) continue;
      add({ kind: 'shrub', x, z: -D + 0.55, r: 0.35 + rand() * 0.2 });
    }
    if (D - pNear > 3) {
      const side = doorX > midX ? -1 : 1;
      add({ kind: 'tree', x: midX + side * W * 0.38, z: -D + 2.2, h: Math.min(6, room.ceiling * 0.8 + 2) });
    }
    for (const s of [-1, 1]) add({ kind: 'wallLight', x: doorX + s * (halfPath + 0.15), z: -D + 0.05, y: 2.1 });
    for (const s of [-1, 1]) add({ kind: 'planter', x: doorX + s * (halfPath + 0.55), z: -D + 0.9 });
    bands.push({ path: { x0: doorX - halfPath, x1: doorX + halfPath } });
  }

  function addPlantInCorner(scale = 1) {
    const corners = [
      ['back', room.xR - 0.35],
      ['back', room.xL + 0.35],
    ];
    for (const [wall, pos] of corners) {
      const blockedHere = tools.blocked(wall, 1.6).some(([a, b]) => pos > a - 0.2 && pos < b + 0.2);
      const occupied = items.some((it) => !['rug', 'curtain', 'rod', 'art', 'pendant'].includes(it.kind) && Math.hypot(it.x - pos, it.z + D) < (it.w ?? 0.6) / 2 + 0.45);
      if (!blockedHere && !occupied) {
        add({ kind: 'plant', x: pos, z: -D + 0.35, scale: scale * (fu?.plants > 1 ? 1.1 : 0.9) });
        return;
      }
    }
  }
}

/** Light-emitting points used for 2D glow halos. */
function collectGlows(items) {
  const glows = [];
  for (const it of items) {
    if (it.kind === 'floorLamp') glows.push({ pos: [it.x, 1.45, it.z], radius: 0.6, intensity: 0.5 });
    if (it.kind === 'tableLamp') glows.push({ pos: [it.x, (it.y ?? 0.55) + 0.32, it.z], radius: 0.45, intensity: 0.45 });
    if (it.kind === 'pendant') glows.push({ pos: [it.x, null, it.z], drop: it.drop, radius: it.small ? 0.4 : 0.7, intensity: 0.55 });
    if (it.kind === 'sconce') glows.push({ pos: [it.x, it.y, it.z + 0.08], radius: 0.35, intensity: 0.5 });
    if (it.kind === 'wallLight') glows.push({ pos: [it.x, it.y, it.z + 0.1], radius: 0.6, intensity: 0.6 });
    if (it.kind === 'mirror') glows.push({ pos: [it.x, it.y + it.h / 2, it.z + 0.03], radius: 0.6, intensity: 0.25 });
  }
  return glows;
}

// ---------------------------------------------------------------------------
// Mesh building
// ---------------------------------------------------------------------------
let fabricTexture = null;
function fabric() {
  if (fabricTexture) return fabricTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(128, 128);
  const rand = seededRandom(5);
  for (let i = 0; i < 128 * 128; i++) {
    const x = i % 128;
    const y = (i / 128) | 0;
    const v = 215 + rand() * 30 + ((x + y) % 2 ? 6 : -6);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  fabricTexture = new THREE.CanvasTexture(c);
  fabricTexture.wrapS = fabricTexture.wrapT = THREE.RepeatWrapping;
  fabricTexture.repeat.set(6, 6);
  fabricTexture.colorSpace = THREE.SRGBColorSpace;
  return fabricTexture;
}

const woodTextures = new Map();
function woodTexture(hex) {
  if (!woodTextures.has(hex)) {
    const t = new THREE.CanvasTexture(materialCanvas({ type: 'planks', base: hex, size: 1, plankWidth: 1, variation: 0.04, seams: false }, 3));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    woodTextures.set(hex, t);
  }
  return woodTextures.get(hex);
}

/** Material factory with caching. */
function materials(spec) {
  const cache = new Map();
  const get = (key, make) => {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key);
  };
  const fu = spec.furniture ?? {};
  const metalColor = spec.fixtures?.metalColor ?? '#1f1f1f';
  const shiny = !['#1f1f1f', '#f1f0ec'].includes(metalColor);
  return {
    fabric: (hex) => get(`f${hex}`, () => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.95, map: fabric() })),
    wood: (hex = fu.wood ?? '#b88a5a') => get(`w${hex}`, () => new THREE.MeshStandardMaterial({ color: '#ffffff', map: woodTexture(hex), roughness: 0.6 })),
    paint: (hex, roughness = 0.55) => get(`p${hex}${roughness}`, () => new THREE.MeshStandardMaterial({ color: hex, roughness })),
    metal: (hex = metalColor) => get(`m${hex}`, () => new THREE.MeshStandardMaterial({ color: hex, metalness: shiny ? 0.9 : 0.3, roughness: shiny ? 0.3 : 0.55 })),
    glow: (hex = '#fff1d6', strength = 2.2) => get(`g${hex}${strength}`, () => new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: strength, roughness: 0.4 })),
    glass: () => get('glass', () => new THREE.MeshStandardMaterial({ color: '#dfe9ea', transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.1, depthWrite: false })),
    mirror: () =>
      get('mirror', () => {
        // A mirror mostly shows the bright room opposite: a soft light gradient reads best.
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 256;
        const ctx = c.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 64, 256);
        grad.addColorStop(0, '#f3f2ef');
        grad.addColorStop(0.55, '#d6d8d6');
        grad.addColorStop(1, '#b9bcbb');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 256);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return new THREE.MeshStandardMaterial({ map: t, roughness: 0.08, metalness: 0.1 });
      }),
    ceramic: () => get('ceramic', () => new THREE.MeshStandardMaterial({ color: '#f6f5f2', roughness: 0.18 })),
    leaf: (hex) => get(`l${hex}`, () => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.8 })),
    foliage: (hex) => get(`fo${hex}`, () => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.6, side: THREE.DoubleSide })),
    texture: (key, canvas, roughness = 0.9) =>
      get(key, () => {
        const t = new THREE.CanvasTexture(canvas);
        t.colorSpace = THREE.SRGBColorSpace;
        return new THREE.MeshStandardMaterial({ map: t, roughness });
      }),
  };
}

function box(w, h, d, mat, radius = 0) {
  const geo = radius > 0 ? new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 2, h / 2, d / 2) * 0.999) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function cyl(rTop, rBottom, h, mat, segments = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const at = (mesh, x, y, z) => {
  mesh.position.set(x, y, z);
  return mesh;
};

/** Canvas with abstract art in the style's colours. */
function artCanvas(colors, seed) {
  const c = document.createElement('canvas');
  c.width = 400;
  c.height = 280;
  const ctx = c.getContext('2d');
  const rand = seededRandom(seed);
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, 400, 280);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = colors[i % colors.length] ?? '#888';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    if (i % 2) ctx.arc(80 + rand() * 240, 60 + rand() * 160, 30 + rand() * 70, 0, Math.PI * (1 + rand()));
    else ctx.rect(rand() * 300, rand() * 200, 40 + rand() * 120, 20 + rand() * 90);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return c;
}

/** Canvas texture for a rug in one of a few patterns. */
function rugCanvas(fu, seed) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 384;
  const ctx = c.getContext('2d');
  const [a, b] = fu.rug ?? ['#e6e2db', '#a9a59e'];
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, 512, 384);
  ctx.strokeStyle = b;
  ctx.fillStyle = b;
  const pattern = fu.rugPattern ?? 'border';
  if (pattern === 'border') {
    ctx.lineWidth = 14;
    ctx.strokeRect(34, 34, 444, 316);
    ctx.lineWidth = 4;
    ctx.strokeRect(58, 58, 396, 268);
  } else if (pattern === 'stripes') {
    for (let x = 30; x < 512; x += 64) ctx.fillRect(x, 0, 14, 384);
  } else if (pattern === 'diamond') {
    for (let x = 0; x < 512; x += 64) {
      for (let y = 0; y < 384; y += 64) {
        ctx.beginPath();
        ctx.moveTo(x + 32, y + 6);
        ctx.lineTo(x + 58, y + 32);
        ctx.lineTo(x + 32, y + 58);
        ctx.lineTo(x + 6, y + 32);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.lineWidth = 18;
    ctx.strokeStyle = fu.accent ?? b;
    ctx.strokeRect(9, 9, 494, 366);
  }
  // Pile texture.
  const img = ctx.getImageData(0, 0, 512, 384);
  const rand = seededRandom(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const g = 0.9 + rand() * 0.2;
    img.data[i] *= g;
    img.data[i + 1] *= g;
    img.data[i + 2] *= g;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Soft dark blob under furniture so it sits on the floor. */
let contactTexture = null;
function contactShadow(w, d) {
  if (!contactTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    contactTexture = new THREE.CanvasTexture(c);
  }
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false, opacity: 0.9 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.004;
  mesh.renderOrder = -1;
  return mesh;
}

/** Leaf-shaped geometry shared by all plants. */
let leafGeometry = null;
function leaf() {
  if (leafGeometry) return leafGeometry;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.06, 0.05, 0.07, 0.15, 0, 0.24);
  shape.bezierCurveTo(-0.07, 0.15, -0.06, 0.05, 0, 0);
  leafGeometry = new THREE.ShapeGeometry(shape, 6);
  return leafGeometry;
}

/** A bushy house plant: leaves on stems spiralling up from the pot. */
function plantFoliage(M, seed, scale, baseY) {
  const group = new THREE.Group();
  const rand = seededRandom(seed);
  const greens = ['#3d6b35', '#4a7a3f', '#2e5a2c', '#58874a', '#356230'];
  const stemMat = M.paint('#4a5a32', 0.8);
  const leafMats = greens.map((hex) => M.foliage(hex));
  const stems = 7;
  for (let st = 0; st < stems; st++) {
    const angle = (st / stems) * Math.PI * 2 + rand() * 0.6;
    const lean = 0.12 + rand() * 0.22;
    const height = (0.9 + rand() * 0.8) * scale;
    const stem = cyl(0.006, 0.008, height, stemMat, 5);
    stem.position.set(Math.cos(angle) * lean * height * 0.5, baseY + height / 2, Math.sin(angle) * lean * height * 0.5);
    stem.rotation.set(Math.sin(angle) * lean, 0, -Math.cos(angle) * lean);
    group.add(stem);
    const leaves = 6 + Math.floor(rand() * 4);
    for (let l = 0; l < leaves; l++) {
      const t = 0.3 + (l / leaves) * 0.7;
      const m = new THREE.Mesh(leaf(), leafMats[(st + l) % leafMats.length]);
      const r = Math.sin(lean) * height * t;
      m.position.set(Math.cos(angle) * r, baseY + height * t * Math.cos(lean), Math.sin(angle) * r);
      m.rotation.set(-0.6 - rand() * 0.8, angle + (rand() - 0.5) * 2, (rand() - 0.5) * 0.8);
      const k = scale * (1.1 + rand() * 0.9);
      m.scale.set(k, k, k);
      m.castShadow = true;
      group.add(m);
    }
  }
  return group;
}

/** Builds one planned item as a THREE.Group positioned in room space. */
function buildItem(item, spec, M, room, seed) {
  const g = new THREE.Group();
  const fu = spec.furniture ?? {};
  const fx = spec.fixtures ?? {};
  const cab = spec.cabinets ?? {};
  const wood = M.wood(fu.wood);
  const counterMat = /oak|block|wood/i.test(cab.counterName ?? '') ? M.wood(cab.counter) : M.paint(cab.counter ?? '#eeece8', 0.25);
  const legs = (w, d, h, mat, inset = 0.06, r = 0.018) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(cyl(r, r * 0.8, h, mat, 10), sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset)));
  };

  switch (item.kind) {
    case 'sofa': {
      const { w, d } = item;
      const up = M.fabric(fu.upholstery);
      g.add(at(box(w, 0.26, d, up, 0.05), 0, 0.27, 0));
      g.add(at(box(w, 0.48, 0.22, up, 0.07), 0, 0.58, -d / 2 + 0.11));
      for (const s of [-1, 1]) g.add(at(box(0.2, 0.36, d, up, 0.07), s * (w / 2 - 0.1), 0.5, 0));
      const seats = w > 2.2 ? 3 : 2;
      const sw = (w - 0.4) / seats;
      for (let i = 0; i < seats; i++) {
        g.add(at(box(sw - 0.02, 0.14, d - 0.3, up, 0.06), -w / 2 + 0.2 + sw * (i + 0.5), 0.46, 0.08));
        g.add(at(box(sw - 0.04, 0.38, 0.16, up, 0.07), -w / 2 + 0.2 + sw * (i + 0.5), 0.7, -d / 2 + 0.29));
      }
      const pillows = [fu.accent, fu.accent2, fu.accent].filter(Boolean);
      g.add(at(box(0.42, 0.4, 0.12, M.fabric(pillows[0]), 0.06), -w / 2 + 0.45, 0.72, -d / 2 + 0.42));
      g.add(at(box(0.42, 0.4, 0.12, M.fabric(pillows[1] ?? pillows[0]), 0.06), w / 2 - 0.45, 0.72, -d / 2 + 0.42));
      g.children.at(-1).rotation.z = 0.12;
      legs(w, d, 0.14, fu.styleHint === 'luxury' ? M.metal() : wood, 0.1);
      g.add(contactShadow(w + 0.4, d + 0.4));
      break;
    }
    case 'armchair': {
      const up = M.fabric(fu.accent2 ?? fu.upholstery);
      g.add(at(box(0.8, 0.22, 0.8, up, 0.05), 0, 0.3, 0));
      g.add(at(box(0.8, 0.5, 0.18, up, 0.07), 0, 0.62, -0.31));
      for (const s of [-1, 1]) g.add(at(box(0.14, 0.3, 0.8, up, 0.06), s * 0.33, 0.52, 0));
      g.add(at(box(0.52, 0.12, 0.56, up, 0.05), 0, 0.46, 0.06));
      legs(0.8, 0.8, 0.19, wood, 0.08);
      g.add(contactShadow(1.1, 1.1));
      break;
    }
    case 'coffeeTable': {
      const round = ['scandinavian', 'luxury'].includes(fu.styleHint);
      const top = round
        ? at(cyl(item.d * 0.75, item.d * 0.75, 0.04, fu.styleHint === 'luxury' ? M.texture('marbleTop', materialCanvas({ type: 'tiles', base: '#efede8', vein: '#8f8b86', tileW: 1, tileH: 1, size: 1 }, 9), 0.25) : wood, 40), 0, 0.38, 0)
        : at(box(item.w, 0.05, item.d, wood, 0.01), 0, 0.37, 0);
      g.add(top);
      if (round) g.add(at(cyl(0.12, 0.16, 0.36, fu.styleHint === 'luxury' ? M.metal() : wood), 0, 0.18, 0));
      else legs(item.w, item.d, 0.35, fu.styleHint === 'industrial' ? M.metal('#1f1f1f') : wood, 0.05, 0.02);
      g.add(at(box(0.22, 0.05, 0.16, M.paint(fu.accent ?? '#555')), -0.15, 0.425, 0));
      g.add(at(cyl(0.05, 0.06, 0.16, M.ceramic()), 0.2, 0.48, 0.05));
      g.add(contactShadow(item.w + 0.3, item.d + 0.3));
      break;
    }
    case 'sideTable':
      g.add(at(cyl(0.22, 0.22, 0.03, wood), 0, 0.52, 0));
      g.add(at(cyl(0.025, 0.025, 0.5, M.metal()), 0, 0.26, 0));
      g.add(at(cyl(0.15, 0.15, 0.02, M.metal()), 0, 0.01, 0));
      g.add(at(cyl(0.06, 0.08, 0.22, M.ceramic()), 0.04, 0.65, 0));
      g.add(contactShadow(0.6, 0.6));
      break;
    case 'floorLamp':
      g.add(at(cyl(0.16, 0.16, 0.025, M.metal()), 0, 0.012, 0));
      g.add(at(cyl(0.015, 0.015, 1.4, M.metal()), 0, 0.7, 0));
      g.add(at(cyl(0.16, 0.22, 0.3, M.glow('#fff3dc', 0.9), 32), 0, 1.45, 0));
      g.add(contactShadow(0.5, 0.5));
      break;
    case 'tableLamp': {
      const y = item.y ?? 0.55;
      g.add(at(cyl(0.07, 0.09, 0.22, M.ceramic()), 0, y + 0.11, 0));
      g.add(at(cyl(0.12, 0.16, 0.2, M.glow('#fff3dc', 0.8), 32), 0, y + 0.32, 0));
      break;
    }
    case 'rug': {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(item.w, item.d), M.texture(`rug${seed}`, rugCanvas(fu, seed), 1));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.006;
      mesh.receiveShadow = true;
      g.add(mesh);
      break;
    }
    case 'art': {
      const frameMat = fx.metal === 'brass' ? M.metal() : M.paint(fu.styleHint === 'scandinavian' ? fu.wood : '#1f1f1f');
      g.add(at(box(item.w + 0.06, item.h + 0.06, 0.03, frameMat), 0, item.y, 0));
      const art = new THREE.Mesh(new THREE.PlaneGeometry(item.w, item.h), M.texture(`art${seed}`, artCanvas(fu.art ?? ['#555'], seed), 0.9));
      art.position.set(0, item.y, 0.017);
      g.add(art);
      break;
    }
    case 'sideboard': {
      g.add(at(box(item.w, 0.6, item.d, wood, 0.01), 0, 0.42, 0));
      for (let i = 0; i < 3; i++) g.add(at(box(item.w / 3 - 0.01, 0.56, 0.01, wood), -item.w / 3 + (i * item.w) / 3, 0.42, item.d / 2 + 0.002));
      legs(item.w, item.d, 0.12, M.metal(), 0.05, 0.015);
      g.add(at(cyl(0.07, 0.1, 0.3, M.ceramic()), -item.w * 0.3, 0.87, 0));
      g.add(at(box(0.3, 0.05, 0.22, M.paint(fu.accent ?? '#555')), item.w * 0.25, 0.745, 0));
      g.add(contactShadow(item.w + 0.3, item.d + 0.3));
      break;
    }
    case 'bed': {
      const { w, d, headH } = item;
      const frame = fu.styleHint === 'luxury' || fu.styleHint === 'minimalist' ? M.fabric(fu.upholstery) : wood;
      g.add(at(box(w + 0.1, 0.3, d, frame, 0.03), 0, 0.2, 0));
      g.add(at(box(w + 0.2, headH, 0.12, M.fabric(fu.upholstery), 0.05), 0, headH / 2, -d / 2 + 0.06));
      g.add(at(box(w, 0.22, d - 0.15, M.fabric('#f4f2ee'), 0.06), 0, 0.46, 0.05));
      // Duvet over the lower two thirds, then a throw folded over the foot.
      const duvetLen = d - 0.55;
      g.add(at(box(w + 0.04, 0.1, duvetLen, M.fabric(fu.accent2 ?? '#e8e2d8'), 0.045), 0, 0.58, d / 2 + 0.02 - duvetLen / 2));
      g.add(at(box(w + 0.07, 0.08, 0.5, M.fabric(fu.accent ?? fu.upholstery), 0.035), 0, 0.64, d / 2 - 0.22));
      for (const s of [-1, 1]) g.add(at(box(w / 2 - 0.1, 0.16, 0.36, M.fabric('#f7f5f1'), 0.07), (s * w) / 4, 0.64, -d / 2 + 0.35));
      g.add(at(box(0.42, 0.32, 0.12, M.fabric(fu.accent ?? '#888'), 0.06), 0, 0.7, -d / 2 + 0.55));
      g.add(contactShadow(w + 0.6, d + 0.4));
      break;
    }
    case 'nightstand':
      g.add(at(box(0.48, 0.42, 0.4, wood, 0.01), 0, 0.33, 0));
      g.add(at(box(0.44, 0.006, 0.01, M.paint('#2a2622')), 0, 0.42, 0.2));
      legs(0.48, 0.4, 0.12, wood, 0.04, 0.015);
      g.add(contactShadow(0.7, 0.6));
      break;
    case 'bench':
      g.add(at(box(item.w, 0.12, item.d, M.fabric(fu.accent2 ?? fu.upholstery), 0.04), 0, 0.42, 0));
      legs(item.w, item.d, 0.37, wood, 0.05, 0.02);
      g.add(contactShadow(item.w + 0.3, item.d + 0.3));
      break;
    case 'plant': {
      const s = item.scale ?? 1;
      const potColor = fu.styleHint === 'indian' ? '#b5603e' : fu.styleHint === 'industrial' ? '#2b2b2b' : '#ecebe7';
      g.add(at(cyl(0.2 * s, 0.16 * s, 0.42 * s, M.paint(potColor, 0.8)), 0, 0.21 * s, 0));
      g.add(plantFoliage(M, seed + 11, s, 0.42 * s));
      g.add(contactShadow(0.7 * s, 0.7 * s));
      break;
    }
    case 'curtain': {
      const segs = 24;
      const geo = new THREE.PlaneGeometry(item.w, item.h, segs, 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin((pos.getX(i) / item.w) * Math.PI * 7) * 0.04);
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color: item.color, roughness: 1, side: THREE.DoubleSide, map: fabric() });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = item.h / 2 + 0.01;
      mesh.castShadow = true;
      g.add(mesh);
      break;
    }
    case 'rod':
      g.add(at(cyl(0.012, 0.012, item.w, M.metal(), 10), 0, item.y, 0));
      g.children[0].rotation.z = Math.PI / 2;
      break;
    case 'pendant': {
      const drop = item.drop ?? 0.8;
      const y = room.ceiling - drop;
      g.add(at(cyl(0.004, 0.004, drop, M.paint('#222'), 6), 0, room.ceiling - drop / 2, 0));
      g.add(at(cyl(0.06, 0.06, 0.02, M.metal()), 0, room.ceiling - 0.01, 0));
      const s = item.small ? 0.7 : 1;
      const type = fx.pendant;
      if (type === 'globe') g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.17 * s, 32, 16), M.glow('#fff6e8', 1.6)), 0, y - 0.15 * s, 0));
      else if (type === 'edison') {
        for (const dx of [-0.18, 0, 0.18]) {
          g.add(at(cyl(0.003, 0.003, 0.3, M.paint('#222'), 6), dx * s, y + 0.1, 0));
          g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), M.glow('#ffcf8a', 2.4)), dx * s, y - 0.08, 0));
        }
      } else if (type === 'rattan') {
        g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.22 * s, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), new THREE.MeshStandardMaterial({ color: '#c49a62', roughness: 0.9, side: THREE.DoubleSide, map: fabric() })), 0, y, 0));
        g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), M.glow('#ffd9a0', 2)), 0, y - 0.06, 0));
      } else {
        const shade = new THREE.Mesh(
          type === 'cone' ? new THREE.ConeGeometry(0.16 * s, 0.3 * s, 32, 1, true) : new THREE.SphereGeometry(0.22 * s, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshStandardMaterial({ color: spec.fixtures.metalColor, metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide }),
        );
        shade.castShadow = true;
        g.add(at(shade, 0, y - (type === 'cone' ? 0.15 * s : 0.05), 0));
        g.add(at(new THREE.Mesh(new THREE.CircleGeometry(0.1 * s, 24), M.glow('#fff1d6', 2.4)), 0, y - (type === 'cone' ? 0.29 * s : 0.06), 0));
        g.children.at(-1).rotation.x = Math.PI / 2;
      }
      break;
    }
    case 'baseRun': {
      const { w, d } = item;
      const front = M.paint(cab.color, 0.45);
      g.add(at(box(w, 0.1, d - 0.08, M.paint('#1d1d1d')), 0, 0.05, -0.04));
      const doors = Math.max(1, Math.round(w / 0.6));
      for (let i = 0; i < doors; i++) {
        const dw = w / doors;
        g.add(at(box(dw - 0.006, 0.76, 0.02, front, 0.004), -w / 2 + dw * (i + 0.5), 0.49, d / 2 - 0.01));
        g.add(at(box(dw * 0.5, 0.012, 0.02, M.metal(cab.handles)), -w / 2 + dw * (i + 0.5), 0.84, d / 2 + 0.012));
      }
      g.add(at(box(w, 0.76, d - 0.03, M.paint(mixHex(cab.color, '#000000', 0.2))), 0, 0.49, -0.02));
      g.add(at(box(w + 0.02, 0.04, d + 0.03, counterMat), 0, 0.89, 0.01));
      break;
    }
    case 'wallCabinet': {
      const front = M.paint(cab.color, 0.45);
      const doors = Math.max(1, Math.round(item.w / 0.5));
      for (let i = 0; i < doors; i++) {
        const dw = item.w / doors;
        g.add(at(box(dw - 0.006, 0.72, item.d, front, 0.004), -item.w / 2 + dw * (i + 0.5), item.y + 0.36, 0));
      }
      break;
    }
    case 'shelf': {
      const rand = seededRandom(seed + Math.round(item.x * 10));
      for (const dy of [0.15, 0.6]) {
        g.add(at(box(item.w, 0.035, 0.26, wood), 0, item.y + dy, -0.04));
        // A few objects: jars, a vase and stacked bowls, with gaps between them.
        for (let x = -item.w / 2 + 0.12; x < item.w / 2 - 0.1; x += 0.22 + rand() * 0.25) {
          const pick = rand();
          if (pick < 0.3) continue;
          const sy = item.y + dy + 0.0175;
          if (pick < 0.55) g.add(at(cyl(0.04, 0.045, 0.16, M.glass()), x, sy + 0.08, -0.04));
          else if (pick < 0.8) g.add(at(cyl(0.035, 0.06, 0.22, rand() < 0.5 ? M.ceramic() : M.paint(fu.accent ?? '#777', 0.7)), x, sy + 0.11, -0.04));
          else for (let k = 0; k < 3; k++) g.add(at(cyl(0.1 - k * 0.012, 0.08 - k * 0.01, 0.035, M.ceramic()), x, sy + 0.02 + k * 0.035, -0.04));
        }
      }
      break;
    }
    case 'tallUnit':
      g.add(at(box(item.w, 2.2, item.d, M.paint(cab.color, 0.45), 0.004), 0, 1.1, 0));
      g.add(at(box(0.012, 0.6, 0.02, M.metal(cab.handles)), -item.w / 2 + 0.06, 1.1, item.d / 2 + 0.012));
      break;
    case 'sink':
      g.add(at(box(0.6, 0.012, 0.42, M.metal('#b9bcbf')), 0, 0.912, 0));
      g.add(at(cyl(0.015, 0.015, 0.32, M.metal(cab.handles)), 0, 1.07, -0.2));
      g.add(at(cyl(0.012, 0.012, 0.22, M.metal(cab.handles)), 0, 1.22, -0.1));
      g.children.at(-1).rotation.x = Math.PI / 2;
      break;
    case 'hob':
      g.add(at(box(0.6, 0.008, 0.5, new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.15 })), 0, 0.913, 0));
      break;
    case 'hood':
      g.add(at(box(0.7, 0.12, 0.5, M.metal(cab.handles === '#1f1f1f' ? '#2a2a2a' : '#b9bcbf')), 0, item.y, 0));
      g.add(at(box(0.28, room.ceiling - item.y - 0.06, 0.26, M.metal(cab.handles === '#1f1f1f' ? '#2a2a2a' : '#b9bcbf')), 0, (room.ceiling + item.y) / 2, -0.1));
      break;
    case 'island':
      g.add(at(box(item.w, 0.87, item.d, M.paint(cab.color, 0.45), 0.004), 0, 0.435, 0));
      g.add(at(box(item.w + 0.1, 0.04, item.d + 0.15, counterMat), 0, 0.89, 0.05));
      g.add(contactShadow(item.w + 0.4, item.d + 0.5));
      break;
    case 'stool':
      g.add(at(cyl(0.19, 0.19, 0.05, wood), 0, 0.68, 0));
      for (const a of [0, 1, 2, 3]) {
        const leg = at(cyl(0.012, 0.012, 0.7, M.metal()), Math.cos((a * Math.PI) / 2) * 0.13, 0.34, Math.sin((a * Math.PI) / 2) * 0.13);
        g.add(leg);
      }
      g.add(contactShadow(0.5, 0.5));
      break;
    case 'vanity':
      g.add(at(box(item.w, 0.38, item.d, cab.color ? M.paint(cab.color, 0.45) : wood, 0.01), 0, 0.62, 0));
      g.add(at(box(item.w + 0.02, 0.03, item.d + 0.02, M.paint(cab.counter ?? '#eeece8', 0.25)), 0, 0.825, 0));
      g.add(at(box(0.42, 0.12, 0.34, M.ceramic(), 0.05), 0, 0.9, 0.02));
      g.add(at(cyl(0.012, 0.012, 0.22, M.metal()), 0, 0.95, -0.17));
      break;
    case 'mirror':
      g.add(at(box(item.w + 0.04, item.h + 0.04, 0.02, M.glow('#fff4e2', 0.7)), 0, item.y + item.h / 2, -0.005));
      g.add(at(box(item.w, item.h, 0.02, M.mirror()), 0, item.y + item.h / 2, 0.005));
      break;
    case 'sconce':
      g.add(at(cyl(0.05, 0.05, 0.02, M.metal()), 0, item.y, -0.04));
      g.children.at(-1).rotation.x = Math.PI / 2;
      g.add(at(cyl(0.05, 0.05, 0.18, M.glow('#fff1d6', 1.4)), 0, item.y, 0.02));
      break;
    case 'showerScreen':
      g.add(at(box(0.01, item.h, item.w, M.glass()), 0, item.h / 2, 0));
      g.add(at(box(0.02, 0.02, item.w, M.metal()), 0, item.h, 0));
      g.add(at(box(0.02, item.h, 0.02, M.metal()), 0, item.h / 2, item.w / 2));
      break;
    case 'showerHead':
      g.add(at(cyl(0.13, 0.13, 0.015, M.metal()), 0, item.y, 0));
      break;
    case 'towelRail':
      g.add(at(box(item.w, 0.02, 0.03, M.metal()), 0, item.y, 0));
      g.add(at(box(item.w * 0.8, 0.5, 0.05, M.fabric(fu.accent2 ?? '#efe9df'), 0.02), 0, item.y - 0.24, 0.01));
      break;
    case 'bathMat': {
      const mat = new THREE.Mesh(new THREE.PlaneGeometry(item.w, item.d), M.fabric(fu.accent2 ?? '#e8e2d6'));
      mat.rotation.x = -Math.PI / 2;
      mat.position.y = 0.006;
      mat.receiveShadow = true;
      g.add(mat);
      break;
    }
    case 'shrub': {
      const rand = seededRandom(Math.round(item.x * 100) + seed);
      for (let i = 0; i < 6; i++) {
        const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(item.r * (0.5 + rand() * 0.4), 1), M.leaf(['#3f6b3a', '#4f7d45', '#2f5a33'][i % 3]));
        leaf.position.set((rand() - 0.5) * item.r, item.r * (0.5 + rand() * 0.5), (rand() - 0.5) * item.r * 0.6);
        leaf.castShadow = true;
        g.add(leaf);
      }
      g.add(contactShadow(item.r * 2.6, item.r * 2));
      break;
    }
    case 'tree': {
      g.add(at(cyl(0.09, 0.13, item.h * 0.45, M.paint('#5b4636', 0.9)), 0, item.h * 0.225, 0));
      const rand = seededRandom(seed + 77);
      for (let i = 0; i < 14; i++) {
        const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6 + rand() * 0.5, 1), M.leaf(['#3f6b3a', '#4f7d45', '#2f5a33', '#5c8a4c'][i % 4]));
        leaf.position.set((rand() - 0.5) * 2.2, item.h * 0.55 + rand() * item.h * 0.4, (rand() - 0.5) * 1.6);
        leaf.castShadow = true;
        g.add(leaf);
      }
      g.add(contactShadow(2.6, 2.6));
      break;
    }
    case 'planter':
      g.add(at(box(0.5, 0.55, 0.5, M.paint(mixHex(spec.walls.paint, '#3a3a3a', 0.6), 0.8), 0.02), 0, 0.275, 0));
      for (let i = 0; i < 5; i++) {
        const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), M.leaf(['#3f6b3a', '#4f7d45'][i % 2]));
        leaf.position.set(Math.cos(i * 1.3) * 0.12, 0.7 + (i % 3) * 0.1, Math.sin(i * 1.3) * 0.1);
        g.add(leaf);
      }
      g.add(contactShadow(0.8, 0.8));
      break;
    case 'wallLight':
      g.add(at(box(0.1, 0.22, 0.08, M.metal()), 0, item.y, 0.04));
      g.add(at(box(0.08, 0.04, 0.06, M.glow('#ffe7c2', 2.4)), 0, item.y - 0.12, 0.04));
      break;
    default:
      break;
  }

  g.position.set(item.x, 0, item.z);
  g.rotation.y = item.rot ?? 0;
  return g;
}

/**
 * Builds a THREE.Group with every planned item.
 * @param {object} plan  output of planRoom
 */
export function buildRoomObjects(plan, spec, room, seed = 1, styleHint = 'minimalist') {
  const group = new THREE.Group();
  const specWithHint = { ...spec, furniture: spec.furniture ? { ...spec.furniture, styleHint } : null };
  const M = materials(specWithHint);
  for (const item of plan.items) group.add(buildItem(item, specWithHint, M, room, seed));
  return group;
}
