/**
 * Room box editor. The user drags the corners of the far wall and the
 * vanishing point (where floor and ceiling lines meet). Lines from the
 * vanishing point through each corner show where the walls meet the floor
 * and ceiling, which makes it easy to line the box up with the photo.
 */
import { clampFit, solveRoom, describeRoomSize, LENSES, defaultFit } from '../lib/geometry.js';
import { h } from './dom.js';

const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

/**
 * @param {string} imageUrl
 * @param {object} photo   photo record (fit, width, height)
 * @param {{onChange: (fit) => void, onDone: () => void, onAuto: () => void}} handlers
 */
export function fitEditor(imageUrl, photo, { onChange, onDone, onAuto }) {
  let fit = clampFit(structuredClone(photo.fit));
  const W = photo.width;
  const H = photo.height;

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Room box overlay' });
  const shade = s('path', { fill: 'rgba(0,0,0,0.25)', 'fill-rule': 'evenodd' });
  const lines = s('g', { stroke: '#ffb547', 'stroke-width': Math.max(2, W / 500), 'stroke-dasharray': `${W / 120} ${W / 200}` });
  const rect = s('rect', { fill: 'rgba(31,111,107,0.12)', stroke: '#fff', 'stroke-width': Math.max(2, W / 400) });
  const r = Math.max(10, W / 70);
  const corners = ['tl', 'tr', 'br', 'bl'].map((id) => s('circle', { r, class: 'handle-pt', 'data-id': id, tabindex: 0, 'aria-label': `Far wall corner ${id}` }));
  const vp = s('circle', { r: r * 0.8, class: 'vp-pt', 'data-id': 'vp', tabindex: 0, 'aria-label': 'Vanishing point' });
  svg.append(shade, lines, rect, ...corners, vp);

  const size = h('span', { class: 'small muted' });
  const lens = h('select', { 'aria-label': 'Camera lens' },
    Object.entries(LENSES).map(([id, l]) => h('option', { value: id, selected: id === fit.lens }, l.label)));
  lens.addEventListener('change', () => update({ ...fit, lens: lens.value }));

  function draw() {
    const { x0, y0, x1, y1 } = fit.back;
    const px = (v) => v * W;
    const py = (v) => v * H;
    rect.setAttribute('x', px(x0));
    rect.setAttribute('y', py(y0));
    rect.setAttribute('width', px(x1 - x0));
    rect.setAttribute('height', py(y1 - y0));
    const pts = { tl: [x0, y0], tr: [x1, y0], br: [x1, y1], bl: [x0, y1] };
    corners.forEach((c) => {
      const [x, y] = pts[c.dataset.id];
      c.setAttribute('cx', px(x));
      c.setAttribute('cy', py(y));
    });
    vp.setAttribute('cx', px(fit.vp.x));
    vp.setAttribute('cy', py(fit.vp.y));
    // Lines from the vanishing point through each corner to the frame edge.
    lines.replaceChildren(
      ...Object.values(pts).map(([x, y]) => {
        const dx = x - fit.vp.x;
        const dy = y - fit.vp.y;
        const t = Math.min(dx > 0 ? (1 - fit.vp.x) / dx : dx < 0 ? -fit.vp.x / dx : Infinity, dy > 0 ? (1 - fit.vp.y) / dy : dy < 0 ? -fit.vp.y / dy : Infinity);
        return s('line', { x1: px(fit.vp.x), y1: py(fit.vp.y), x2: px(fit.vp.x + dx * t), y2: py(fit.vp.y + dy * t) });
      }),
    );
    shade.setAttribute('d', `M0 0H${W}V${H}H0Z M${px(x0)} ${py(y0)}H${px(x1)}V${py(y1)}H${px(x0)}Z`);
    size.textContent = `Estimated room: ${describeRoomSize(solveRoom(fit, W, H))} (assumes the photo was taken at about 1.5 m height)`;
  }

  function update(next) {
    fit = clampFit({ ...next, auto: false });
    draw();
    onChange(fit);
  }

  // Dragging handles (pointer events cover mouse, touch and pen).
  let dragging = null;
  const toFit = (e) => {
    const box = svg.getBoundingClientRect();
    return [(e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height];
  };
  svg.addEventListener('pointerdown', (e) => {
    const id = e.target.dataset?.id;
    if (!id) return;
    dragging = id;
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const [x, y] = toFit(e);
    const b = { ...fit.back };
    if (dragging === 'vp') return update({ ...fit, vp: { x, y } });
    if (dragging.includes('l')) b.x0 = x;
    if (dragging.includes('r')) b.x1 = x;
    if (dragging.includes('t')) b.y0 = y;
    if (dragging.includes('b')) b.y1 = y;
    update({ ...fit, back: b });
  });
  const stop = () => (dragging = null);
  svg.addEventListener('pointerup', stop);
  svg.addEventListener('pointercancel', stop);

  // Keyboard nudging for accessibility.
  svg.addEventListener('keydown', (e) => {
    const id = e.target.dataset?.id;
    const step = e.shiftKey ? 0.02 : 0.005;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!id || !d) return;
    e.preventDefault();
    if (id === 'vp') return update({ ...fit, vp: { x: fit.vp.x + d[0], y: fit.vp.y + d[1] } });
    const b = { ...fit.back };
    if (id.includes('l')) b.x0 += d[0];
    if (id.includes('r')) b.x1 += d[0];
    if (id.includes('t')) b.y0 += d[1];
    if (id.includes('b')) b.y1 += d[1];
    update({ ...fit, back: b });
  });

  draw();
  return h('div', {},
    h('div', { class: 'fit-editor' }, h('img', { src: imageUrl, alt: 'Your photo with the room box overlay', draggable: false }), svg),
    h('div', { class: 'fit-help' },
      h('span', { class: 'small' }, 'Drag the white corners onto the far wall\'s corners, and the orange dot to where the floor and ceiling lines meet.'),
      h('label', { class: 'inline small' }, 'Lens', lens),
      h('button', { type: 'button', class: 'btn small secondary', onclick: () => onAuto() }, 'Auto-detect'),
      h('button', { type: 'button', class: 'btn small secondary', onclick: () => { lens.value = 'main'; update(defaultFit()); } }, 'Reset'),
      h('button', { type: 'button', class: 'btn small primary', onclick: () => onDone() }, 'Done'),
    ),
    size,
  );
}
