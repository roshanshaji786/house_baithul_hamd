/**
 * Shell to Home - web server.
 *
 * Serves the single-page app from /public and exposes a small JSON API:
 *   GET  /api/config        which optional paid services are configured
 *   POST /api/render        AI render through OpenAI or Gemini (paid)
 *   POST /api/analyze       AI reference check through Claude (paid, optional)
 *   /api/video/...          ffmpeg MP4 encoding fallback (free, needs ffmpeg)
 *
 * API keys never leave the server. The free preview mode, the 3D house and
 * in-browser video encoding need no server calls at all.
 */
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config, publicCapabilities } from './config.js';
import { normaliseBrief, buildRenderPrompt, buildEditPrompt } from './prompt.js';
import { parseDataUrl, toDataUrl, UserFacingError } from './util.js';
import { renderWithOpenAI } from './providers/openai.js';
import { renderWithGemini } from './providers/gemini.js';
import { analyseReferences } from './providers/claude.js';
import { createJob, appendFrames, finishJob, cancelJob } from './video.js';
import { roleById, MAX_REFERENCES } from '../public/js/catalog.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = express();

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// ---------------------------------------------------------------------------
// Static files: the app itself plus the two browser libraries it imports.
// ---------------------------------------------------------------------------
app.use(express.static(join(root, 'public')));
app.use('/vendor/three/build', express.static(join(root, 'node_modules/three/build')));
app.use('/vendor/three/addons', express.static(join(root, 'node_modules/three/examples/jsm')));
app.use('/vendor/mp4-muxer', express.static(join(root, 'node_modules/mp4-muxer/build')));

// ---------------------------------------------------------------------------
// Very small in-memory rate limiter for the paid endpoints, so a page left
// open (or a public deployment) cannot run up a large bill by accident.
// ---------------------------------------------------------------------------
const hits = new Map();
function rateLimit(limit, windowMs) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${req.ip}:${req.path}`;
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      return res.status(429).json({ error: 'Too many AI requests in a short time. Please wait a few minutes.' });
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

const json = express.json({ limit: '60mb' });
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/config', (req, res) => res.json(publicCapabilities()));

/** Decodes the reference list sent by the browser. */
function parseReferences(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_REFERENCES).map((ref, i) => {
    const image = parseDataUrl(ref?.image, `reference image ${i + 1}`);
    const role = roleById(ref?.role) ? ref.role : 'style';
    return { ...image, label: String(ref?.label ?? `Reference ${i + 1}`).slice(0, 80), role, roleLabel: roleById(role).label };
  });
}

app.post(
  '/api/render',
  rateLimit(40, 10 * 60 * 1000),
  json,
  asyncRoute(async (req, res) => {
    const { provider, base, mask, aspect } = req.body ?? {};
    const providers = { openai: renderWithOpenAI, gemini: renderWithGemini };
    const render = providers[provider];
    if (!render) throw new UserFacingError('Unknown render engine.');
    if (!publicCapabilities().providers[provider].available) {
      throw new UserFacingError(`The ${provider === 'openai' ? 'OpenAI' : 'Gemini'} engine has no API key on this server. See the README.`, 501);
    }

    const brief = normaliseBrief(req.body.brief);
    const references = parseReferences(req.body.references);
    // Keep brief and image lists in step (the prompt numbers images by position).
    brief.references = references.map(({ label, role }) => ({ label, role }));
    const prompt = brief.edit ? buildEditPrompt(brief) : buildRenderPrompt(brief);

    const result = await render({
      base: parseDataUrl(base, 'photo'),
      baseLabel: brief.edit ? 'the current finished render' : 'the unfinished photo',
      references,
      mask: mask ? parseDataUrl(mask, 'mask') : null,
      aspect: Math.min(4, Math.max(0.25, Number(aspect) || 4 / 3)),
      prompt,
    });

    res.json({ image: toDataUrl(result.mime, result.base64), model: result.model, prompt });
  }),
);

app.post(
  '/api/analyze',
  rateLimit(40, 10 * 60 * 1000),
  json,
  asyncRoute(async (req, res) => {
    if (!config.anthropic.apiKey) throw new UserFacingError('The AI reference check is not configured on this server.', 501);
    const result = await analyseReferences({
      photo: parseDataUrl(req.body?.photo, 'photo'),
      references: parseReferences(req.body?.references),
      roomType: String(req.body?.roomType ?? 'living'),
    });
    res.json(result);
  }),
);

// --- Video (ffmpeg fallback) ----------------------------------------------
app.post('/api/video/jobs', express.json(), (req, res) => res.json(createJob(req.body ?? {})));
app.post(
  '/api/video/jobs/:id/frames',
  asyncRoute(async (req, res) => {
    await appendFrames(req.params.id, req);
    res.json({ ok: true });
  }),
);
app.post('/api/video/jobs/:id/finish', asyncRoute((req, res) => finishJob(req.params.id, res)));
app.delete('/api/video/jobs/:id', (req, res) => {
  cancelJob(req.params.id);
  res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Errors: friendly messages for expected problems, a generic one otherwise.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof UserFacingError) return res.status(error.status).json({ error: error.message });
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'The images are too large to send. Try fewer or smaller references.' });
  }
  console.error(error);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

app.listen(config.port, config.host, () => {
  const caps = publicCapabilities();
  const on = (flag) => (flag ? 'on' : 'off (no key)');
  const shown = ['127.0.0.1', '::1', 'localhost'].includes(config.host) ? 'localhost' : config.host;
  console.log(`\nShell to Home running at http://${shown}:${config.port}\n`);
  console.log(`  Free preview renderer : on`);
  console.log(`  OpenAI renders        : ${on(caps.providers.openai.available)}`);
  console.log(`  Gemini renders        : ${on(caps.providers.gemini.available)}`);
  console.log(`  Claude reference check: ${on(caps.analysis.claude)}`);
  console.log(`  Server MP4 encoding   : ${caps.video.serverEncoder ? 'on (ffmpeg)' : 'off (ffmpeg not found)'}\n`);
});
