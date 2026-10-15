/**
 * Unit tests for the pure modules shared by the browser and server.
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveRoom, project, castRay, clampFit, defaultFit, SURFACE, boxBlur, guessBackWall } from '../public/js/lib/geometry.js';
import { measureQuality, judgeQuality, extractPalette, hexToRgb, rgbToHex, mixHex } from '../public/js/lib/imageTools.js';
import { presetSpec, describeSpec, applyReferences, applyOverrides, colorName, resolveSpec } from '../public/js/render/styles.js';
import { detectConflicts } from '../public/js/render/references.js';
import { STYLE_PRESETS, ROOM_TYPES, ELEMENTS } from '../public/js/catalog.js';

const fit = { back: { x0: 0.2, y0: 0.22, x1: 0.8, y1: 0.75 }, vp: { x: 0.5, y: 0.48 }, lens: 'main' };

test('room solve gives plausible dimensions and round-trips projection', () => {
  const room = solveRoom(fit, 1600, 1200);
  assert.ok(room.depth > 2 && room.depth < 12, `depth ${room.depth}`);
  assert.ok(room.ceiling > 2 && room.ceiling < 5, `ceiling ${room.ceiling}`);
  assert.ok(room.xL < 0 && room.xR > 0);
  // The far wall's bottom-left corner projects back to the rectangle corner.
  const [u, v] = project(room, room.xL, 0, -room.depth);
  assert.ok(Math.abs(u - 0.2 * 1600) < 1e-6 && Math.abs(v - 0.75 * 1200) < 1e-6);
  // A ray through the bottom centre hits the floor; through the top, the ceiling.
  assert.equal(castRay(room, 800, 1190).surface, SURFACE.FLOOR);
  assert.equal(castRay(room, 800, 10).surface, SURFACE.CEILING);
  assert.equal(castRay(room, 5, 600).surface, SURFACE.LEFT);
  assert.equal(castRay(room, 800, 600).surface, SURFACE.BACK);
  const hit = castRay(room, 400, 1100);
  const [pu, pv] = project(room, hit.x, hit.y, hit.z);
  assert.ok(Math.abs(pu - 400) < 1e-6 && Math.abs(pv - 1100) < 1e-6);
});

test('clampFit keeps the vanishing point inside the far wall', () => {
  const f = clampFit({ ...defaultFit(), vp: { x: 2, y: -1 } });
  assert.ok(f.vp.x < f.back.x1 && f.vp.y > f.back.y0);
  const g = clampFit({ ...defaultFit(), back: { x0: 0.9, x1: 0.1, y0: 0.5, y1: 0.2 } });
  assert.ok(g.back.x1 > g.back.x0 && g.back.y1 > g.back.y0);
});

test('box blur preserves a constant image', () => {
  const src = new Float32Array(30 * 20).fill(0.5);
  const out = boxBlur(src, 30, 20, 3);
  assert.ok(out.every((v) => Math.abs(v - 0.5) < 1e-6));
});

test('guessBackWall finds a drawn box or declines', () => {
  const W = 200;
  const H = 150;
  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inBack = x > 50 && x < 150 && y > 40 && y < 110;
      lum[y * W + x] = inBack ? 0.7 : y < 40 ? 0.9 : y > 110 ? 0.35 : 0.55;
    }
  }
  const back = guessBackWall(lum, W, H);
  if (back) {
    assert.ok(Math.abs(back.y0 - 40 / H) < 0.05 && Math.abs(back.y1 - 110 / H) < 0.05, JSON.stringify(back));
  }
  assert.equal(guessBackWall(new Float32Array(W * H).fill(0.5), W, H), null);
});

test('quality checks flag dark, small and flat images', () => {
  const W = 64;
  const H = 48;
  const dark = new Float32Array(W * H).map((_, i) => ((i * 7) % 13) / 130);
  const d = judgeQuality(measureQuality(dark, W, H), 1600, 1200, 'photo');
  assert.ok(d.errors.some((e) => /dark/i.test(e)));
  const flat = new Float32Array(W * H).fill(0.5);
  assert.ok(judgeQuality(measureQuality(flat, W, H), 1600, 1200).errors.some((e) => /unclear/i.test(e)));
  const sharp = new Float32Array(W * H).map((_, i) => ((i % W) > 32 ? 0.8 : 0.2) + ((i * 13) % 7) / 70);
  const s = judgeQuality(measureQuality(sharp, W, H), 300, 200, 'photo');
  assert.ok(s.errors.some((e) => /too small/i.test(e)));
  assert.ok(!s.errors.some((e) => /dark|blurry/i.test(e)));
});

test('palette extraction finds the main colours', () => {
  const W = 40;
  const H = 40;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const c = i < (W * H) / 2 ? [200, 50, 40] : [30, 90, 200];
    data.set([...c, 255], i * 4);
  }
  const palette = extractPalette(data, W, H, 3);
  assert.ok(palette.length >= 2);
  const hexes = palette.map((p) => p.hex);
  assert.ok(hexes.includes('#c83228') && hexes.includes('#1e5ac8'), hexes.join(','));
});

test('colour helpers', () => {
  assert.deepEqual(hexToRgb('#ff8000'), [255, 128, 0]);
  assert.equal(rgbToHex([255, 128, 0]), '#ff8000');
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(colorName('#f7f6f2'), 'warm white');
  assert.match(colorName('#1f3a4d'), /blue/);
  assert.match(colorName('#c0603e'), /terracotta|red/);
});

test('every preset produces a complete spec for every room type', () => {
  for (const preset of STYLE_PRESETS) {
    for (const room of ROOM_TYPES) {
      const spec = presetSpec(preset.id, room.id);
      for (const key of ['flooring', 'walls', 'ceiling', 'lighting', 'fixtures']) assert.ok(spec[key], `${preset.id}/${room.id} ${key}`);
      assert.ok(spec.flooring.material?.type);
      const text = describeSpec(spec, room.id);
      assert.ok(text.flooring && text.walls && text.ceiling && text.lighting && text.fixtures);
      if (['kitchen', 'bathroom'].includes(room.id)) assert.ok(text.cabinets, `${preset.id}/${room.id} cabinets`);
    }
  }
});

const fakeAnalysis = (overrides = {}) => ({
  palette: [
    { rgb: [240, 236, 228], hex: '#f0ece4', weight: 0.5 },
    { rgb: [168, 181, 162], hex: '#a8b5a2', weight: 0.25 },
    { rgb: [201, 123, 90], hex: '#c97b5a', weight: 0.15 },
    { rgb: [62, 74, 79], hex: '#3e4a4f', weight: 0.1 },
  ],
  average: [200, 190, 180],
  uniformity: 0.3,
  outdoors: false,
  floorColor: [170, 120, 80],
  warmth: 0.12,
  brightness: 0.7,
  aspect: 4 / 3,
  textureCanvas: null,
  ...overrides,
});

test('references change only what their role controls', () => {
  const base = presetSpec('minimalist', 'living');
  const palette = applyReferences(base, [{ id: 'r1', label: 'Palette', role: 'palette', analysis: fakeAnalysis() }], 'living');
  assert.notEqual(palette.spec.walls.paint, base.walls.paint);
  assert.deepEqual(palette.spec.flooring, base.flooring, 'a palette must not change the floor');
  assert.equal(palette.used[0].id, 'r1');

  const floor = applyReferences(base, [{ id: 'r2', label: 'Room', role: 'flooring', analysis: fakeAnalysis() }], 'living');
  assert.match(floor.spec.flooring.name, /wood planks/);
  assert.equal(floor.spec.walls.paint, base.walls.paint, 'a flooring reference must not change the walls');

  const dup = applyReferences(base, [
    { id: 'a', label: 'A', role: 'flooring', analysis: fakeAnalysis() },
    { id: 'b', label: 'B', role: 'flooring', analysis: fakeAnalysis() },
  ], 'living');
  assert.ok(dup.used[1].skipped);
});

test('element overrides win over references and presets', () => {
  const { spec } = resolveSpec({
    presetId: 'scandinavian',
    roomType: 'living',
    references: [{ id: 'r1', label: 'Palette', role: 'palette', analysis: fakeAnalysis() }],
    overrides: { walls: { paint: '#123456' } },
  });
  assert.equal(spec.walls.paint, '#123456');
  const s2 = applyOverrides(presetSpec('luxury', 'living'), { flooring: { name: 'Test floor', material: { type: 'concrete', base: '#999999' } } });
  assert.equal(s2.flooring.name, 'Test floor');
  assert.equal(s2.walls.paint, presetSpec('luxury', 'living').walls.paint);
});

test('conflict checks explain mismatches', () => {
  const photo = { roomType: 'bedroom', aspect: 4 / 3 };
  const warnings = detectConflicts(photo, [
    { id: 'k', label: 'Kitchen idea', role: 'kitchen', analysis: fakeAnalysis() },
    { id: 's', label: 'Garden', role: 'style', analysis: fakeAnalysis({ outdoors: true }) },
    { id: 'f', label: 'Whole room', role: 'flooring', analysis: fakeAnalysis({ uniformity: 0.2 }) },
    { id: 'p', label: 'Tall photo', role: 'style', analysis: fakeAnalysis({ aspect: 0.6 }) },
  ]);
  const ids = warnings.map((w) => w.refId);
  assert.ok(ids.includes('k') && ids.includes('s') && ids.includes('f') && ids.includes('p'), JSON.stringify(warnings));
  assert.ok(warnings.every((w) => /photo|layout|used/i.test(w.message)));
  assert.deepEqual(detectConflicts({ roomType: 'kitchen', aspect: 4 / 3 }, [{ id: 'k', label: 'K', role: 'kitchen', analysis: fakeAnalysis() }]), []);
});

test('catalogue ids are unique', () => {
  for (const list of [ROOM_TYPES, ELEMENTS, STYLE_PRESETS]) {
    assert.equal(new Set(list.map((x) => x.id)).size, list.length);
  }
});
