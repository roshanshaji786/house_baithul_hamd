/**
 * Tests for the static build (dist/) used on GitHub Pages and other hosts:
 * the app must work with no Node server at all, falling back to the free
 * in-browser engine and reporting the AI engines as unavailable.
 *
 * Run with:  npm run test:browser   (builds dist/ first if needed)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { launchBrowser, newPage } from './helpers/browser.mjs';

const root = new URL('../..', import.meta.url).pathname;
const dist = `${root}/dist`;
const PORT = 3118;
const BASE = `http://127.0.0.1:${PORT}/`;

let server = null;
let browser = null;

before(async () => {
  // Build the static site (skipped when dist/ is already fresh).
  if (!existsSync(`${dist}/vendor/three/build/three.module.js`)) {
    execSync('npm run build:static', { cwd: root, stdio: 'inherit' });
  }
  // A dumb static file server: enough for these tests.
  server = spawn('node', ['-e', `
    const http = require('node:http');
    const fs = require('node:fs');
    const path = require('node:path');
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
    http.createServer((req, res) => {
      let p = path.join('${dist}', decodeURIComponent(req.url.split('?')[0]));
      if (req.url.endsWith('/')) p += 'index.html';
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' });
        res.end(data);
      });
    }).listen(${PORT}, '127.0.0.1');
  `], { stdio: ['ignore', 'ignore', 'pipe'] });
  await new Promise((resolve) => setTimeout(resolve, 500));
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  server?.kill('SIGTERM');
});

test('the static build loads and falls back to the free engine', async () => {
  const page = await newPage(browser, { url: BASE, ignore: (t) => /api\/config|404/.test(t) });
  await page.waitForSelector('#style-grid button', { timeout: 10000 });
  // The engine selector must show local as the only available engine.
  const state = await page.evaluate(() => ({
    engine: document.querySelector('#engine-select')?.value,
    options: [...document.querySelectorAll('#engine-select option')].map((o) => [o.value, o.disabled]),
  }));
  assert.equal(state.engine, 'local');
  assert.ok(state.options.some(([id, disabled]) => id === 'openai' && disabled), 'openai disabled on static');
  page.assertNoConsoleErrors('static load');
  await page.close();
});

test('the static build can render with sample photos (no server needed)', async () => {
  const page = await newPage(browser, { url: BASE, ignore: (t) => /api\/config|404/.test(t) });
  await page.waitForSelector('#style-grid button');
  await page.click('#load-samples');
  await page.waitForFunction(() => document.querySelectorAll('#photo-list li').length >= 4, null, { timeout: 30000 });
  await page.click('#render-btn');
  await page.waitForSelector('#viewer .compare', { timeout: 120000 });
  assert.match(await page.textContent('#render-info'), /Free preview/);
  page.assertNoConsoleErrors('static render');
  await page.close();
});
