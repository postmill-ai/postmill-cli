import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../src/cli.js';
import { pollVideoJob, buildGeneratePayload } from '../src/commands/video.js';
import { createClient } from '../src/client.js';

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let calls: CapturedCall[];
let stdout: string;
let stderr: string;
let home: string;
let realHome: string | undefined;

type Handler = (call: CapturedCall) => Response;

function stubFetchQueue(handlers: Handler[]) {
  let i = 0;
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const call: CapturedCall = {
      url: String(url),
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body === undefined ? undefined : String(init.body),
    };
    calls.push(call);
    const handler = handlers[Math.min(i, handlers.length - 1)];
    i += 1;
    return handler(call);
  });
}

async function run(args: string[]): Promise<number> {
  process.exitCode = 0;
  await createProgram().parseAsync(['node', 'postmill', '--api-key', 'test-key', ...args]);
  return process.exitCode ?? 0;
}

beforeEach(() => {
  calls = [];
  stdout = '';
  stderr = '';
  realHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), 'postmill-cli-home-'));
  process.env.HOME = home; // keep ~/.config/postmill hermetic
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  process.exitCode = 0;
});

describe('posts commands', () => {
  it('posts list builds the correct query (dates + pagination limit)', async () => {
    stubFetchQueue([() => jsonResponse({ posts: [], cursor: null })]);

    const code = await run(['posts', 'list', '--from', '2026-01-01T00:00:00.000Z', '--to', '2026-01-31T23:59:59.000Z']);

    expect(code).toBe(0);
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/public/v1/posts');
    expect(url.searchParams.get('startDate')).toBe('2026-01-01T00:00:00.000Z');
    expect(url.searchParams.get('endDate')).toBe('2026-01-31T23:59:59.000Z');
    expect(url.searchParams.get('limit')).toBe('100');
    expect(calls[0].method).toBe('GET');
  });

  it('posts create sends creationMethod CLI, type schedule, and one entry per channel', async () => {
    stubFetchQueue([() => jsonResponse({ group: 'g1' }, 201)]);

    const code = await run([
      'posts', 'create',
      '--channel', 'ch1',
      '--channel', 'ch2',
      '--content', 'hello world',
      '--date', '2026-02-01T12:00:00.000Z',
      '--media', 'https://cdn/x.png',
    ]);

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(new URL(calls[0].url).pathname).toBe('/public/v1/posts');
    expect(calls[0].headers['Idempotency-Key']).toBeTruthy();
    const body = JSON.parse(calls[0].body!);
    expect(body.creationMethod).toBe('CLI');
    expect(body.type).toBe('schedule');
    expect(body.date).toBe('2026-02-01T12:00:00.000Z');
    expect(body.shortLink).toBe(false);
    expect(body.tags).toEqual([]);
    expect(body.posts).toHaveLength(2);
    expect(body.posts[0]).toEqual({
      integration: { id: 'ch1' },
      value: [{ content: 'hello world', image: [{ id: '', path: 'https://cdn/x.png' }] }],
      settings: {},
    });
    expect(body.posts[1].integration.id).toBe('ch2');
  });

  it('posts create --draft sends type draft', async () => {
    stubFetchQueue([() => jsonResponse({}, 201)]);
    await run(['posts', 'create', '--channel', 'ch1', '--content', 'x', '--date', '2026-02-01T00:00:00.000Z', '--draft']);
    expect(JSON.parse(calls[0].body!).type).toBe('draft');
  });

  it('posts create --slot resolves the date via GET /find-slot/:id first', async () => {
    stubFetchQueue([
      () => jsonResponse({ date: '2026-03-05T09:00:00.000Z' }),
      () => jsonResponse({ group: 'g9' }, 201),
    ]);

    const code = await run(['posts', 'create', '--channel', 'ch1', '--content', 'slot me', '--slot']);

    expect(code).toBe(0);
    expect(calls).toHaveLength(2);
    expect(new URL(calls[0].url).pathname).toBe('/public/v1/find-slot/ch1');
    expect(calls[0].method).toBe('GET');
    expect(new URL(calls[1].url).pathname).toBe('/public/v1/posts');
    expect(JSON.parse(calls[1].body!).date).toBe('2026-03-05T09:00:00.000Z');
  });

  it('posts create without --date/--slot fails with a friendly error and no request', async () => {
    stubFetchQueue([() => jsonResponse({})]);
    const code = await run(['posts', 'create', '--channel', 'ch1', '--content', 'x']);
    expect(code).toBe(1);
    expect(calls).toHaveLength(0);
    expect(stderr).toContain('--date');
  });

  it('posts delete / delete-group hit the right routes', async () => {
    stubFetchQueue([() => jsonResponse({}), () => jsonResponse({})]);
    await run(['posts', 'delete', 'p1']);
    await run(['posts', 'delete-group', 'g1']);
    expect(new URL(calls[0].url).pathname).toBe('/public/v1/posts/p1');
    expect(calls[0].method).toBe('DELETE');
    expect(new URL(calls[1].url).pathname).toBe('/public/v1/posts/group/g1');
  });

  it('posts status requires exactly one of --draft/--schedule and PUTs the status', async () => {
    stubFetchQueue([() => jsonResponse({})]);
    const bad = await run(['posts', 'status', 'p1']);
    expect(bad).toBe(1);
    expect(calls).toHaveLength(0);

    const good = await run(['posts', 'status', 'p1', '--draft']);
    expect(good).toBe(0);
    expect(new URL(calls[0].url).pathname).toBe('/public/v1/posts/p1/status');
    expect(calls[0].method).toBe('PUT');
    expect(JSON.parse(calls[0].body!)).toEqual({ status: 'draft' });
  });
});

describe('channels / media / notifications commands', () => {
  it('channels list GETs /integrations', async () => {
    stubFetchQueue([() => jsonResponse([{ id: 'i1', name: 'X acct', identifier: 'x', picture: null, disabled: false, profile: '@me' }])]);
    const code = await run(['channels', 'list']);
    expect(code).toBe(0);
    expect(new URL(calls[0].url).pathname).toBe('/public/v1/integrations');
  });

  it('channels connect passes ?version= to GET /social/:id', async () => {
    stubFetchQueue([() => jsonResponse({ url: 'https://oauth.example/authorize' })]);
    const code = await run(['channels', 'connect', 'x', '--provider-version', 'v1']);
    expect(code).toBe(0);
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/public/v1/social/x');
    expect(url.searchParams.get('version')).toBe('v1');
  });

  it('media upload-url POSTs { url } to /upload-from-url', async () => {
    stubFetchQueue([() => jsonResponse({ id: 'f1', name: 'upload.png', path: 'https://cdn/upload.png' }, 201)]);
    const code = await run(['media', 'upload-url', 'https://example.com/pic.png']);
    expect(code).toBe(0);
    expect(new URL(calls[0].url).pathname).toBe('/public/v1/upload-from-url');
    expect(JSON.parse(calls[0].body!)).toEqual({ url: 'https://example.com/pic.png' });
  });

  it('notifications list passes a zero-based page', async () => {
    stubFetchQueue([() => jsonResponse({ notifications: [] })]);
    const code = await run(['notifications', 'list', '--page', '2']);
    expect(code).toBe(0);
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/public/v1/notifications');
    expect(url.searchParams.get('page')).toBe('2');
  });
});

describe('analytics commands', () => {
  it('analytics overview sends from/to (+ defaults to the last 30 days)', async () => {
    stubFetchQueue([() => jsonResponse({ totals: {} })]);
    const code = await run(['analytics', 'overview', '--from', '2026-01-01', '--to', '2026-01-31', '--compare']);
    expect(code).toBe(0);
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/public/v1/analytics/overview');
    expect(url.searchParams.get('from')).toBe('2026-01-01');
    expect(url.searchParams.get('to')).toBe('2026-01-31');
    expect(url.searchParams.get('compare')).toBe('true');
  });

  it('analytics export passes format=csv and prints raw text', async () => {
    stubFetchQueue([
      () => new Response('date,likes\n2026-01-01,3\n', { status: 200, headers: { 'content-type': 'text/csv' } }),
    ]);
    const code = await run(['analytics', 'export', '--format', 'csv']);
    expect(code).toBe(0);
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/public/v1/analytics/export');
    expect(url.searchParams.get('format')).toBe('csv');
    expect(stdout).toContain('date,likes');
  });
});

describe('video commands', () => {
  it('buildGeneratePayload maps flags to the VideoDto shape', () => {
    expect(
      buildGeneratePayload({ type: 'image-to-video', output: 'horizontal', prompt: 'a cat', imageUrl: 'https://x/i.png' }),
    ).toEqual({
      type: 'image-to-video',
      output: 'horizontal',
      customParams: { prompt: 'a cat', imageUrl: 'https://x/i.png' },
    });
    expect(buildGeneratePayload({})).toEqual({ type: 'text-to-video', output: 'vertical' });
  });

  it('video generate POSTs the payload and prints the pending job id', async () => {
    stubFetchQueue([
      () => jsonResponse({ id: 'job1', status: 'pending', artifactUrl: null, provider: null, error: null }, 201),
    ]);
    const code = await run(['video', 'generate', '--prompt', 'ocean waves']);
    expect(code).toBe(0);
    expect(new URL(calls[0].url).pathname).toBe('/public/v1/generate-video');
    expect(JSON.parse(calls[0].body!)).toEqual({
      type: 'text-to-video',
      output: 'vertical',
      customParams: { prompt: 'ocean waves' },
    });
    expect(stdout).toContain('job1');
  });

  it('video voices POSTs functionName loadVoices with the provider identifier', async () => {
    stubFetchQueue([() => jsonResponse({ voices: [{ id: 'v1', name: 'Ada', preview_url: 'https://x/v.mp3' }] })]);
    const code = await run(['video', 'voices', '--provider', 'heygen']);
    expect(code).toBe(0);
    expect(new URL(calls[0].url).pathname).toBe('/public/v1/video/function');
    expect(JSON.parse(calls[0].body!)).toEqual({ identifier: 'heygen', functionName: 'loadVoices' });
  });

  it('pollVideoJob polls until completed and returns the job', async () => {
    let polls = 0;
    stubFetchQueue([
      () => {
        polls += 1;
        return polls < 3
          ? jsonResponse({ id: 'job1', status: 'pending', artifactUrl: null, provider: 'p', error: null })
          : jsonResponse({ id: 'job1', status: 'completed', artifactUrl: 'https://cdn/v.mp4', provider: 'p', error: null });
      },
    ]);
    const slept: number[] = [];
    const client = createClient({ apiKey: 'k', baseUrl: 'https://api.test' });

    const job = await pollVideoJob(client, 'job1', { sleep: async (ms) => void slept.push(ms) });

    expect(job.status).toBe('completed');
    expect(job.artifactUrl).toBe('https://cdn/v.mp4');
    expect(polls).toBe(3);
    expect(slept).toEqual([3000, 3000]);
  });

  it('pollVideoJob returns failed jobs (terminal) and times out on endless pending', async () => {
    stubFetchQueue([
      () => jsonResponse({ id: 'job1', status: 'failed', artifactUrl: null, provider: 'p', error: 'boom' }),
    ]);
    const client = createClient({ apiKey: 'k', baseUrl: 'https://api.test' });
    const failed = await pollVideoJob(client, 'job1', { sleep: async () => {} });
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('boom');

    // timeout: fake clock stuck at the deadline
    vi.unstubAllGlobals();
    stubFetchQueue([
      () => jsonResponse({ id: 'job1', status: 'pending', artifactUrl: null, provider: null, error: null }),
    ]);
    let t = 0;
    await expect(
      pollVideoJob(client, 'job1', {
        sleep: async () => {
          t += 5000;
        },
        now: () => t,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/Timed out/);
  });
});

describe('status / error handling', () => {
  it('status with no credentials prints the friendly not-logged-in error, exit 1, no stack', async () => {
    process.exitCode = 0;
    await createProgram().parseAsync(['node', 'postmill', 'status']);
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('not logged in');
    expect(stderr).not.toContain('at ');
    expect(stdout).toBe('');
  });

  it('401 from the API prints the friendly message, exit 1, no stack trace', async () => {
    stubFetchQueue([() => jsonResponse({ msg: 'Invalid API key' }, 401)]);
    const code = await run(['channels', 'list']);
    expect(code).toBe(1);
    expect(stderr).toContain('Invalid API key');
    expect(stderr).not.toMatch(/\n\s+at /);
  });
});
