/**
 * End-to-end browser tests for the app UI (no API keys needed).
 *
 * These tests run against the real server with a real headless Chromium,
 * including WebGL rendering through SwiftShader (software), so the full
 * render pipeline, 3D house and video export paths are exercised.
 *
 * Run with:  npm run test:browser
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { launchBrowser, newPage, hasWebGL } from './helpers/browser.mjs';

const PORT = 3117;
const BASE = `http://127.0.0.1:${PORT}/`;
let server = null;
let browser = null;

before(async () => {
  server = spawn('node', ['server/index.js'], {
    cwd: new URL('../..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 15000);
    const check = (data) => {
      if (String(data).includes('running at')) {
        clearTimeout(timer);
        resolve();
      }
    };
    server.stdout.on('data', check);
    server.stderr.on('data', check);
    server.on('exit', (code) => reject(new Error(`server exited early: ${code}`)));
  });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  server?.kill('SIGTERM');
});

test('the app loads without console errors and WebGL is available', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button', { timeout: 10000 });
  assert.equal(await page.title(), 'Shell to Home – See your bare-shell house finished, free in your browser');
  assert.ok(await hasWebGL(page), 'WebGL2 must be available for the renderer');
  assert.ok((await page.$$('#style-grid button')).length >= 5, 'five preset styles');
  page.assertNoConsoleErrors('on load');
  await page.close();
});

test('api/config reports the free engine when no keys are set', async () => {
  const page = await newPage(browser, { url: BASE });
  const config = await page.evaluate(async () => await (await fetch('api/config')).json());
  assert.equal(config.providers.local.available, true);
  assert.equal(config.providers.openai.available, false);
  assert.equal(config.providers.gemini.available, false);
  assert.equal(config.analysis.claude, false);
  await page.close();
});

test('sample photos load with thumbnails and a room-size estimate', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  await page.click('#load-samples');
  await page.waitForFunction(() => document.querySelectorAll('#photo-list li').length >= 4, null, { timeout: 20000 });
  const first = await page.textContent('#photo-list li .name');
  assert.match(first, /Living room/);
  await page.waitForFunction(() => document.querySelector('#room-size')?.textContent.includes('m wide'), null, { timeout: 10000 });
  const roomSize = await page.textContent('#room-size');
  assert.match(roomSize, /Estimated room: \d+\.\d m wide × \d+\.\d m deep × \d+\.\d m high/);
  page.assertNoConsoleErrors('after loading samples');
  await page.close();
});

test('rendering the sample living room produces a before/after comparison', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  await page.click('#load-samples');
  await page.waitForFunction(() => document.querySelectorAll('#photo-list li').length >= 4, null, { timeout: 20000 });
  await page.click('#render-btn');
  await page.waitForSelector('#viewer .compare', { timeout: 120000 });
  await page.waitForSelector('#viewer-controls:not([hidden])', { timeout: 10000 });
  // The slider handle exists and labels are shown.
  assert.ok(await page.$('#viewer .compare .handle'));
  assert.match(await page.textContent('#viewer .compare .label.before'), /Before/);
  assert.match(await page.textContent('#viewer .compare .label.after-label'), /After/);
  // The render info block lists the preset style.
  await page.waitForFunction(() => document.querySelector('#render-info')?.textContent.includes('Free preview'), null, { timeout: 10000 });
  page.assertNoConsoleErrors('during render');
  await page.close();
});

test('the before/after slider responds to pointer drags', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  await page.click('#load-samples');
  await page.waitForFunction(() => document.querySelectorAll('#photo-list li').length >= 4, null, { timeout: 20000 });
  await page.click('#render-btn');
  const compare = await page.waitForSelector('#viewer .compare', { timeout: 120000 });
  const box = await compare.boundingBox();
  const before = await compare.evaluate((el) => el.style.getPropertyValue('--pos'));
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5, { steps: 5 });
  await page.mouse.up();
  const after = await compare.evaluate((el) => el.style.getPropertyValue('--pos'));
  assert.notEqual(before, after, 'slider position should change after dragging');
  await page.close();
});

test('side-by-side and after-only views switch correctly', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  await page.click('#load-samples');
  await page.waitForFunction(() => document.querySelectorAll('#photo-list li').length >= 4, null, { timeout: 20000 });
  await page.click('#render-btn');
  await page.waitForSelector('#viewer .compare', { timeout: 120000 });
  await page.click('[data-compare="side"]');
  await page.waitForSelector('#viewer .side-by-side');
  assert.equal((await page.$$('#viewer .side-by-side figure')).length, 2);
  await page.click('[data-compare="after"]');
  await page.waitForSelector('#viewer img.after-only');
  await page.click('[data-compare="slider"]');
  await page.waitForSelector('#viewer .compare');
  await page.close();
});

test('switching preset style marks the render stale and auto-updates', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  await page.click('#load-samples');
  await page.waitForFunction(() => document.querySelectorAll('#photo-list li').length >= 4, null, { timeout: 20000 });
  await page.click('#render-btn');
  await page.waitForSelector('#viewer .compare', { timeout: 120000 });
  // Pick a different style; auto-update is on by default.
  await page.click('#style-grid button:has-text("Scandinavian")');
  await page.waitForFunction(() => {
    const info = document.querySelector('#render-info');
    return info && info.textContent.includes('Scandinavian');
  }, null, { timeout: 60000 });
  page.assertNoConsoleErrors('after auto-update');
  await page.close();
});

test('single-element edit changes only the floor and keeps the rest', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  await page.click('#load-samples');
  await page.waitForFunction(() => document.querySelectorAll('#photo-list li').length >= 4, null, { timeout: 20000 });
  await page.click('#render-btn');
  await page.waitForSelector('#viewer .compare', { timeout: 120000 });
  // Change the flooring to terrazzo through the element editor.
  await page.click('#element-tabs button[role="tab"]:has-text("Flooring")');
  await page.click('#element-form .option:has-text("Terrazzo")');
  await page.click('#element-form button:has-text("Apply flooring change")');
  await page.waitForFunction(() => {
    const info = document.querySelector('#render-info');
    return info && info.textContent.includes('changed: Flooring');
  }, null, { timeout: 120000 });
  page.assertNoConsoleErrors('after element edit');
  await page.close();
});

test('saved renders appear in the Saved tab and can be removed', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  await page.click('#load-samples');
  await page.waitForFunction(() => document.querySelectorAll('#photo-list li').length >= 4, null, { timeout: 20000 });
  await page.click('#render-btn');
  await page.waitForSelector('#viewer .compare', { timeout: 120000 });
  await page.click('#save-btn');
  await page.waitForFunction(() => document.querySelector('#saved-count')?.textContent === '1');
  await page.click('[data-tab="saved"]');
  await page.waitForSelector('#gallery figure img');
  assert.ok(await page.$('#gallery .actions button:has-text("Download")'));
  await page.click('#gallery .actions button:has-text("Remove")');
  await page.waitForFunction(() => document.querySelector('#saved-count')?.textContent === '0');
  page.assertNoConsoleErrors('saving flow');
  await page.close();
});

test('project rename and new-project flows work', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  // Rename the current project.
  page.once('dialog', (d) => d.accept('Villa Test'));
  await page.click('#project-rename');
  await page.waitForFunction(() => document.querySelector('#project-select')?.selectedOptions[0]?.textContent === 'Villa Test');
  // Create a second project.
  page.once('dialog', (d) => d.accept('Flat Test'));
  await page.click('#project-new');
  await page.waitForFunction(() => document.querySelector('#project-select')?.selectedOptions[0]?.textContent === 'Flat Test');
  // Switch back to the first project via the select.
  const villaValue = await page.$$eval(
    '#project-select option',
    (opts) => opts.find((o) => o.textContent === 'Villa Test')?.value,
  );
  assert.ok(villaValue, 'the Villa Test option exists');
  await page.selectOption('#project-select', villaValue);
  await page.waitForFunction(() => document.querySelector('#project-select')?.selectedOptions[0]?.textContent === 'Villa Test');
  page.assertNoConsoleErrors('project flows');
  await page.close();
});

test('deleting a project does not resurrect it', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  // Create a throwaway project and delete it.
  page.once('dialog', (d) => d.accept('Doomed Project'));
  await page.click('#project-new');
  await page.waitForFunction(() => document.querySelector('#project-select')?.selectedOptions[0]?.textContent === 'Doomed Project');
  page.once('dialog', (d) => d.accept());
  await page.click('#project-delete');
  await page.waitForFunction(() => {
    const sel = document.querySelector('#project-select');
    return sel && ![...sel.options].some((o) => o.textContent === 'Doomed Project');
  }, null, { timeout: 15000 });
  // Reload: the deleted project must still be gone after a fresh load.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#style-grid button');
  const names = await page.$$eval('#project-select option', (opts) => opts.map((o) => o.textContent));
  assert.ok(!names.includes('Doomed Project'), `deleted project must not reappear, got: ${names.join(', ')}`);
  await page.close();
});

test('adjust room box opens the fitting editor with draggable corners', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  await page.click('#load-samples');
  await page.waitForFunction(() => document.querySelectorAll('#photo-list li').length >= 4, null, { timeout: 20000 });
  await page.click('#fit-toggle');
  await page.waitForSelector('.fit-editor svg');
  const corners = await page.$$('.fit-editor svg circle');
  assert.equal(corners.length, 5, 'four corners plus the vanishing point');
  // The living-room sample's far wall starts at about (18%, 21%); drag the
  // top-left corner from there towards the centre of the photo.
  const box = await (await page.$('.fit-editor svg')).boundingBox();
  const before = await corners[0].getAttribute('cx');
  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.215);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.28, box.y + box.height * 0.3, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(
    (oldX) => document.querySelector('.fit-editor svg circle')?.getAttribute('cx') !== oldX,
    before,
    { timeout: 5000 },
  );
  await page.click('#fit-toggle'); // close
  await page.waitForFunction(() => !document.querySelector('.fit-editor'));
  page.assertNoConsoleErrors('fit editor');
  await page.close();
});

test('the 3D house tab builds from rendered photos and shows the player', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  await page.click('#load-samples');
  await page.waitForFunction(() => document.querySelectorAll('#photo-list li').length >= 4, null, { timeout: 20000 });
  await page.click('#render-btn');
  await page.waitForSelector('#viewer .compare', { timeout: 120000 });
  await page.click('[data-tab="house"]');
  await page.waitForSelector('#house-stage canvas:not([hidden])', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('#house-player')?.hidden);
  // Play the walkthrough briefly.
  await page.click('#house-play');
  await page.waitForTimeout(1500);
  const time = await page.textContent('#house-time');
  assert.match(time, /\d:\d\d \/ \d:\d\d/);
  // Explore mode with orbit controls.
  await page.click('[data-house-mode="explore"]');
  await page.waitForTimeout(300);
  page.assertNoConsoleErrors('3D house');
  await page.close();
});

test('reference images can be added, labelled and removed', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  await page.click('#load-samples');
  await page.waitForFunction(() => document.querySelectorAll('#photo-list li').length >= 4, null, { timeout: 20000 });
  // Use the bundled sample references button.
  await page.click('#ref-list button:has-text("Try sample references")');
  await page.waitForFunction(() => document.querySelectorAll('#ref-list li.file-item').length >= 2, null, { timeout: 20000 });
  const labels = await page.$$eval('#ref-list input[type="text"]', (inputs) => inputs.map((i) => i.value));
  assert.ok(labels.some((l) => /oak floor/i.test(l)), `floor reference label, got ${labels}`);
  // Remove the first reference (a hint <li> stays behind, so count file items).
  await page.click('#ref-list li.file-item .icon-btn[aria-label*="Remove"]');
  await page.waitForFunction(() => document.querySelectorAll('#ref-list li.file-item').length === 1);
  page.assertNoConsoleErrors('references');
  await page.close();
});

test('a render with a flooring reference uses it and lists the effect', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  await page.click('#load-samples');
  await page.waitForFunction(() => document.querySelectorAll('#photo-list li').length >= 4, null, { timeout: 20000 });
  await page.click('#ref-list button:has-text("Try sample references")');
  await page.waitForFunction(() => document.querySelectorAll('#ref-list li.file-item').length >= 2, null, { timeout: 20000 });
  await page.click('#render-btn');
  await page.waitForSelector('#viewer .compare', { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('#render-info')?.textContent.includes('References used'), null, { timeout: 10000 });
  const info = await page.textContent('#render-info');
  assert.match(info, /floor(ing)? (texture|colour|material)/i);
  page.assertNoConsoleErrors('reference render');
  await page.close();
});

test('renders survive a page reload (IndexedDB persistence)', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  await page.click('#load-samples');
  await page.waitForFunction(() => document.querySelectorAll('#photo-list li').length >= 4, null, { timeout: 20000 });
  await page.click('#render-btn');
  await page.waitForSelector('#viewer .compare', { timeout: 120000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#photo-list li', { timeout: 20000 });
  await page.waitForSelector('#viewer .compare', { timeout: 30000 });
  assert.ok((await page.$$('#photo-list li')).length >= 4, 'photos persist');
  page.assertNoConsoleErrors('after reload');
  await page.close();
});

test('unsupported files are rejected with a friendly message', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  const chooser = page.waitForEvent('filechooser');
  await page.click('#photo-drop');
  const input = await chooser;
  await input.setFiles([
    {
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image'),
    },
  ]);
  await page.waitForSelector('.toast.error', { timeout: 10000 });
  const toast = await page.textContent('.toast.error');
  assert.match(toast, /not a supported image|could not be opened|Could not add/i);
  // No photo was added.
  await page.waitForTimeout(500);
  assert.equal((await page.$$('#photo-list li')).length, 0);
  await page.close();
});

test('switching photos discards a pending element-editor draft', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  await page.click('#load-samples');
  await page.waitForFunction(() => document.querySelectorAll('#photo-list li').length >= 4, null, { timeout: 20000 });
  // Start a flooring edit on the living room (first photo) but do not apply it.
  await page.click('#element-tabs button[role="tab"]:has-text("Flooring")');
  await page.click('#element-form .option:has-text("Polished concrete")');
  assert.ok(await page.$('#element-form .form-actions .small.muted'), 'pending-change hint shown');
  // Switch to the bedroom photo: the draft must be gone.
  await page.click('#photo-list button.name:has-text("Bedroom")');
  await page.waitForFunction(() => document.querySelector('#workspace-photo-name')?.textContent.includes('Bedroom'));
  await page.waitForFunction(() => !document.querySelector('#element-form .form-actions .small.muted'), null, { timeout: 10000 });
  page.assertNoConsoleErrors('draft reset');
  await page.close();
});

test('mobile layout: no horizontal overflow, sticky tabs, touch slider', async () => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    hasTouch: true,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#style-grid button');

  const noOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  // Design tab, empty state.
  assert.ok(await noOverflow(), 'no horizontal overflow (design, empty)');

  // Load samples, render, and re-check every tab.
  await page.click('#load-samples');
  await page.waitForFunction(() => document.querySelectorAll('#photo-list li').length >= 4, null, { timeout: 30000 });
  await page.click('#render-btn');
  await page.waitForSelector('#viewer .compare', { timeout: 120000 });
  assert.ok(await noOverflow(), 'no horizontal overflow (design, rendered)');

  // Touch the compare slider at 80% width: the position must move.
  const handle = await page.$('#viewer .compare');
  const box = await handle.boundingBox();
  await page.touchscreen.tap(box.x + box.width * 0.8, box.y + box.height * 0.5);
  await page.waitForFunction(() => {
    const el = document.querySelector('#viewer .compare');
    return el && Math.abs(parseFloat(el.style.getPropertyValue('--pos')) - 80) < 6;
  }, null, { timeout: 5000 });

  // House and saved tabs.
  await page.click('[data-tab="house"]');
  await page.waitForSelector('#house-stage canvas:not([hidden])', { timeout: 60000 });
  assert.ok(await noOverflow(), 'no horizontal overflow (house tab)');
  await page.click('[data-tab="saved"]');
  await page.waitForTimeout(300);
  assert.ok(await noOverflow(), 'no horizontal overflow (saved tab)');

  // The sticky tab bar sticks to the top after scrolling.
  await page.click('[data-tab="design"]');
  await page.evaluate(() => document.querySelector('#editor')?.scrollIntoView());
  await page.waitForTimeout(300);
  const tabsTop = await page.$eval('.tabs', (el) => el.getBoundingClientRect().top);
  assert.ok(Math.abs(tabsTop) < 2, `tabs stick to the top when scrolled (got ${tabsTop})`);

  assert.deepEqual(errors, [], 'no page errors on mobile');
  await context.close();
});

test('walkthrough video export starts, reports progress and can be cancelled', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  await page.click('#load-samples');
  await page.waitForFunction(() => document.querySelectorAll('#photo-list li').length >= 4, null, { timeout: 20000 });
  await page.click('#render-btn');
  await page.waitForSelector('#viewer .compare', { timeout: 120000 });
  await page.click('[data-tab="house"]');
  await page.waitForSelector('#house-stage canvas:not([hidden])', { timeout: 60000 });
  await page.selectOption('#video-quality', '720');
  await page.selectOption('#video-speed', '0.75');
  await page.click('#video-btn');
  // Progress must appear and advance past the first frames...
  await page.waitForSelector('#video-progress:not([hidden])', { timeout: 20000 });
  await page.waitForFunction(() => {
    const bar = document.querySelector('#video-bar');
    return bar && Number(bar.value) >= 1;
  }, null, { timeout: 120000 });
  // ...then cancel; the UI must recover.
  await page.click('#video-cancel');
  await page.waitForFunction(() => document.querySelector('#video-status')?.textContent.includes('cancelled'), null, { timeout: 60000 });
  assert.equal(await page.$eval('#video-btn', (b) => b.disabled), false, 'export button re-enabled after cancel');
  page.assertNoConsoleErrors('video export');
  await page.close();
});

test('the 3D model (.glb) downloads', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  await page.click('#load-samples');
  await page.waitForFunction(() => document.querySelectorAll('#photo-list li').length >= 4, null, { timeout: 20000 });
  await page.click('#render-btn');
  await page.waitForSelector('#viewer .compare', { timeout: 120000 });
  await page.click('[data-tab="house"]');
  await page.waitForSelector('#house-stage canvas:not([hidden])', { timeout: 60000 });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 180000 }),
    page.click('#glb-btn'),
  ]);
  const path = await download.path();
  const { stat } = await import('node:fs/promises');
  const info = await stat(path);
  assert.ok(info.size > 50_000, `glb should be substantial, got ${info.size} bytes`);
  assert.match(download.suggestedFilename(), /\.glb$/);
  page.assertNoConsoleErrors('glb export');
  await page.close();
});

test('every room type renders: bedroom, kitchen, exterior and bathroom', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  await page.click('#load-samples');
  await page.waitForFunction(() => document.querySelectorAll('#photo-list li').length >= 4, null, { timeout: 20000 });

  // The samples cover bedroom, kitchen and exterior directly.
  for (const name of ['Bedroom', 'Kitchen', 'Front of house']) {
    await page.click(`#photo-list button.name:has-text("${name}")`);
    await page.waitForFunction((n) => document.querySelector('#workspace-photo-name')?.textContent.includes(n), name);
    await page.click('#render-btn');
    await page.waitForSelector('#viewer .compare', { timeout: 180000 });
  }

  // Bathroom: switch the living room photo's room type and render.
  await page.click('#photo-list button.name:has-text("Living room")');
  await page.waitForFunction(() => document.querySelector('#workspace-photo-name')?.textContent.includes('Living room'));
  await page.selectOption('#room-type', 'bathroom');
  await page.click('#render-btn');
  await page.waitForSelector('#viewer .compare', { timeout: 180000 });
  // The render info describes the bathroom spec (vanity, mirror).
  assert.match(await page.textContent('#render-info'), /vanity/i);
  page.assertNoConsoleErrors('all room types');
  await page.close();
});

test('element editor forms build for every element on interior and exterior photos', async () => {
  const page = await newPage(browser, { url: BASE });
  await page.waitForSelector('#style-grid button');
  await page.click('#load-samples');
  await page.waitForFunction(() => document.querySelectorAll('#photo-list li').length >= 4, null, { timeout: 20000 });

  const clickTab = async (label) => {
    await page.click(`#element-tabs button[role="tab"]:has-text("${label}")`);
    await page.waitForFunction(
      (l) => [...document.querySelectorAll('#element-tabs button')].some((b) => b.getAttribute('aria-selected') === 'true' && b.textContent.includes(l)),
      label,
    );
    await page.waitForTimeout(150); // let the async form build
    const hasForm = await page.$('#element-form .form-row, #element-form .option-grid');
    assert.ok(hasForm, `form renders for tab ${label}`);
  };

  // Interior (living room): all interior elements.
  for (const tab of ['Flooring', 'Walls', 'Ceiling', 'Lighting', 'Fixtures', 'Furniture']) {
    await clickTab(tab);
  }
  // Kitchen photo shows the cabinets tab too.
  await page.click('#photo-list button.name:has-text("Kitchen")');
  await page.waitForFunction(() => document.querySelector('#workspace-photo-name')?.textContent.includes('Kitchen'));
  await clickTab('Cabinets');
  // Exterior: relabelled tabs must still build forms.
  await page.click('#photo-list button.name:has-text("Front of house")');
  await page.waitForFunction(() => document.querySelector('#workspace-photo-name')?.textContent.includes('Front of house'));
  for (const tab of ['Garden', 'Facade', 'Sky', 'Lighting', 'Fixtures', 'Planting']) {
    await clickTab(tab);
  }
  page.assertNoConsoleErrors('element forms');
  await page.close();
});
