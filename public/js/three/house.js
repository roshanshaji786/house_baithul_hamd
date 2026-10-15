/**
 * 3D house built from the renders.
 *
 * Each rendered photo becomes a room: a box sized from the photo's room fit,
 * whose floor, walls and ceiling are textured by projecting the finished
 * image back from the camera position it was taken from ("camera
 * projection", the classic tour-into-the-picture technique). Free-preview
 * renders also bring their real 3D furniture, so it has proper depth when
 * the camera moves. Rooms are laid out side by side like an open dollhouse.
 *
 * The walkthrough is a timeline of camera "shots" (exterior approach, house
 * overview, one walk per room, closing overview) with fades and captions.
 */
import * as THREE from 'three';
import { buildRoomObjects } from '../render/furniture.js';
import { shadowCatchers, keyLightPosition } from '../render/localRenderer.js';
import { solveRoom } from '../lib/geometry.js';
import { roomLabel } from '../catalog.js';

const WALL_GAP = 0.25; // gap between rooms in the overview (wall thickness)

/** Builds a subdivided quad whose UVs project the texture from the photo camera. */
function projectedQuad(p00, p10, p01, p11, inward, room, segments = 24) {
  const positions = [];
  const uvs = [];
  const lerp = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
  for (let j = 0; j <= segments; j++) {
    for (let i = 0; i <= segments; i++) {
      const p = lerp(lerp(p00, p10, i / segments), lerp(p01, p11, i / segments), j / segments);
      positions.push(...p);
      const z = Math.min(p[2], -0.05);
      const u = (room.cx + (room.f * p[0]) / -z) / room.width;
      const v = (room.cy - (room.f * (p[1] - room.eyeY)) / -z) / room.height;
      uvs.push(u, 1 - v);
    }
  }
  const index = [];
  const row = segments + 1;
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * row + i;
      index.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  // Make sure triangles face into the room.
  const e1 = p10.map((v, k) => v - p00[k]);
  const e2 = p01.map((v, k) => v - p00[k]);
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  if (n[0] * inward[0] + n[1] * inward[1] + n[2] * inward[2] < 0) {
    for (let k = 0; k < index.length; k += 3) [index[k + 1], index[k + 2]] = [index[k + 2], index[k + 1]];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** Texture from a Blob (drawn to a canvas so orientation is predictable). */
async function textureFromBlob(blob) {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d').drawImage(bmp, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  return { tex, width: bmp.width, height: bmp.height };
}

/** Room name label floating above a room in the overview. */
function label(text) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(20,20,20,0.75)';
  ctx.beginPath();
  ctx.roundRect(4, 14, 504, 68, 34);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '600 40px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text.slice(0, 24), 256, 62);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  sprite.scale.set(2.4, 0.45, 1);
  sprite.userData.noExport = true;
  return sprite;
}

/**
 * Builds one room group in room space (camera of the photo at (0, eyeY, 0)).
 * @param {object} entry { name, roomType, render, photo }
 */
async function buildRoom(entry) {
  const { render, photo } = entry;
  const local = render.engine === 'local' && render.finishBlob && render.plan;
  const { tex, width, height } = await textureFromBlob(local ? render.finishBlob : render.blob);
  // Geometry: the padded camera saved with free renders, or the photo's fit
  // applied to the AI image (AI renders keep the photo's composition).
  const room = local ? render.plan.room : solveRoom(photo.fit, width, height);
  const { xL, xR, depth: D, ceiling: Hc, f, cx, cy, eyeY } = room;
  // Each surface starts where the texture begins to cover it; nearer than
  // that the photo has no information, so the box is left open (a cutaway)
  // instead of smearing the image's edge pixels.
  const start = (dist) => Math.min(-0.05, -dist);
  const zFloor = start((f * eyeY) / Math.max(1, room.height - cy));
  const zCeil = start((f * (Hc - eyeY)) / Math.max(1, cy));
  const zLeft = start((f * -xL) / Math.max(1, cx));
  const zRight = start((f * xR) / Math.max(1, room.width - cx));
  // How far in the walkthrough camera must start so the edges of its view
  // (about 59° sideways while panning, 28° down, 24° up) stay on textured surfaces.
  const safeStart = Math.max(
    0.25,
    -zLeft - -xL / Math.tan(1.03),
    -zRight - xR / Math.tan(1.03),
    -zFloor - eyeY / Math.tan(0.49),
    -zCeil - (Hc - eyeY) / Math.tan(0.41),
  );
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const faces = [
    [[xL, 0, zFloor], [xR, 0, zFloor], [xL, 0, -D], [xR, 0, -D], [0, 1, 0], zFloor],
    [[xL, Hc, -D], [xR, Hc, -D], [xL, Hc, zCeil], [xR, Hc, zCeil], [0, -1, 0], zCeil],
    [[xL, 0, zLeft], [xL, 0, -D], [xL, Hc, zLeft], [xL, Hc, -D], [1, 0, 0], zLeft],
    [[xR, 0, -D], [xR, 0, zRight], [xR, Hc, -D], [xR, Hc, zRight], [-1, 0, 0], zRight],
    [[xL, 0, -D], [xR, 0, -D], [xL, Hc, -D], [xR, Hc, -D], [0, 0, 1], 0],
  ];
  for (const [a, b, c, d, n, z0] of faces) {
    if (z0 < -D + 0.05) continue; // not visible in the texture at all
    const mesh = new THREE.Mesh(projectedQuad(a, b, c, d, n, room), mat);
    mesh.userData.surface = true;
    group.add(mesh);
  }
  // Light outline of the walls' top edges for the "model" look from above.
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(xR - xL, Hc, D)),
    new THREE.LineBasicMaterial({ color: 0xd8d2c8, transparent: true, opacity: 0.6 }),
  );
  outline.position.set((xL + xR) / 2, Hc / 2, -D / 2);
  outline.userData.noExport = true;
  group.add(outline);

  let lightPos = null;
  if (local) {
    const plan = render.plan;
    group.add(buildRoomObjects({ items: plan.items }, plan.spec, room, plan.seed, plan.styleHint));
    const catchers = shadowCatchers(room, entry.roomType);
    catchers.userData.noExport = true;
    group.add(catchers);
    lightPos = keyLightPosition(room, plan.openings ?? []);
  }
  return { group, room, lightPos, texture: tex, safeStart: Math.min(safeStart, Math.max(0.25, D - 2.2)) };
}

/**
 * Builds the whole house.
 * @param {{name, roomType, render, photo}[]} entries  in walkthrough order
 */
export async function buildHouse(entries) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1d1c1b);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8178, 1.4));
  const sun = new THREE.DirectionalLight(0xfff4e6, 1.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const rooms = [];
  const labels = [];
  let cursor = 0;
  for (const entry of entries) {
    const built = await buildRoom(entry);
    const exterior = entry.roomType === 'exterior';
    const { room } = built;
    // Interiors side by side with their far walls aligned at z = 0;
    // the exterior sits well in front of the house, used for the opening shot.
    const offset = exterior
      ? new THREE.Vector3(-room.xL + cursor, 0, room.depth + 60)
      : new THREE.Vector3(cursor - room.xL, 0, room.depth);
    built.group.position.copy(offset);
    scene.add(built.group);
    if (!exterior) {
      const tag = label(entry.name);
      tag.position.set(offset.x + (room.xL + room.xR) / 2, room.ceiling + 0.8, 0.4 - room.depth / 2);
      scene.add(tag);
      labels.push(tag);
      cursor += room.xR - room.xL + WALL_GAP;
    }
    rooms.push({ ...built, entry, offset, exterior });
  }

  // Ground and overall bounds.
  const interiors = rooms.filter((r) => !r.exterior);
  const bounds = new THREE.Box3();
  for (const r of interiors) {
    bounds.expandByPoint(new THREE.Vector3(r.offset.x + r.room.xL, 0, 0));
    bounds.expandByPoint(new THREE.Vector3(r.offset.x + r.room.xR, r.room.ceiling, r.offset.z));
  }
  if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-3, 0, 0), new THREE.Vector3(3, 3, 5));
  const center = bounds.getCenter(new THREE.Vector3());
  const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 48), new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  ground.userData.noExport = true;
  scene.add(ground);

  // One shadow-casting sun over the whole house.
  const size = bounds.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z) / 2 + 4;
  sun.position.set(center.x + span * 0.4, 14, center.z + span * 0.6);
  sun.target.position.copy(center);
  Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 60 });
  sun.shadow.camera.updateProjectionMatrix();

  /** Room labels only make sense when looking at the whole house. */
  const showLabels = (visible) => labels.forEach((l) => (l.visible = visible));
  return { scene, rooms, bounds, center, showLabels };
}

// ---------------------------------------------------------------------------
// Walkthrough timeline
// ---------------------------------------------------------------------------
const ease = (t) => t * t * (3 - 2 * t);
const FADE = 0.6;

/**
 * Creates the camera path for a house.
 * @param {object} house  result of buildHouse
 * @param {number} pace   1 = normal; larger = slower
 */
export function buildTimeline(house, title, pace = 1) {
  const shots = [];
  const add = (kind, seconds, extra = {}) => {
    const start = shots.length ? shots.at(-1).end : 0;
    shots.push({ kind, start, end: start + seconds * pace, ...extra });
  };
  const exterior = house.rooms.find((r) => r.exterior);
  const interiors = house.rooms.filter((r) => !r.exterior);
  if (exterior) add('exterior', 6, { room: exterior, caption: exterior.entry.name });
  if (interiors.length) add('overview', 6, { caption: title });
  for (const r of interiors) add('room', 8, { room: r, caption: `${r.entry.name} · ${roomLabel(r.entry.roomType)}` });
  add('outro', 4, { caption: title });
  const duration = shots.at(-1).end;

  const size = house.bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.z) * 0.75 + 5;

  /** Camera position, look-at target and vertical field of view at time t. */
  function cameraAt(t) {
    const shot = shots.find((s) => t < s.end) ?? shots.at(-1);
    const u = Math.min(1, Math.max(0, (t - shot.start) / (shot.end - shot.start)));
    const e = ease(u);
    const c = house.center;
    if (shot.kind === 'room' || shot.kind === 'exterior') {
      const { room, offset, safeStart } = shot.room;
      const room0 = safeStart ?? 0.25;
      const walk = shot.kind === 'exterior'
        ? Math.min(room.depth * 0.35, 4)
        : Math.max(0, Math.min(room.depth * 0.4, room.depth - 1.9 - room0));
      const yaw = shot.kind === 'exterior' ? 0 : -0.32 + 0.64 * e;
      const pos = new THREE.Vector3(offset.x, room.eyeY + (shot.kind === 'exterior' ? 0.3 * e : 0), offset.z - room0 - walk * e);
      const pitch = shot.kind === 'exterior' ? 0.06 : -0.04;
      const target = pos.clone().add(new THREE.Vector3(Math.sin(yaw), pitch, -Math.cos(yaw)));
      return { pos, target, fov: 52 };
    }
    // Overview orbit (and a slow pull-back for the outro).
    const angle = shot.kind === 'outro' ? 0.5 + 0.3 * e : -0.6 + 1.1 * e;
    const r = shot.kind === 'outro' ? radius * (1 + 0.25 * e) : radius;
    const pos = new THREE.Vector3(c.x + Math.sin(angle) * r, r * 0.72, c.z + Math.cos(angle) * r);
    return { pos, target: new THREE.Vector3(c.x, 0.8, c.z - 0.5), fov: 40 };
  }

  /** Overlay state at time t: fade to black between shots, captions. */
  function overlayAt(t) {
    const shot = shots.find((s) => t < s.end) ?? shots.at(-1);
    const fromStart = t - shot.start;
    const toEnd = shot.end - t;
    let fade = 0;
    if (fromStart < FADE) fade = 1 - fromStart / FADE;
    if (toEnd < FADE && shot !== shots.at(-1)) fade = Math.max(fade, 1 - toEnd / FADE);
    if (shot === shots.at(-1)) fade = Math.max(fade, Math.min(1, (t - (shot.end - 1.2)) / 1.2) * 0.85);
    return { fade: Math.min(1, Math.max(0, fade)), caption: shot.caption, kind: shot.kind };
  }

  return { duration, shots, cameraAt, overlayAt };
}

/** Draws captions, the end card and fades over a rendered frame. */
export function drawOverlay(ctx, width, height, overlay, title) {
  const s = height / 720;
  if (overlay.caption && overlay.kind !== 'outro') {
    ctx.font = `600 ${Math.round(30 * s)}px system-ui, sans-serif`;
    const text = overlay.caption;
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.roundRect(28 * s, height - 92 * s, w + 40 * s, 56 * s, 28 * s);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, 48 * s, height - 54 * s);
  }
  if (overlay.kind === 'outro') {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.round(44 * s)}px system-ui, sans-serif`;
    ctx.fillText(title, width / 2, height / 2 - 10 * s);
    ctx.font = `${Math.round(22 * s)}px system-ui, sans-serif`;
    ctx.fillStyle = '#ddd';
    ctx.fillText('Visual preview only - not a construction or engineering plan', width / 2, height / 2 + 34 * s);
    ctx.textAlign = 'start';
  }
  if (overlay.fade > 0) {
    ctx.fillStyle = `rgba(0,0,0,${overlay.fade})`;
    ctx.fillRect(0, 0, width, height);
  }
}

/** Frees GPU memory used by a house. */
export function disposeHouse(house) {
  house?.scene.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material ?? [])) {
      m.map?.dispose();
      m.dispose();
    }
  });
}
