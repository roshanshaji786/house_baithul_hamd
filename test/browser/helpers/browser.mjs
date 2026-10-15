/**
 * Test-environment helpers: provisions a headless Chromium with software
 * WebGL (SwiftShader) for the browser test suite.
 *
 * The Chromium binary and its SwiftShader libraries come from the
 * `@sparticuz/chromium` package (installed as a devDependency), so the tests
 * run anywhere with npm access and no GPU - including CI.
 *
 * On Linux, Chromium loads its GL stack (libEGL.so / libGLESv2.so) from the
 * directory the binary lives in, and the Vulkan loader needs an ICD manifest
 * pointing at SwiftShader. The layout produced here mirrors what the package
 * does on serverless platforms:
 *
 *   <cache>/chrome                       the browser binary
 *   <cache>/libEGL.so ... libvk_swiftshader.so   GL + software Vulkan driver
 *   <cache>/vk_swiftshader_icd.json      Vulkan ICD manifest (absolute path)
 *   <cache>/libs/lib/...                 NSS/NSPR etc. Chromium needs
 *
 * Usage:
 *   const { launchBrowser } = await import('./helpers/browser.mjs');
 *   const browser = await launchBrowser();
 */
import { execSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, chmod, stat, readFile, writeFile, readdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cacheDir = join(tmpdir(), 'shell-to-home-browser');

let prepared = null;

/** Extracts a brotli-compressed tar into `outDir`. */
async function extractTar(brPath, outDir) {
  const tarPath = `${outDir}.tar`;
  await pipeline(createReadStream(brPath), createBrotliDecompress(), createWriteStream(tarPath));
  execSync(`tar -xf "${tarPath}" -C "${outDir}"`, { stdio: 'ignore' });
}

/**
 * The bundled vk_swiftshader_icd.json points at "./libvk_swiftshader.so",
 * which the Vulkan loader resolves against the process CWD, not the json's
 * directory. Rewrite it with an absolute path so it works from any CWD.
 */
async function absolutiseIcd(dir) {
  const file = join(dir, 'vk_swiftshader_icd.json');
  const json = JSON.parse(await readFile(file, 'utf8'));
  json.ICD.library_path = join(dir, 'libvk_swiftshader.so');
  await writeFile(file, JSON.stringify(json));
}

/** Moves every file of `from` into `to` (flattens one level). */
async function moveAll(from, to) {
  for (const name of await readdir(from)) {
    await (await import('node:fs/promises')).rename(join(from, name), join(to, name));
  }
}

/** Downloads (once) and unpacks Chromium + SwiftShader. */
async function prepareBrowser() {
  if (prepared) return prepared;
  // Resolve the package directory without relying on its "exports" map.
  // require.resolve gives .../build/index.js; the binaries live in ../bin.
  const pkgDir = join(dirname(dirname(require.resolve('@sparticuz/chromium'))));
  const bin = join(pkgDir, 'bin');
  const chromePath = join(cacheDir, 'chrome');
  const ready = async () => {
    try {
      const chromeStat = await stat(chromePath);
      const eglStat = await stat(join(cacheDir, 'libEGL.so'));
      return chromeStat.size > 10_000_000 && chromeStat.mode & 0o111 && eglStat.size > 100_000;
    } catch {
      return false;
    }
  };
  if (!(await ready())) {
    await mkdir(cacheDir, { recursive: true });
    // The chromium binary is a brotli-compressed single file.
    await pipeline(
      createReadStream(join(bin, 'chromium.br')),
      createBrotliDecompress(),
      createWriteStream(chromePath),
    );
    await chmod(chromePath, 0o755);
    // Shared libraries Chromium needs (NSS/NSPR).
    await mkdir(join(cacheDir, 'libs'), { recursive: true });
    await extractTar(join(bin, 'al2023.tar.br'), join(cacheDir, 'libs'));
    // SwiftShader: Chromium's GL/EGL libs plus the software Vulkan driver,
    // placed next to the binary where Chromium loads them from.
    const ssDir = join(cacheDir, 'swiftshader-tmp');
    await mkdir(ssDir, { recursive: true });
    await extractTar(join(bin, 'swiftshader.tar.br'), ssDir);
    await moveAll(ssDir, cacheDir);
    await absolutiseIcd(cacheDir);
  }
  prepared = { chromePath, cacheDir };
  return prepared;
}

/** Launches headless Chromium with working software WebGL2. */
export async function launchBrowser({ headless = true } = {}) {
  const { chromium } = await import('playwright');
  const { chromePath, cacheDir } = await prepareBrowser();
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless,
    args: [
      '--no-sandbox',
      '--no-zygote',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--font-render-hinting=none',
    ],
    env: {
      ...process.env,
      LD_LIBRARY_PATH: [cacheDir, join(cacheDir, 'libs', 'lib')].join(':'),
      VK_ICD_FILENAMES: join(cacheDir, 'vk_swiftshader_icd.json'),
    },
  });
  return browser;
}

/** A page that records console errors so tests can assert a clean console. */
export async function newPage(browser, { url = 'http://127.0.0.1:3117/', ignore = () => false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !ignore(msg.text())) errors.push(msg.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('crash', () => errors.push('page crashed'));
  if (url) await page.goto(url, { waitUntil: 'domcontentloaded' });
  page.__errors = errors;
  page.assertNoConsoleErrors = function (label = '') {
    if (this.__errors.length) {
      throw new Error(`Console errors ${label}: ${this.__errors.slice(0, 5).join(' | ')}`);
    }
  };
  return page;
}

/** True when the page can create a WebGL2 context (software rendering). */
export async function hasWebGL(page) {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2'));
  });
}
