import type { Command } from 'commander';
import type { Client } from '../client.js';
import { CliError, printResult } from '../output.js';
import { globalOpts, requireClient, withErrors } from '../context.js';
import type { GenerateVideoPayload, VideoJob, Voice } from '../types.js';

export const POLL_INTERVAL_MS = 3000;
export const POLL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Poll GET /generate-video/:id every 3 s until the job is terminal
 * ('completed' | 'failed') or the 5-minute timeout elapses.
 */
export async function pollVideoJob(
  client: Client,
  id: string,
  deps: {
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    intervalMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<VideoJob> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const intervalMs = deps.intervalMs ?? POLL_INTERVAL_MS;
  const deadline = now() + (deps.timeoutMs ?? POLL_TIMEOUT_MS);

  for (;;) {
    const job = await client.get<VideoJob>(`/generate-video/${id}`);
    if (job.status !== 'pending') return job;
    if (now() >= deadline) {
      throw new CliError(
        `Timed out waiting for video job ${id} after ${Math.round((deps.timeoutMs ?? POLL_TIMEOUT_MS) / 1000)}s. ` +
          `Check later with \`postmill video status ${id}\`.`,
      );
    }
    await sleep(intervalMs);
  }
}

interface GenerateOpts {
  type?: string;
  output?: string;
  prompt?: string;
  imageUrl?: string;
  videoUrl?: string;
  wait?: boolean;
}

export function buildGeneratePayload(opts: GenerateOpts): GenerateVideoPayload {
  const customParams: Record<string, unknown> = {};
  if (opts.prompt) customParams.prompt = opts.prompt;
  if (opts.imageUrl) customParams.imageUrl = opts.imageUrl;
  if (opts.videoUrl) customParams.videoUrl = opts.videoUrl;

  return {
    type: opts.type ?? 'text-to-video',
    output: (opts.output as 'vertical' | 'horizontal') ?? 'vertical',
    ...(Object.keys(customParams).length ? { customParams } : {}),
  };
}

async function generateAction(opts: GenerateOpts, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);

  if (opts.output && !['vertical', 'horizontal'].includes(opts.output)) {
    throw new CliError('--output must be "vertical" or "horizontal".');
  }

  const payload = buildGeneratePayload(opts);
  const job = await client.post<VideoJob>('/generate-video', { body: payload });

  // Synchronous completion: no job id, artifact already available.
  if (job.status === 'completed') {
    printResult(job, { json, text: `Video ready: ${job.artifactUrl}` });
    return;
  }

  if (!opts.wait) {
    printResult(job, {
      json,
      text: `Video job ${job.id} is pending. Poll with \`postmill video status ${job.id}\` or re-run with --wait.`,
    });
    return;
  }

  if (!job.id) {
    throw new CliError('The server returned a pending job without an id — cannot poll it.');
  }

  process.stderr.write(`Waiting for video job ${job.id}…\n`);
  const done = await pollVideoJob(client, job.id);
  if (done.status === 'failed') {
    throw new CliError(`Video generation failed${done.error ? `: ${done.error}` : '.'}`);
  }
  printResult(done, { json, text: `Video ready: ${done.artifactUrl}` });
}

async function statusAction(id: string, _opts: unknown, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);
  const job = await client.get<VideoJob>(`/generate-video/${id}`);
  printResult(job, {
    json,
    table: {
      columns: [
        { key: 'id', label: 'ID', maxWidth: 28 },
        { key: 'status', label: 'STATUS', maxWidth: 12 },
        { key: 'provider', label: 'PROVIDER', maxWidth: 16 },
        { key: 'artifactUrl', label: 'ARTIFACT URL', maxWidth: 60 },
        { key: 'error', label: 'ERROR', maxWidth: 40 },
      ],
      rows: [job as unknown as Record<string, unknown>],
    },
  });
}

interface VoicesOpts {
  provider: string;
}

async function voicesAction(opts: VoicesOpts, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);
  const res = await client.post<{ voices: Voice[] }>('/video/function', {
    body: { identifier: opts.provider, functionName: 'loadVoices' },
  });
  printResult(res.voices, {
    json,
    table: {
      columns: [
        { key: 'id', label: 'ID', maxWidth: 28 },
        { key: 'name', label: 'NAME', maxWidth: 32 },
        { key: 'preview_url', label: 'PREVIEW URL', maxWidth: 60 },
      ],
      rows: res.voices as unknown as Record<string, unknown>[],
    },
  });
}

export function registerVideoCommands(program: Command): void {
  const video = program.command('video').description('AI video generation jobs');

  video
    .command('generate')
    .description('Start an AI video generation job (text-, image-, or video-to-video)')
    .option('--type <type>', 'Generator identifier (default: text-to-video)')
    .option('--output <orientation>', '"vertical" (default) or "horizontal"')
    .option('--prompt <text>', 'Text prompt for the generator')
    .option('--image-url <url>', 'Source image (image-to-video)')
    .option('--video-url <url>', 'Source video (video-to-video)')
    .option('--wait', 'Poll every 3s (up to 5min) until the job completes; exits non-zero on failure')
    .action(withErrors(generateAction));

  video
    .command('status <id>')
    .description('Check a video generation job')
    .action(withErrors(statusAction));

  video
    .command('voices')
    .description('List narrator voices for a video provider')
    .requiredOption('--provider <id>', 'Video provider identifier')
    .action(withErrors(voicesAction));
}
