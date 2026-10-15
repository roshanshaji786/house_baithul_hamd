/**
 * Before/after comparison views: a draggable slider, side by side, or the
 * finished render alone. The slider works with mouse, touch and keyboard
 * (an invisible range input carries focus and arrow keys).
 */
import { h } from './dom.js';

let lastPosition = 50;

export function compareView(beforeUrl, afterUrl, mode = 'slider') {
  if (mode === 'side') {
    return h('div', { class: 'side-by-side' },
      h('figure', {}, h('img', { src: beforeUrl, alt: 'Before: the unfinished photo' }), h('figcaption', {}, 'Before')),
      h('figure', {}, h('img', { src: afterUrl, alt: 'After: the finished render' }), h('figcaption', {}, 'After')),
    );
  }
  if (mode === 'after') {
    return h('img', { class: 'after-only', src: afterUrl, alt: 'The finished render' });
  }

  const root = h('div', { class: 'compare', style: { '--pos': `${lastPosition}%` } });
  const range = h('input', {
    type: 'range', min: 0, max: 100, step: 0.5, value: lastPosition,
    'aria-label': 'Before and after comparison: move to reveal more of the before photo or the render',
  });
  const set = (pct) => {
    lastPosition = Math.min(100, Math.max(0, pct));
    root.style.setProperty('--pos', `${lastPosition}%`);
    range.value = lastPosition;
  };
  range.addEventListener('input', () => set(Number(range.value)));
  const fromEvent = (e) => {
    const rect = root.getBoundingClientRect();
    set(((e.clientX - rect.left) / rect.width) * 100);
  };
  root.addEventListener('pointerdown', (e) => {
    root.setPointerCapture(e.pointerId);
    fromEvent(e);
  });
  root.addEventListener('pointermove', (e) => {
    if (root.hasPointerCapture(e.pointerId)) fromEvent(e);
  });

  root.append(
    h('img', { src: beforeUrl, alt: 'Before: the unfinished photo', draggable: false }),
    h('div', { class: 'after' }, h('img', { src: afterUrl, alt: 'After: the finished render', draggable: false })),
    h('div', { class: 'handle', 'aria-hidden': 'true' }),
    h('span', { class: 'label before' }, 'Before'),
    h('span', { class: 'label after-label' }, 'After'),
    range,
  );
  return root;
}

/** Combines before and after into one side-by-side image for download. */
export async function comparisonImage(beforeBlob, afterBlob, caption) {
  const [a, b] = await Promise.all([createImageBitmap(beforeBlob), createImageBitmap(afterBlob)]);
  const height = Math.min(1080, b.height);
  const wa = Math.round((a.width / a.height) * height);
  const wb = Math.round((b.width / b.height) * height);
  const gap = 12;
  const bar = 56;
  const canvas = document.createElement('canvas');
  canvas.width = wa + wb + gap;
  canvas.height = height + bar;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(a, 0, 0, wa, height);
  ctx.drawImage(b, wa + gap, 0, wb, height);
  ctx.fillStyle = '#222';
  ctx.font = '600 22px system-ui, sans-serif';
  ctx.fillText('Before', 16, height + 36);
  ctx.fillText('After', wa + gap + 16, height + 36);
  ctx.font = '16px system-ui, sans-serif';
  ctx.fillStyle = '#666';
  // Truncate the note so it can never run off the right edge.
  const maxWidth = canvas.width - (wa + gap + 86);
  let note = `${caption} · Made with Shell to Home · visual preview, not a construction plan`;
  while (note.length > 8 && ctx.measureText(note).width > maxWidth) note = `${note.slice(0, -2)}…`;
  ctx.fillText(note, canvas.width - ctx.measureText(note).width - 16, height + 36);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the before/after image'))), 'image/jpeg', 0.92));
}
