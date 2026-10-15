/**
 * Furniture planning: pieces stay inside the room, avoid doorways and adapt
 * to the room type. (Planning is pure maths; meshes are not built here.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRoom } from '../public/js/render/furniture.js';
import { solveRoom } from '../public/js/lib/geometry.js';
import { presetSpec } from '../public/js/render/styles.js';

const room = solveRoom({ back: { x0: 0.18, y0: 0.215, x1: 0.83, y1: 0.748 }, vp: { x: 0.5, y: 0.483 }, lens: 'main' }, 1600, 1200);
const kinds = (plan) => plan.items.map((i) => i.kind);
const inside = (it) => it.x > room.xL - 0.01 && it.x < room.xR + 0.01 && it.z < 0 && it.z > -room.depth - 0.01;

test('living room has a sofa against the far wall, all inside the room', () => {
  const plan = planRoom({ room, roomType: 'living', spec: presetSpec('scandinavian', 'living'), openings: [] });
  assert.ok(kinds(plan).includes('sofa') && kinds(plan).includes('rug'));
  const sofa = plan.items.find((i) => i.kind === 'sofa');
  assert.ok(Math.abs(sofa.z - (-room.depth + sofa.d / 2 + 0.02)) < 1e-6);
  assert.ok(plan.items.every(inside));
});

test('the sofa never blocks a doorway in the far wall', () => {
  const door = { surface: 'back', kind: 'door', a0: -0.6, a1: 0.6, y0: 0, y1: 2.1 };
  const plan = planRoom({ room, roomType: 'living', spec: presetSpec('minimalist', 'living'), openings: [door] });
  const sofa = plan.items.find((i) => i.kind === 'sofa');
  if (sofa && sofa.rot === 0) assert.ok(sofa.x - sofa.w / 2 >= door.a1 || sofa.x + sofa.w / 2 <= door.a0, JSON.stringify(sofa));
});

test('windows get curtains; kitchens get cabinets and a splashback band', () => {
  const window = { surface: 'left', kind: 'window', a0: 3, a1: 4.2, y0: 0.9, y1: 2.2, bright: true };
  const living = planRoom({ room, roomType: 'living', spec: presetSpec('luxury', 'living'), openings: [window] });
  assert.equal(kinds(living).filter((k) => k === 'curtain').length, 2);
  const kitchen = planRoom({ room, roomType: 'kitchen', spec: presetSpec('industrial', 'kitchen'), openings: [] });
  assert.ok(kinds(kitchen).includes('baseRun') && kinds(kitchen).includes('hob'));
  assert.ok(kitchen.bands.some((b) => b.surface === 'back' && b.y0 > 0.8));
});

test('downlights follow the lighting spec', () => {
  const spec = presetSpec('minimalist', 'bedroom');
  assert.ok(planRoom({ room, roomType: 'bedroom', spec, openings: [] }).downlights.length > 0);
  spec.lighting.downlights = false;
  assert.equal(planRoom({ room, roomType: 'bedroom', spec, openings: [] }).downlights.length, 0);
});
