/**
 * MP4 export for the walkthrough.
 *
 * 1. Preferred: encode in the browser with WebCodecs (H.264) and package
 *    the frames into an .mp4 with mp4-muxer. Free, private and fast.
 * 2. Fallback: when the browser cannot encode H.264 (e.g. some Firefox or
 *    Linux builds), frames are sent as JPEGs to the local server, which
 *    encodes them with ffmpeg.
 * Progress is reported per frame; `signal` cancels the export.
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

const CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42001f'];

/** Returns a supported encoder config for the size, or null. */
export async function findEncoderConfig(width, height, fps) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of CODECS) {
    const config = { codec, width, height, bitrate: width >= 1920 ? 10_000_000 : 6_000_000, framerate: fps, avc: { format: 'avc' } };
    try {
      const { supported } = await VideoEncoder.isConfigSupported(config);
      if (supported) return config;
    } catch {
      // try the next profile
    }
  }
  return null;
}

class Cancelled extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'AbortError';
  }
}

/**
 * @param {object} opts
 * @param {number} opts.width, opts.height, opts.fps, opts.duration (seconds)
 * @param {(t: number) => HTMLCanvasElement} opts.drawFrame  draws the frame at time t
 * @param {(progress: number, label: string) => void} opts.onProgress  progress 0..1
 * @param {boolean} opts.serverAvailable  whether the ffmpeg fallback exists
 * @param {AbortSignal} opts.signal
 * @returns {Promise<Blob>} video/mp4
 */
export async function exportMp4({ width, height, fps = 30, duration, drawFrame, onProgress, serverAvailable, signal }) {
  const frames = Math.ceil(duration * fps);
  const config = await findEncoderConfig(width, height, fps);
  if (config) return encodeInBrowser({ config, width, height, fps, frames, drawFrame, onProgress, signal });
  if (serverAvailable) return encodeOnServer({ fps, frames, drawFrame, onProgress, signal });
  throw new Error('This browser cannot create MP4 video. Please try the latest Chrome, Edge or Safari. (Self-hosted copies can also encode on the server if ffmpeg is installed.)');
}

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

async function encodeInBrowser({ config, width, height, fps, frames, drawFrame, onProgress, signal }) {
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: fps },
    fastStart: 'in-memory',
  });
  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e),
  });
  encoder.configure(config);
  const frameUs = 1_000_000 / fps;
  try {
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw new Cancelled();
      if (failure) throw failure;
      const canvas = drawFrame(i / fps);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      // Keep memory bounded and the page responsive.
      while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
      if (i % 3 === 0) {
        onProgress((i + 1) / frames, `Rendering frame ${i + 1} of ${frames}`);
        await yieldToUi();
      }
    }
    onProgress(1, 'Finishing the MP4 file…');
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
}

async function encodeOnServer({ fps, frames, drawFrame, onProgress, signal }) {
  const start = await fetch('api/video/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fps }) });
  const job = await start.json().catch(() => ({}));
  if (!start.ok) throw new Error(job.error ?? 'The server could not start the video.');
  const cancel = () => fetch(`api/video/jobs/${job.id}`, { method: 'DELETE' }).catch(() => {});
  try {
    let batch = [];
    const send = async () => {
      if (!batch.length) return;
      const res = await fetch(`api/video/jobs/${job.id}/frames`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Blob(batch) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Uploading frames failed.');
      batch = [];
    };
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw new Cancelled();
      const canvas = drawFrame(i / fps);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) throw new Error('Could not encode a video frame on this device.');
      batch.push(blob);
      if (batch.length >= 24) await send();
      onProgress(((i + 1) / frames) * 0.9, `Rendering frame ${i + 1} of ${frames} (server encoding)`);
    }
    await send();
    onProgress(0.95, 'The server is encoding the MP4…');
    const res = await fetch(`api/video/jobs/${job.id}/finish`, { method: 'POST' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Video encoding failed.');
    const blob = await res.blob();
    onProgress(1, 'Done');
    return new Blob([blob], { type: 'video/mp4' });
  } catch (error) {
    cancel();
    throw error;
  }
}
