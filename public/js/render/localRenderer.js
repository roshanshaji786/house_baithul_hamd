/**
 * Free, in-browser "finish preview" renderer.
 *
 * No AI and no server: the photo is treated as a room box (see geometry.js)
 * and every pixel is repainted with the chosen finish while keeping the
 * photo's own light and shadow, so the result still looks like the same
 * room in the same light. Steps:
 *
 *   1. analysePhoto  - surface + position of every pixel, the photo's
 *                      lighting per surface, and doors/windows to keep.
 *   2. compose       - floor, walls, ceiling, frames and doors from the
 *                      spec's materials, lit by the photo's shading plus
 *                      downlights and cove lighting.
 *   3. furniture     - planned in metres, rendered with three.js using the
 *                      same camera, composited with soft shadows.
 *   4. grade         - white balance, exposure, gentle bloom and vignette.
 *
 * It is a visual preview with simplified geometry, not a design drawing.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { solveRoom, SURFACE, boxBlur } from '../lib/geometry.js';
import { SRGB_TO_LINEAR, linearToSrgb, hexToLinear, toCanvas, seededRandom } from '../lib/imageTools.js';
import { createSampler } from './materials.js';
import { planRoom, buildRoomObjects } from './furniture.js';

const { FLOOR, CEILING, LEFT, RIGHT, BACK } = SURFACE;
const WALLS = [LEFT, RIGHT, BACK];
const SURFACE_KEYS = ['floor', 'ceiling', 'left', 'right', 'back'];

/** Light colour (linear RGB multipliers) for a colour temperature. */
export function lightColor(kelvin) {
  if (kelvin <= 2700) return [1.12, 0.98, 0.78];
  if (kelvin <= 3000) return [1.08, 0.99, 0.85];
  if (kelvin <= 4000) return [1.02, 1.0, 0.95];
  return [0.97, 1.0, 1.06];
}

// ---------------------------------------------------------------------------
// 1. Analysis (independent of the style, cached per photo + room fit)
// ---------------------------------------------------------------------------

/**
 * @param {CanvasImageSource} photo
 * @param {object} fit       room fit (see geometry.defaultFit)
 * @param {string} roomType
 * @param {number} maxSide   working resolution
 */
export function analysePhoto(photo, fit, roomType, maxSide = 1600, { pad = 0, openings: knownOpenings = null } = {}) {
  // With `pad` > 0 the analysis also covers an area around the photo (as if
  // taken with a wider lens). The 3D house uses this so walls and floors
  // stay textured when the walkthrough camera turns beyond the photo's edges.
  const canvas = toCanvas(photo, maxSide / (1 + 2 * pad));
  const W0 = canvas.width;
  const H0 = canvas.height;
  const px = Math.round(W0 * pad);
  const py = Math.round(H0 * pad);
  const W = W0 + 2 * px;
  const H = H0 + 2 * py;
  const N = W * H;
  const rgba = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W0, H0).data;
  const solved = solveRoom(fit, W0, H0);
  const room = { ...solved, cx: solved.cx + px, cy: solved.cy + py, width: W, height: H };

  // Linear colour and luminance of the photo; `inside` marks real photo pixels.
  const lin = new Float32Array(N * 3);
  const Y = new Float32Array(N);
  const inside = new Uint8Array(N);
  for (let y = 0; y < H0; y++) {
    for (let x = 0; x < W0; x++) {
      const p = (y * W0 + x) * 4;
      const i = (y + py) * W + x + px;
      const r = SRGB_TO_LINEAR[rgba[p]];
      const g = SRGB_TO_LINEAR[rgba[p + 1]];
      const b = SRGB_TO_LINEAR[rgba[p + 2]];
      lin[i * 3] = r;
      lin[i * 3 + 1] = g;
      lin[i * 3 + 2] = b;
      Y[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      inside[i] = 1;
    }
  }

  // Surface, surface coordinates and texture footprint for every pixel.
  const surf = new Uint8Array(N);
  const su = new Float32Array(N);
  const sv = new Float32Array(N);
  const foot = new Float32Array(N);
  const { f, cx, cy, eyeY, depth, ceiling, xL, xR } = room;
  for (let y = 0; y < H; y++) {
    const dy = -(y + 0.5 - cy) / f;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const dx = (x + 0.5 - cx) / f;
      let t = depth;
      let s = BACK;
      if (dy < 0) {
        const tf = eyeY / -dy;
        if (tf < t) { t = tf; s = FLOOR; }
      } else if (dy > 0) {
        const tc = (ceiling - eyeY) / dy;
        if (tc < t) { t = tc; s = CEILING; }
      }
      if (dx < 0) {
        const tl = xL / dx;
        if (tl < t) { t = tl; s = LEFT; }
      } else if (dx > 0) {
        const tr = xR / dx;
        if (tr < t) { t = tr; s = RIGHT; }
      }
      const px = dx * t;
      const py = eyeY + dy * t;
      const pz = -t;
      surf[i] = s;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      let cos;
      if (s === FLOOR || s === CEILING) { su[i] = px; sv[i] = -pz; cos = Math.abs(dy) / len; }
      else if (s === LEFT) { su[i] = -pz; sv[i] = py; cos = Math.abs(dx) / len; }
      else if (s === RIGHT) { su[i] = pz; sv[i] = py; cos = Math.abs(dx) / len; }
      else { su[i] = px; sv[i] = py; cos = 1 / len; }
      foot[i] = (t * len) / f / Math.sqrt(Math.max(cos, 0.03));
    }
  }

  // Typical brightness of each surface (median of a subsample).
  const medians = [0, 1, 2, 3, 4].map((s) => {
    const values = [];
    for (let i = 0; i < N; i += 7) if (surf[i] === s && inside[i]) values.push(Y[i]);
    values.sort((a, b) => a - b);
    return values.length ? Math.max(1e-3, values[values.length >> 1]) : 0.1;
  });

  const openings = knownOpenings ?? detectOpenings({ W, H, surf, su, sv, Y, inside, medians, roomType });

  // Smooth lighting per surface (ignoring openings), at quarter resolution.
  const q = 4;
  const gw = Math.ceil(W / q);
  const gh = Math.ceil(H / q);
  const shadeMaps = [];
  for (let s = 0; s < 5; s++) {
    const val = new Float32Array(gw * gh);
    const wgt = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        let acc = 0;
        let n = 0;
        for (let y = gy * q; y < Math.min(H, gy * q + q); y++) {
          for (let x = gx * q; x < Math.min(W, gx * q + q); x++) {
            const i = y * W + x;
            if (surf[i] !== s || !inside[i] || insideOpening(openings, s, su[i], sv[i], 0.04)) continue;
            acc += Y[i];
            n++;
          }
        }
        val[gy * gw + gx] = acc;
        wgt[gy * gw + gx] = n;
      }
    }
    const radius = Math.max(2, Math.round(gw * 0.018));
    let bv = boxBlur(boxBlur(val, gw, gh, radius), gw, gh, radius);
    let bw = boxBlur(boxBlur(wgt, gw, gh, radius), gw, gh, radius);
    const map = new Float32Array(gw * gh);
    for (let i = 0; i < map.length; i++) map[i] = bw[i] > 0.02 ? bv[i] / bw[i] / medians[s] : 1;
    shadeMaps.push(map);
    bv = bw = null;
  }

  return { canvas, W, H, room, lin, Y, inside, surf, su, sv, foot, medians, openings, shadeMaps, gw, gh, q, roomType, padded: pad > 0 };
}

/** True when (u, v) on surface s lies inside a detected opening (+margin). */
function insideOpening(openings, s, u, v, margin = 0) {
  const key = SURFACE_KEYS[s];
  for (const o of openings) {
    if (o.surface === key && u > o.a0 - margin && u < o.a1 + margin && v > o.y0 - margin && v < o.y1 + margin) return o;
  }
  return null;
}

/**
 * Finds window and door openings: regions of a wall much brighter (daylight)
 * or much darker (an unlit room beyond) than the rest of that wall.
 * Returns rectangles in surface coordinates (metres).
 */
function detectOpenings({ W, H, surf, su, sv, Y, inside, medians, roomType }) {
  const q = 4;
  const gw = Math.floor(W / q);
  const gh = Math.floor(H / q);
  const cls = new Int8Array(gw * gh); // 1 bright, 2 dark
  const cellSurf = new Uint8Array(gw * gh);
  const exterior = roomType === 'exterior';
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let acc = 0;
      for (let y = gy * q; y < gy * q + q; y++) for (let x = gx * q; x < gx * q + q; x++) acc += Y[y * W + x];
      const i = (gy * q + q / 2) * W + gx * q + q / 2;
      const s = surf[i];
      cellSurf[gy * gw + gx] = s;
      if (!inside[i] || (exterior ? s !== BACK : !WALLS.includes(s))) continue;
      const v = acc / (q * q);
      if (!exterior && v > Math.max(0.3, medians[s] * 3)) cls[gy * gw + gx] = 1;
      else if (v < medians[s] * (exterior ? 0.35 : 0.45) && v < 0.15) cls[gy * gw + gx] = 2;
    }
  }

  const seen = new Uint8Array(gw * gh);
  const openings = [];
  const stack = [];
  for (let start = 0; start < cls.length; start++) {
    if (!cls[start] || seen[start]) continue;
    const kind = cls[start];
    const s = cellSurf[start];
    let count = 0;
    let minX = gw;
    let maxX = 0;
    let minY = gh;
    let maxY = 0;
    let a0 = Infinity;
    let a1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop();
      const cx = c % gw;
      const cy = (c / gw) | 0;
      count++;
      minX = Math.min(minX, cx);
      maxX = Math.max(maxX, cx);
      minY = Math.min(minY, cy);
      maxY = Math.max(maxY, cy);
      const i = (cy * q + q / 2) * W + cx * q + q / 2;
      a0 = Math.min(a0, su[i]);
      a1 = Math.max(a1, su[i]);
      y0 = Math.min(y0, sv[i]);
      y1 = Math.max(y1, sv[i]);
      for (const n of [c - 1, c + 1, c - gw, c + gw]) {
        if (n < 0 || n >= cls.length || seen[n] || cls[n] !== kind || cellSurf[n] !== s) continue;
        if ((n % gw === 0 && c % gw === gw - 1) || (c % gw === 0 && n % gw === gw - 1)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    const fill = count / ((maxX - minX + 1) * (maxY - minY + 1));
    const width = a1 - a0;
    const height = y1 - y0;
    if (count < 12 || fill < 0.45 || width < 0.35 || height < 0.45) continue;
    const touchesFloor = y0 < 0.3;
    let type;
    if (kind === 1) type = 'window';
    else if (touchesFloor && height > 1.4) type = 'door';
    else if (exterior) type = 'window';
    else continue; // a dark patch high on an interior wall is just shadow
    openings.push({ surface: SURFACE_KEYS[s], kind: type, a0, a1, y0: touchesFloor ? 0 : y0, y1, bright: kind === 1 });
  }
  return openings;
}

// ---------------------------------------------------------------------------
// three.js renderer for furniture (created once, reused)
// ---------------------------------------------------------------------------
let gl = null;
function getRenderer() {
  if (gl) return gl;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  gl = { renderer, envMap };
  return gl;
}

/** A camera that reproduces the photo's perspective (off-centre vanishing point). */
export function photoCamera(room, near = 0.05, far = 100) {
  const camera = new THREE.PerspectiveCamera(50, room.width / room.height, near, far);
  camera.position.set(0, room.eyeY, 0);
  const k = near / room.f;
  camera.projectionMatrix.makePerspective(-room.cx * k, (room.width - room.cx) * k, room.cy * k, -(room.height - room.cy) * k, near, far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.updateMatrixWorld();
  return camera;
}

/** Shadow-catching planes so furniture casts shadows onto the floor and walls. */
export function shadowCatchers(room, roomType) {
  const group = new THREE.Group();
  const mat = new THREE.ShadowMaterial({ opacity: 0.3 });
  const wallMat = new THREE.ShadowMaterial({ opacity: 0.14 });
  const w = room.xR - room.xL;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, room.depth + 2), mat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((room.xL + room.xR) / 2, 0, -room.depth / 2 + 1);
  floor.receiveShadow = true;
  group.add(floor);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, room.ceiling), wallMat);
  back.position.set((room.xL + room.xR) / 2, room.ceiling / 2, -room.depth + 0.001);
  back.receiveShadow = true;
  group.add(back);
  if (roomType !== 'exterior') {
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(room.depth + 2, room.ceiling), wallMat);
      wall.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      wall.position.set(side < 0 ? room.xL + 0.001 : room.xR - 0.001, room.ceiling / 2, -room.depth / 2 + 1);
      wall.receiveShadow = true;
      group.add(wall);
    }
  }
  return group;
}

/** Main light direction: from the first window if there is one. */
export function keyLightPosition(room, openings) {
  const w = openings.find((o) => o.kind === 'window' && o.bright);
  const midX = (room.xL + room.xR) / 2;
  if (w?.surface === 'left') return [room.xL - 2.5, room.ceiling + 4, -(w.a0 + w.a1) / 2];
  if (w?.surface === 'right') return [room.xR + 2.5, room.ceiling + 4, (w.a0 + w.a1) / 2];
  if (w?.surface === 'back') return [(w.a0 + w.a1) / 2, room.ceiling + 4, -room.depth - 2.5];
  return [midX + room.roomWidth * 0.3, room.ceiling + 2.5, 2];
}

function disposeTree(object) {
  object.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) for (const m of [].concat(o.material)) m.dispose();
  });
}

/** Renders the planned furniture to RGBA pixels (straight alpha). */
function renderFurniture(an, plan, spec, seed, styleHint) {
  const { renderer, envMap } = getRenderer();
  const { room, W, H } = an;
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.environment = envMap;
  scene.environmentIntensity = 0.45;
  const evening = spec.lighting.mood === 'evening';
  const level = spec.lighting.level * (evening ? 0.75 : 1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8178, 1.25 * level));
  const sun = new THREE.DirectionalLight(evening ? 0xffe2bd : 0xfff6ea, 1.5 * level);
  sun.position.set(...keyLightPosition(room, an.openings));
  sun.target.position.set((room.xL + room.xR) / 2, 0, -room.depth / 2);
  sun.castShadow = true;
  const span = Math.max(room.roomWidth, room.depth, room.ceiling) * 1.2 + 2;
  Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 0.1, far: span * 4 });
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 6;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35 * level);
  fill.position.set(0, room.eyeY + 0.5, 1.5);
  scene.add(fill);

  const objects = buildRoomObjects(plan, spec, room, seed, styleHint);
  scene.add(objects, shadowCatchers(room, an.roomType));
  renderer.render(scene, photoCamera(room));

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(renderer.domElement, 0, 0);
  disposeTree(scene);
  return ctx.getImageData(0, 0, W, H).data;
}

// ---------------------------------------------------------------------------
// 2-4. Compose, furniture, grade
// ---------------------------------------------------------------------------

/**
 * Renders the finished space.
 * @returns {{image: HTMLCanvasElement, finish: HTMLCanvasElement, plan: object}}
 *   image  - full render; finish - surfaces only (used by the 3D house)
 */
export function renderFinish(an, spec, { seed = 1, styleHint = 'minimalist', includeFurniture = true, plan: givenPlan = null, gain = null } = {}) {
  const { W, H, room, lin, Y, inside, surf, su, sv, foot, openings, shadeMaps, gw, gh, q, roomType, medians } = an;
  const N = W * H;
  const exterior = roomType === 'exterior';
  const evening = spec.lighting.mood === 'evening';
  const lc = lightColor(spec.lighting.temperature);
  const rand = seededRandom(seed);
  const plan = givenPlan ?? planRoom({ room, roomType, spec, openings, seed, styleHint });

  // Samplers for every material in play.
  const floorS = createSampler(spec.flooring.material, seed);
  const paintS = createSampler(spec.walls.finish === 'plaster' ? { type: 'plaster', base: spec.walls.paint, size: 3 } : { type: 'paint', base: spec.walls.paint, size: 2 }, seed);
  const accentS = spec.walls.accent ? createSampler(spec.walls.accent.material, seed + 1) : null;
  const lowerS = spec.walls.lower ? createSampler(spec.walls.lower.material, seed + 2) : null;
  const bandS = plan.bands.filter((b) => b.material).map((b) => ({ ...b, sampler: createSampler(b.material, seed + 3) }));
  const ceilType = spec.ceiling.type;
  const ceilS = ceilType === 'slats'
    ? createSampler({ type: 'slats', base: spec.ceiling.wood ?? '#a87b52', size: 1, pitch: 0.1 }, seed + 4)
    : createSampler({ type: 'paint', base: spec.ceiling.color, size: 2 }, seed + 4);
  const lawnS = exterior ? createSampler({ type: 'grass', base: spec.flooring.lawn ?? '#5f8a3a', size: 2 }, seed + 5) : null;
  const doorS = createSampler(exterior ? { type: 'slats', base: spec.fixtures.door, size: 1, pitch: 0.14, gap: '#2a221c' } : { type: 'paint', base: spec.fixtures.door, size: 1 }, seed + 6);
  const frameLin = hexToLinear(spec.fixtures.frames);
  const metalLin = hexToLinear(spec.fixtures.metalColor);
  const skirtLin = spec.fixtures.skirting ? hexToLinear(spec.fixtures.skirting) : null;
  const path = plan.bands.find((b) => b.path)?.path;
  const door = openings.find((o) => o.kind === 'door' && o.surface === 'back');

  const level = spec.lighting.level * (evening ? 0.62 : 1);
  const surfFactor = [1.0, ceilType === 'cove' ? 0.95 : 0.9, 1.0, 1.0, 1.0];
  const lightStrength = (evening ? 1.9 : 1.0) * 0.32;
  // Kept photo pixels: the view through windows turns to dusk in the evening.
  const keepTint = exterior ? [level, level, level] : evening ? [0.22, 0.27, 0.45] : [1, 1, 1];
  const out = new Float32Array(N * 3);
  const c = new Float32Array(3);
  const { xL, xR, depth, ceiling } = room;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const s = surf[i];
      const u = su[i];
      const v = sv[i];
      const fp = foot[i];
      let keep = false;
      let emissive = 0;

      // Lighting from the photo, normalised per surface.
      const gx = Math.min(gw - 1, x / q);
      const gyy = Math.min(gh - 1, y / q);
      const map = shadeMaps[s];
      const x0 = gx | 0;
      const y0 = gyy | 0;
      const x1 = Math.min(gw - 1, x0 + 1);
      const y1 = Math.min(gh - 1, y0 + 1);
      const fxx = gx - x0;
      const fyy = gyy - y0;
      const top = map[y0 * gw + x0] + (map[y0 * gw + x1] - map[y0 * gw + x0]) * fxx;
      const bot = map[y1 * gw + x0] + (map[y1 * gw + x1] - map[y1 * gw + x0]) * fxx;
      let shade = top + (bot - top) * fyy;
      shade = Math.pow(Math.min(2.6, Math.max(0.3, shade)), 0.8) * surfFactor[s] * level;

      const opening = s !== FLOOR && s !== CEILING ? insideOpening(openings, s, u, v) : null;
      const frame = !opening && s !== FLOOR && s !== CEILING ? insideOpening(openings, s, u, v, 0.06) : null;

      if (opening) {
        if (opening.kind === 'window' && opening.bright) {
          keep = true; // the real view outside
        } else if (opening.kind === 'window') {
          // Exterior glass: reflection of the sky, darker at the bottom.
          const t = (v - opening.y0) / Math.max(0.1, opening.y1 - opening.y0);
          c[0] = 0.08 + 0.18 * t;
          c[1] = 0.11 + 0.22 * t;
          c[2] = 0.16 + 0.3 * t;
          const mid = (opening.a0 + opening.a1) / 2;
          if (opening.a1 - opening.a0 > 0.9 && Math.abs(u - mid) < 0.03) c.set(frameLin);
          shade = level;
        } else {
          doorS.sample(u * 1.0, v, fp, c);
          const handleU = opening.a1 - 0.1;
          if (Math.abs(u - handleU) < 0.025 && Math.abs(v - 1.0) < 0.1) c.set(metalLin);
        }
      } else if (frame) {
        c.set(frameLin);
        shade *= 1.05;
      } else if (s === FLOOR) {
        if (exterior) {
          const onPath = path && u > path.x0 && u < path.x1;
          const apron = v > depth - 0.8;
          if (onPath || apron) floorS.sample(u, v, fp, c);
          else lawnS.sample(u, v, fp, c);
        } else {
          floorS.sample(u, v, fp, c);
        }
      } else if (s === CEILING) {
        if (exterior) {
          // Replace open sky; keep trees, roofs and anything else.
          const p = i * 3;
          const isSky = !inside[i] || (lin[p + 2] > lin[p] * 1.05 && Y[i] > 0.25) || Y[i] > 0.6;
          if (isSky) {
            const t = Math.min(1, Math.max(0, (room.cy - y) / room.cy));
            const golden = spec.ceiling.sky === 'golden';
            c[0] = golden ? 0.75 - 0.45 * t : 0.62 - 0.5 * t;
            c[1] = golden ? 0.62 - 0.35 * t : 0.74 - 0.48 * t;
            c[2] = golden ? 0.55 - 0.1 * t : 0.92 - 0.25 * t;
            const cloud = Math.max(0, Math.sin(x * 0.006 + rand() * 0.02) * Math.sin(y * 0.02) - 0.55) * 0.6;
            c[0] += cloud;
            c[1] += cloud;
            c[2] += cloud;
            shade = 1;
          } else {
            keep = true;
          }
        } else {
          const dEdge = Math.min(u - xL, xR - u, depth - v);
          ceilS.sample(u, v, fp, c);
          if (ceilType === 'exposed') {
            // Painted concrete: keep the photo's surface detail.
            const detail = inside[i] ? Math.min(1.4, Math.max(0.6, Y[i] / (medians[CEILING] * Math.max(0.3, shade / level)))) : 1;
            c[0] *= detail;
            c[1] *= detail;
            c[2] *= detail;
          } else if (ceilType === 'cove') {
            if (dEdge < 0.5) shade *= 0.93;
            else if (dEdge < 0.56) shade *= 0.55;
            else emissive += 0.55 * Math.exp(-(dEdge - 0.56) / 0.22) * (evening ? 1.6 : 1);
          }
        }
      } else if (exterior && s !== BACK) {
        keep = true; // surroundings beside the house
      } else {
        // Walls.
        let done = false;
        if (skirtLin && !exterior && v < 0.085) {
          c.set(skirtLin);
          if (v > 0.075) shade *= 0.8;
          done = true;
        }
        if (!done) {
          for (const b of bandS) {
            if (b.surface === SURFACE_KEYS[s] && u > b.a0 && u < b.a1 && v > b.y0 && v < b.y1) {
              b.sampler.sample(u, v, fp, c);
              done = true;
              break;
            }
          }
        }
        if (!done && lowerS && v < spec.walls.lower.height) {
          lowerS.sample(u, v, fp, c);
          done = true;
        }
        if (!done && accentS) {
          const useAccent = exterior
            ? door ? Math.abs(u - (door.a0 + door.a1) / 2) < (door.a1 - door.a0) / 2 + 0.9 && v < door.y1 + 0.5 : v < 0.6
            : s === BACK;
          if (useAccent) {
            accentS.sample(u, v, fp, c);
            done = true;
          }
        }
        if (!done) paintS.sample(u, v, fp, c);
      }

      const o = i * 3;
      if (keep && !inside[i]) {
        // Outside the photo there is nothing to keep: use a plausible fill.
        if (s === CEILING) {
          out[o] = 0.35; out[o + 1] = 0.5; out[o + 2] = 0.78;
        } else {
          out[o] = 0.16 * level; out[o + 1] = 0.2 * level; out[o + 2] = 0.12 * level;
        }
        continue;
      }
      if (keep) {
        out[o] = lin[o] * keepTint[0];
        out[o + 1] = lin[o + 1] * keepTint[1];
        out[o + 2] = lin[o + 2] * keepTint[2];
        continue;
      }

      // Downlights: bright disc on the ceiling, pools and scallops elsewhere.
      let add = 0;
      if (plan.downlights.length && !opening) {
        const px = s === FLOOR || s === CEILING ? u : s === LEFT ? xL : s === RIGHT ? xR : u;
        const py = s === FLOOR ? 0 : s === CEILING ? ceiling : v;
        const pz = s === FLOOR || s === CEILING ? -v : s === LEFT ? -u : s === RIGHT ? u : -depth;
        const nx = s === LEFT ? 1 : s === RIGHT ? -1 : 0;
        const ny = s === FLOOR ? 1 : s === CEILING ? -1 : 0;
        const nz = s === BACK ? 1 : 0;
        for (const L of plan.downlights) {
          const lx = L[0] - px;
          const ly = L[1] - 0.02 - py;
          const lz = L[2] - pz;
          if (s === CEILING) {
            const d2 = lx * lx + lz * lz;
            if (d2 < 0.045 * 0.045) emissive += 4;
            else if (d2 < 0.06 * 0.06) emissive += 0.4;
            continue;
          }
          const d2 = lx * lx + ly * ly + lz * lz;
          const d = Math.sqrt(d2);
          const cosDown = ly / d; // angle from straight down
          if (cosDown < 0.5) continue;
          const cone = Math.min(1, (cosDown - 0.5) / 0.37);
          const lambert = Math.max(0, (lx * nx + ly * ny + lz * nz) / d);
          add += (cone * cone * lambert) / Math.max(0.25, d2);
        }
      }

      // Daylight is only slightly tinted; artificial light carries its full colour.
      const lamp = add * lightStrength;
      const tint = 0.3 + 0.5 * Math.min(1, lamp / Math.max(0.05, shade));
      const light = shade + lamp;
      out[o] = c[0] * light * (1 + (lc[0] - 1) * tint) + emissive * lc[0];
      out[o + 1] = c[1] * light * (1 + (lc[1] - 1) * tint) + emissive * lc[1];
      out[o + 2] = c[2] * light * (1 + (lc[2] - 1) * tint) + emissive * lc[2];
    }
  }

  smoothSurfaceEdges(out, surf, W, H);
  const finishBuf = out.slice();

  // Furniture and fittings.
  if (includeFurniture && plan.items.length) {
    const furn = renderFurniture(an, plan, spec, seed, styleHint);
    for (let i = 0, p = 0; i < N; i++, p += 4) {
      const a = furn[p + 3] / 255;
      if (a === 0) continue;
      const o = i * 3;
      out[o] = out[o] * (1 - a) + SRGB_TO_LINEAR[furn[p]] * a;
      out[o + 1] = out[o + 1] * (1 - a) + SRGB_TO_LINEAR[furn[p + 1]] * a;
      out[o + 2] = out[o + 2] * (1 - a) + SRGB_TO_LINEAR[furn[p + 2]] * a;
    }
    addGlows(out, an, plan, lc, evening);
  }

  const image = grade(out, W, H, spec, exterior, gain);
  return {
    image: image.canvas,
    finish: grade(finishBuf, W, H, spec, exterior, gain ?? image.gain).canvas,
    plan,
    gain: image.gain,
  };
}

/** Softens the stair-stepped edges where two surfaces meet. */
function smoothSurfaceEdges(buf, surf, W, H) {
  const copy = buf.slice();
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const s = surf[i];
      if (s === surf[i + 1] && s === surf[i + W] && s === surf[i - 1] && s === surf[i - W]) continue;
      for (let ch = 0; ch < 3; ch++) {
        let acc = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) acc += copy[(i + dy * W + dx) * 3 + ch];
        buf[i * 3 + ch] = acc / 9;
      }
    }
  }
}

/** Soft light halos around lamps, pendants and sconces. */
function addGlows(buf, an, plan, lc, evening) {
  const { room, W, H } = an;
  for (const g of plan.glows) {
    const y = g.pos[1] ?? room.ceiling - (g.drop ?? 0.8) - 0.12;
    const z = g.pos[2];
    if (z > -0.2) continue;
    const s = room.f / -z;
    const px = room.cx + g.pos[0] * s;
    const py = room.cy - (y - room.eyeY) * s;
    const R = g.radius * s;
    const strength = g.intensity * (evening ? 1.0 : 0.45);
    const x0 = Math.max(0, Math.floor(px - R));
    const x1 = Math.min(W - 1, Math.ceil(px + R));
    const y0 = Math.max(0, Math.floor(py - R));
    const y1 = Math.min(H - 1, Math.ceil(py + R));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const d = Math.hypot(xx - px, yy - py) / R;
        if (d >= 1) continue;
        const k = (1 - d) * (1 - d) * strength;
        const o = (yy * W + xx) * 3;
        buf[o] += k * lc[0];
        buf[o + 1] += k * lc[1];
        buf[o + 2] += k * lc[2];
      }
    }
  }
}

/** Final colour grade and conversion to an sRGB canvas. */
function grade(buf, W, H, spec, exterior, fixedGain = null) {
  const evening = spec.lighting.mood === 'evening';
  const N = W * H;
  // Gentle auto-exposure towards a bright, airy finished look.
  let sum = 0;
  let n = 0;
  for (let i = 0; i < N; i += 13) {
    sum += 0.2126 * buf[i * 3] + 0.7152 * buf[i * 3 + 1] + 0.0722 * buf[i * 3 + 2];
    n++;
  }
  const mean = sum / n;
  const target = evening ? 0.2 : exterior ? 0.3 : 0.34;
  const gain = fixedGain ?? Math.min(1.45, Math.max(0.8, Math.sqrt(target / Math.max(0.02, mean))));

  // Bloom: blurred highlights at quarter resolution.
  const q = 4;
  const bw = Math.ceil(W / q);
  const bh = Math.ceil(H / q);
  const bright = [0, 1, 2].map(() => new Float32Array(bw * bh));
  for (let y = 0; y < H; y += q) {
    for (let x = 0; x < W; x += q) {
      const o = (y * W + x) * 3;
      const b = ((y / q) | 0) * bw + ((x / q) | 0);
      for (let ch = 0; ch < 3; ch++) bright[ch][b] = Math.max(0, buf[o + ch] * gain - 0.9);
    }
  }
  const radius = Math.max(2, Math.round(bw / 60));
  const bloom = bright.map((m) => boxBlur(boxBlur(m, bw, bh, radius), bw, bh, radius));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const shoulder = (v) => (v < 0.8 ? v : 0.8 + 0.2 * (1 - Math.exp(-(v - 0.8) / 0.2)));
  for (let y = 0; y < H; y++) {
    const vy = (y / H - 0.5) * 2;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const vx = (x / W - 0.5) * 2;
      const vignette = 1 - 0.1 * (vx * vx + vy * vy);
      const b = ((y / q) | 0) * bw + ((x / q) | 0);
      for (let ch = 0; ch < 3; ch++) {
        const v = buf[i * 3 + ch] * gain * vignette + bloom[ch][b] * 0.35;
        d[i * 4 + ch] = linearToSrgb(shoulder(v));
      }
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, gain };
}

/**
 * Mask for editing one element with an AI model: transparent where the
 * element is (the area allowed to change), opaque elsewhere.
 */
export function elementMask(an, element) {
  const { W, H, surf } = an;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const editable = {
    flooring: [FLOOR],
    walls: [LEFT, RIGHT, BACK],
    ceiling: [CEILING],
  }[element];
  for (let i = 0; i < W * H; i++) {
    img.data[i * 4 + 3] = editable ? (editable.includes(surf[i]) ? 0 : 255) : 0;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
