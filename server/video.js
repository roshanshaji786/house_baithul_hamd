/**
 * Server-side MP4 encoding with ffmpeg (fallback path).
 *
 * Most browsers encode the walkthrough video themselves (WebCodecs). When a
 * browser cannot, it renders JPEG frames and streams them here in chunks;
 * ffmpeg turns them into an H.264 MP4 that is sent back for download.
 *
 * Flow:  POST /api/video/jobs            -> { id }
 *        POST /api/video/jobs/:id/frames (body: concatenated JPEG frames)
 *        POST /api/video/jobs/:id/finish -> video/mp4
 *        DELETE /api/video/jobs/:id      (cancel)
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from './config.js';
import { UserFacingError } from './util.js';

const MAX_CONCURRENT_JOBS = 2;
const MAX_JOB_BYTES = 1.5 * 1024 ** 3; // frames per job (about 4 minutes of 1080p JPEGs)
const JOB_TTL_MS = 15 * 60 * 1000;
const jobs = new Map();

/** Prefer H.264 (plays everywhere); fall back to MPEG-4 part 2. */
const videoEncoder = (() => {
  if (!config.ffmpeg.available) return null;
  const out = spawnSync(config.ffmpeg.path, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout ?? '';
  if (out.includes('libx264')) return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'];
  if (out.includes('libopenh264')) return ['-c:v', 'libopenh264', '-b:v', '6M'];
  return ['-c:v', 'mpeg4', '-q:v', '3'];
})();

function destroyJob(id) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  clearTimeout(job.timer);
  if (job.ffmpeg.exitCode === null) job.ffmpeg.kill('SIGKILL');
  rm(job.output, { force: true }).catch(() => {});
}

export function createJob({ fps }) {
  if (!videoEncoder) throw new UserFacingError('Video encoding is not available on this server (ffmpeg not found).', 501);
  if (jobs.size >= MAX_CONCURRENT_JOBS) throw new UserFacingError('The server is busy making another video. Try again shortly.', 429);

  const frameRate = Math.min(60, Math.max(1, Number(fps) || 30));
  const id = randomUUID();
  const output = join(tmpdir(), `walkthrough-${id}.mp4`);
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(frameRate), '-c:v', 'mjpeg', '-i', '-',
    ...videoEncoder,
    '-pix_fmt', 'yuv420p',
    // yuv420p needs even dimensions.
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-movflags', '+faststart',
    output,
  ];
  const ffmpeg = spawn(config.ffmpeg.path, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  const job = { id, ffmpeg, output, bytes: 0, stderr: '', timer: setTimeout(() => destroyJob(id), JOB_TTL_MS) };
  ffmpeg.stderr.on('data', (d) => (job.stderr = (job.stderr + d).slice(-2000)));
  ffmpeg.stdin.on('error', () => {}); // reported via the exit code instead
  job.exited = new Promise((resolve) => ffmpeg.on('close', resolve));
  jobs.set(id, job);
  return { id };
}

function getJob(id) {
  const job = jobs.get(id);
  if (!job) throw new UserFacingError('This video job has expired. Please start the export again.', 404);
  return job;
}

/** Streams a request body of concatenated JPEG frames into ffmpeg. */
export function appendFrames(id, req) {
  const job = getJob(id);
  return new Promise((resolve, reject) => {
    req.on('data', (chunk) => {
      job.bytes += chunk.length;
      if (job.bytes > MAX_JOB_BYTES) {
        destroyJob(id);
        req.destroy();
        reject(new UserFacingError('The video is too long to encode. Choose 720p or a quicker pace.', 413));
        return;
      }
      if (!job.ffmpeg.stdin.write(chunk)) {
        req.pause();
        job.ffmpeg.stdin.once('drain', () => req.resume());
      }
    });
    req.on('end', resolve);
    req.on('error', reject);
  });
}

/** Closes the frame stream, waits for ffmpeg and pipes the MP4 to `res`. */
export async function finishJob(id, res) {
  const job = getJob(id);
  job.ffmpeg.stdin.end();
  const code = await job.exited;
  if (code !== 0) {
    const detail = job.stderr.trim().split('\n').pop() || `exit code ${code}`;
    destroyJob(id);
    throw new UserFacingError(`Video encoding failed: ${detail}`, 500);
  }
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', 'attachment; filename="walkthrough.mp4"');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(job.output);
    stream.on('error', reject);
    res.on('finish', resolve);
    res.on('close', resolve);
    stream.pipe(res);
  });
  destroyJob(id);
}

export const cancelJob = (id) => destroyJob(id);
