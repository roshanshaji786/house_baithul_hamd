/**
 * Optional AI reference check using Claude's vision (paid).
 *
 * Claude looks at the unfinished photo and every reference image and reports:
 *  - whether a reference conflicts with the room's layout or scale
 *    (the app then keeps the photo's layout and shows a warning), and
 *  - a short written style brief that is added to the render prompt.
 * The response is constrained to a JSON schema so it can be parsed safely.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { UserFacingError } from '../util.js';
import { roomLabel, roleById } from '../../public/js/catalog.js';

let client = null;
const getClient = () => (client ??= new Anthropic({ apiKey: config.anthropic.apiKey }));

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    photo_issue: {
      type: 'string',
      description: 'Empty string if the photo is usable; otherwise a short reason (too dark, blurry, not a room...).',
    },
    style_brief: {
      type: 'string',
      description: 'Two or three sentences describing the target finishes, colours and mood, for an image model.',
    },
    references: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: 'Reference number, starting at 1.' },
          conflict: { type: 'boolean' },
          message: {
            type: 'string',
            description: 'If conflict is true: one short sentence for a homeowner explaining the mismatch. Otherwise empty.',
          },
        },
        required: ['index', 'conflict', 'message'],
        additionalProperties: false,
      },
    },
  },
  required: ['photo_issue', 'style_brief', 'references'],
  additionalProperties: false,
};

const INSTRUCTIONS = (room, refs) => `You help homeowners preview how an unfinished space will look when finished.
Image 1 is a photo of an unfinished ${room}. The other images are style references:
${refs.map((r, i) => `- Reference ${i + 1} (image ${i + 2}) "${r.label}", role "${roleById(r.role).label}": ${roleById(r.role).hint}`).join('\n')}

For each reference, decide whether it conflicts with the photo's layout or scale. Examples of conflicts:
a kitchen reference for a bedroom, a double-height or much larger room used as overall style for a small room,
an open-plan layout when the photo is a closed room, an exterior used for an interior, a flooring "sample" that
is really a whole room, or furniture that would not fit the space. Small style differences are not conflicts.
The app always keeps the photo's layout, so phrase each message as what will be ignored, e.g.
"This reference shows an open-plan space; only its materials and colours will be used."

Then write the style brief combining the references by role. Never mention brand names or logos.`;

/**
 * @param {{photo: {mime, base64}, references: {mime, base64, label, role}[], roomType: string}} input
 * @returns {Promise<{photoIssue: string, styleBrief: string, conflicts: {index: number, message: string}[]}>}
 */
export async function analyseReferences({ photo, references, roomType }) {
  const image = ({ mime, base64 }) => ({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } });
  const content = [{ type: 'text', text: 'Image 1: the unfinished space.' }, image(photo)];
  references.forEach((ref, i) => {
    content.push({ type: 'text', text: `Image ${i + 2}: reference ${i + 1} "${ref.label}".` }, image(ref));
  });
  content.push({ type: 'text', text: INSTRUCTIONS(roomLabel(roomType).toLowerCase(), references) });

  let response;
  try {
    response = await getClient().beta.messages.create({
      model: config.anthropic.model,
      max_tokens: 16000,
      // If a safety classifier declines, retry on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: RESULT_SCHEMA },
      },
      messages: [{ role: 'user', content }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new UserFacingError('The reference check is not configured correctly (invalid Anthropic API key).', 502);
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new UserFacingError('The reference check is busy. Please try again in a minute.', 429);
    }
    if (error instanceof Anthropic.APIError) {
      throw new UserFacingError(`The reference check failed (${error.status ?? 'network'}).`, 502);
    }
    throw error;
  }

  if (response.stop_reason === 'refusal') {
    throw new UserFacingError('The reference check could not analyse these images.', 422);
  }
  const text = response.content.find((block) => block.type === 'text')?.text;
  let parsed;
  try {
    parsed = JSON.parse(text ?? '');
  } catch {
    throw new UserFacingError('The reference check returned an unreadable answer. Please try again.', 502);
  }

  return {
    photoIssue: String(parsed.photo_issue ?? '').trim(),
    styleBrief: String(parsed.style_brief ?? '').trim(),
    conflicts: (Array.isArray(parsed.references) ? parsed.references : [])
      .filter((r) => r && r.conflict && r.message)
      .map((r) => ({ index: Number(r.index), message: String(r.message) })),
  };
}
