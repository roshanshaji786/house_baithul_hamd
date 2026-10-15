/**
 * Google Gemini image editing provider (paid).
 *
 * Gemini's image model accepts several images in one request, which suits
 * role-tagged references well. Each image is introduced with a short text
 * label so the prompt can refer to "Image 1", "Image 2" and so on.
 */
import { config } from '../config.js';
import { UserFacingError, fetchWithTimeout } from '../util.js';

const ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

/** Nearest aspect ratio Gemini supports for the given width / height. */
export function nearestAspectRatio(aspect) {
  let best = '4:3';
  let bestDiff = Infinity;
  for (const ratio of ASPECT_RATIOS) {
    const [w, h] = ratio.split(':').map(Number);
    const diff = Math.abs(Math.log(w / h) - Math.log(aspect));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = ratio;
    }
  }
  return best;
}

const imagePart = ({ mime, base64 }) => ({ inlineData: { mimeType: mime, data: base64 } });

/**
 * @param {object} args  see renderWithOpenAI; `mask` is ignored because Gemini
 *                       edits are steered by the prompt alone.
 */
export async function renderWithGemini({ base, references, prompt, aspect, baseLabel }) {
  const parts = [{ text: `Image 1 (${baseLabel}):` }, imagePart(base)];
  references.forEach((ref, i) => {
    parts.push({ text: `Image ${i + 2} (reference "${ref.label}", role: ${ref.roleLabel}):` }, imagePart(ref));
  });
  parts.push({ text: prompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.gemini.model)}:generateContent`;
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.gemini.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: nearestAspectRatio(aspect) },
      },
    }),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json?.error?.message ?? `HTTP ${response.status}`;
    throw new UserFacingError(`Gemini could not render this image: ${message}`, response.status === 429 ? 429 : 502);
  }

  const candidate = json?.candidates?.[0];
  const image = candidate?.content?.parts?.find((p) => p.inlineData?.data);
  if (!image) {
    const reason = json?.promptFeedback?.blockReason || candidate?.finishReason || 'no image in the response';
    throw new UserFacingError(`Gemini returned no image (${reason}). Try a different photo or reference.`, 502);
  }
  return { mime: image.inlineData.mimeType || 'image/png', base64: image.inlineData.data, model: config.gemini.model };
}
