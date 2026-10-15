/**
 * Server configuration.
 *
 * Reads settings from environment variables (optionally loaded from a `.env`
 * file) and works out which optional paid services are available. Nothing
 * here is required: with no keys at all the app still runs in the free,
 * in-browser preview mode.
 */
import { spawnSync } from 'node:child_process';

// Load `.env` if present. `process.loadEnvFile` ships with Node 20.12+.
try {
  process.loadEnvFile?.('.env');
} catch {
  // No .env file: rely on the real environment.
}

const env = (name, fallback = '') => (process.env[name] ?? fallback).trim();

/** Returns true when an ffmpeg binary can be executed. */
function detectFfmpeg(binary) {
  try {
    const result = spawnSync(binary, ['-version'], { stdio: 'ignore', timeout: 5000 });
    return result.status === 0;
  } catch {
    return false;
  }
}

const ffmpegPath = env('FFMPEG_PATH', 'ffmpeg') || 'ffmpeg';

export const config = {
  port: Number(env('PORT', '3000')) || 3000,
  // Localhost only by default, so other devices cannot use your API keys.
  // Set HOST=0.0.0.0 to open the app from a phone on the same Wi-Fi.
  host: env('HOST', '127.0.0.1') || '127.0.0.1',

  openai: {
    apiKey: env('OPENAI_API_KEY'),
    model: env('OPENAI_IMAGE_MODEL', 'gpt-image-1') || 'gpt-image-1',
    inputFidelity: env('OPENAI_INPUT_FIDELITY', 'high'),
    quality: env('OPENAI_IMAGE_QUALITY', 'medium') || 'medium',
  },

  gemini: {
    apiKey: env('GEMINI_API_KEY'),
    model: env('GEMINI_IMAGE_MODEL', 'gemini-2.5-flash-image') || 'gemini-2.5-flash-image',
  },

  anthropic: {
    apiKey: env('ANTHROPIC_API_KEY'),
    model: env('ANTHROPIC_MODEL', 'claude-opus-5-5') || 'claude-opus-5-5',
  },

  ffmpeg: {
    path: ffmpegPath,
    available: detectFfmpeg(ffmpegPath),
  },
};

/** Public, key-free summary of what this server can do (sent to the browser). */
export function publicCapabilities() {
  return {
    providers: {
      local: { available: true, label: 'Free preview (in your browser)' },
      openai: { available: Boolean(config.openai.apiKey), label: `OpenAI (${config.openai.model})` },
      gemini: { available: Boolean(config.gemini.apiKey), label: `Google Gemini (${config.gemini.model})` },
    },
    analysis: { claude: Boolean(config.anthropic.apiKey) },
    video: { serverEncoder: config.ffmpeg.available },
  };
}
