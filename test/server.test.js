/**
 * Server-side tests: prompt building and the AI provider adapters.
 * Network calls are replaced by a stub `fetch`, so no API keys are needed.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = 'test-openai';
process.env.GEMINI_API_KEY = 'test-gemini';
process.env.ANTHROPIC_API_KEY = 'test-anthropic';

const { normaliseBrief, buildRenderPrompt, buildEditPrompt } = await import('../server/prompt.js');
const { renderWithOpenAI } = await import('../server/providers/openai.js');
const { renderWithGemini, nearestAspectRatio } = await import('../server/providers/gemini.js');
const { analyseReferences } = await import('../server/providers/claude.js');
const { parseDataUrl } = await import('../server/util.js');

const realFetch = globalThis.fetch;
let calls = [];
let reply = null;
before(() => {
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return reply(String(url), options);
  };
});
after(() => {
  globalThis.fetch = realFetch;
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const image = { mime: 'image/jpeg', buffer: Buffer.from('fake-jpeg'), base64: Buffer.from('fake-jpeg').toString('base64') };

test('brief is sanitised and prompt names every reference role', () => {
  const brief = normaliseBrief({
    roomType: 'living',
    styleName: 'Scandinavian',
    elements: { flooring: 'light oak planks', walls: 'warm white', bogus: 'x' },
    references: [{ label: 'Oak sample', role: 'flooring' }, { label: 'Mood', role: 'not-a-role' }],
  });
  assert.equal(brief.references[1].role, 'style');
  assert.equal(brief.elements.bogus, undefined);
  const prompt = buildRenderPrompt(brief);
  assert.match(prompt, /Keep the exact camera position/);
  assert.match(prompt, /Image 2 "Oak sample" \(role: Flooring\)/);
  assert.match(prompt, /Image 3 "Mood" \(role: Overall style\)/);
  assert.match(prompt, /Flooring: light oak planks/);
  assert.match(prompt, /logos|brand/i);
});

test('edit prompt changes only one element', () => {
  const brief = normaliseBrief({ roomType: 'kitchen', edit: { element: 'cabinets', description: 'sage green cabinets', note: 'matte' } });
  const prompt = buildEditPrompt(brief);
  assert.match(prompt, /Change ONLY the cabinets & vanity to: sage green cabinets/);
  assert.match(prompt, /Extra instruction from the homeowner: matte/);
});

test('data URLs are validated', () => {
  assert.throws(() => parseDataUrl('data:text/html;base64,PGI+'), /JPEG, PNG or WebP/);
  assert.throws(() => parseDataUrl('nope'), /not a valid image/);
  assert.equal(parseDataUrl(`data:image/png;base64,${image.base64}`).mime, 'image/png');
});

test('OpenAI adapter sends photo, references and mask as multipart', async () => {
  calls = [];
  reply = () => json({ data: [{ b64_json: 'QUJD' }] });
  const result = await renderWithOpenAI({ base: image, references: [image, image], mask: { ...image, mime: 'image/png' }, prompt: 'p', aspect: 1.5 });
  assert.equal(result.base64, 'QUJD');
  const { url, options } = calls[0];
  assert.equal(url, 'https://api.openai.com/v1/images/edits');
  assert.equal(options.headers.Authorization, 'Bearer test-openai');
  const form = options.body;
  assert.equal(form.getAll('image[]').length, 3);
  assert.ok(form.get('mask'));
  assert.equal(form.get('size'), '1536x1024');

  reply = () => json({ error: { message: 'Billing hard limit reached' } }, 400);
  await assert.rejects(renderWithOpenAI({ base: image, references: [], prompt: 'p', aspect: 1 }), /Billing hard limit/);
});

test('Gemini adapter labels each image and reads the image part', async () => {
  calls = [];
  reply = () => json({ candidates: [{ content: { parts: [{ text: 'ok' }, { inlineData: { mimeType: 'image/png', data: 'WFla' } }] } }] });
  const result = await renderWithGemini({ base: image, references: [{ ...image, label: 'Oak', roleLabel: 'Flooring' }], prompt: 'p', aspect: 4 / 3, baseLabel: 'the unfinished photo' });
  assert.equal(result.base64, 'WFla');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].options.headers['x-goog-api-key'], 'test-gemini');
  assert.equal(body.contents[0].parts.filter((p) => p.inlineData).length, 2);
  assert.match(body.contents[0].parts[2].text, /Image 2 \(reference "Oak", role: Flooring\)/);
  assert.equal(body.generationConfig.imageConfig.aspectRatio, '4:3');
  assert.equal(nearestAspectRatio(16 / 9), '16:9');

  reply = () => json({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] });
  await assert.rejects(renderWithGemini({ base: image, references: [], prompt: 'p', aspect: 1, baseLabel: 'x' }), /SAFETY/);
});

test('Claude reference check sends a JSON-schema request and parses conflicts', async () => {
  calls = [];
  reply = () => json({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ photo_issue: '', style_brief: 'Warm oak and white.', references: [{ index: 1, conflict: true, message: 'Open-plan space; only materials used.' }, { index: 2, conflict: false, message: '' }] }) }],
    usage: { input_tokens: 10, output_tokens: 10 },
  });
  const result = await analyseReferences({ photo: image, references: [{ ...image, label: 'Big room', role: 'style' }, { ...image, label: 'Oak', role: 'flooring' }], roomType: 'bedroom' });
  assert.equal(result.styleBrief, 'Warm oak and white.');
  assert.deepEqual(result.conflicts, [{ index: 1, message: 'Open-plan space; only materials used.' }]);
  const call = calls.find((c) => c.url.includes('/v1/messages'));
  const body = JSON.parse(call.options.body);
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.fallbacks, 'default');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.messages[0].content.filter((c) => c.type === 'image').length, 3);
  const headers = new Headers(call.options.headers);
  assert.match(headers.get('anthropic-beta'), /server-side-fallback-2026-07-01/);

  reply = () => json({ id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'refusal', content: [], usage: { input_tokens: 1, output_tokens: 0 } });
  await assert.rejects(analyseReferences({ photo: image, references: [], roomType: 'living' }), /could not analyse/);
});
