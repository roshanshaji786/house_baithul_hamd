/**
 * OpenAI image editing provider (paid).
 *
 * Sends the unfinished photo as the first image and the reference images
 * after it to the Images "edits" endpoint. For single-element edits an
 * optional mask limits the change to one area (floor, walls, ceiling...).
 */
import { config } from '../config.js';
import { UserFacingError, fetchWithTimeout } from '../util.js';

const ENDPOINT = 'https://api.openai.com/v1/images/edits';

/** OpenAI supports three output sizes; pick the one closest to the photo. */
function pickSize(aspect) {
  if (aspect > 1.2) return '1536x1024';
  if (aspect < 0.83) return '1024x1536';
  return '1024x1024';
}

const asBlob = ({ buffer, mime }) => new Blob([buffer], { type: mime });
const extension = (mime) => mime.split('/')[1].replace('jpeg', 'jpg');

/**
 * @param {object} args
 * @param {{buffer: Buffer, mime: string}} args.base   first image (photo or current render)
 * @param {{buffer: Buffer, mime: string}[]} args.references
 * @param {{buffer: Buffer, mime: string}|null} args.mask  PNG, transparent = area to change
 * @param {string} args.prompt
 * @param {number} args.aspect  width / height of the base image
 */
export async function renderWithOpenAI({ base, references, mask, prompt, aspect }) {
  const form = new FormData();
  form.append('model', config.openai.model);
  form.append('prompt', prompt);
  form.append('image[]', asBlob(base), `photo.${extension(base.mime)}`);
  references.forEach((ref, i) => form.append('image[]', asBlob(ref), `reference-${i + 1}.${extension(ref.mime)}`));
  if (mask) form.append('mask', asBlob(mask), 'mask.png');
  form.append('size', pickSize(aspect));
  form.append('quality', config.openai.quality);
  form.append('output_format', 'jpeg');
  form.append('n', '1');
  if (config.openai.inputFidelity) form.append('input_fidelity', config.openai.inputFidelity);

  const response = await fetchWithTimeout(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openai.apiKey}` },
    body: form,
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json?.error?.message ?? `HTTP ${response.status}`;
    const status = response.status === 401 ? 502 : response.status === 429 ? 429 : 502;
    throw new UserFacingError(`OpenAI could not render this image: ${message}`, status);
  }

  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new UserFacingError('OpenAI returned no image. Please try again.', 502);
  return { mime: 'image/jpeg', base64: b64, model: config.openai.model };
}
