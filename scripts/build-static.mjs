/**
 * Builds a static copy of the app in dist/ for hosting without the Node
 * server (GitHub Pages, Netlify, any web host). The free preview, 3D house
 * and in-browser MP4 export all work there; AI engines need the server.
 *
 *   npm run build:static
 *   SITE_URL=https://you.github.io/your-repo/ npm run build:static   (for forks)
 */
import { cp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const DEFAULT_URL = 'https://roshanshaji786.github.io/house_baithul_hamd/';
const siteUrl = (process.env.SITE_URL ?? DEFAULT_URL).replace(/\/?$/, '/');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(root, 'public'), dist, { recursive: true });

// Browser libraries, at the same paths the local server uses.
const copies = [
  ['node_modules/three/build', 'vendor/three/build'],
  ['node_modules/three/examples/jsm', 'vendor/three/addons'],
  ['node_modules/mp4-muxer/build', 'vendor/mp4-muxer'],
];
for (const [from, to] of copies) await cp(join(root, from), join(dist, to), { recursive: true });

// Point canonical/Open Graph/sitemap URLs at the site being built.
if (siteUrl !== DEFAULT_URL) {
  for (const file of await readdir(dist)) {
    if (!['.html', '.xml', '.txt', '.webmanifest'].includes(extname(file))) continue;
    const path = join(dist, file);
    await writeFile(path, (await readFile(path, 'utf8')).replaceAll(DEFAULT_URL, siteUrl));
  }
}

// GitHub Pages: serve files as-is (no Jekyll processing).
await writeFile(join(dist, '.nojekyll'), '');
console.log(`Static site written to dist/ for ${siteUrl}`);
