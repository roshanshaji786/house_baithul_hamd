/** Small helpers shared by the API routes and providers. */

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** An error whose message is safe to show to the user, with an HTTP status. */
export class UserFacingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Decodes a `data:image/...;base64,...` URL into a Buffer.
 * Throws a UserFacingError for anything that is not a supported image.
 */
export function parseDataUrl(dataUrl, what = 'image') {
  if (typeof dataUrl !== 'string') throw new UserFacingError(`Missing ${what}.`);
  const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new UserFacingError(`The ${what} is not a valid image.`);
  const [, mime, base64] = match;
  if (!ALLOWED_IMAGE_TYPES.has(mime)) {
    throw new UserFacingError(`The ${what} must be a JPEG, PNG or WebP image.`);
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new UserFacingError(`The ${what} is too large (over 12 MB after resizing).`);
  }
  return { mime, buffer, base64 };
}

export const toDataUrl = (mime, base64) => `data:${mime};base64,${base64}`;

/** Fetch with a timeout that produces a readable error message. */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 180_000) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error.name === 'TimeoutError') {
      throw new UserFacingError('The AI service took too long to respond. Please try again.', 504);
    }
    throw new UserFacingError(`Could not reach the AI service (${error.message}).`, 502);
  }
}
