import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createClient, paginatePosts } from '../src/client.js';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const i = init ?? {};
    calls.push({ url: u, init: i });
    return handler(u, i);
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const opts = { apiKey: 'pm_live_test', baseUrl: 'https://api.postmill.ai' };

/** Await a rejection and return it typed as ApiError. */
async function catchApiError(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('expected the request to fail');
}

describe('client', () => {
  it('sends the API key raw in Authorization (no Bearer) and prefixes /public/v1', async () => {
    const calls = stubFetch(() => jsonResponse({ connected: true }));
    const client = createClient(opts);

    await client.get('/is-connected');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.postmill.ai/public/v1/is-connected');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('pm_live_test');
    expect(headers.Authorization).not.toContain('Bearer');
  });

  it('adds an Idempotency-Key UUID on POST/PUT/DELETE but not GET', async () => {
    const calls = stubFetch(() => jsonResponse({}));
    const client = createClient(opts);

    await client.post('/posts', { body: { a: 1 } });
    await client.put('/posts/1/status', { body: { status: 'draft' } });
    await client.delete('/posts/1');
    await client.get('/posts');

    const headerOf = (i: number) =>
      (calls[i].init.headers as Record<string, string>)['Idempotency-Key'];
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(headerOf(0)).toMatch(uuid);
    expect(headerOf(1)).toMatch(uuid);
    expect(headerOf(2)).toMatch(uuid);
    expect(headerOf(3)).toBeUndefined();
    // distinct per invocation
    expect(new Set([headerOf(0), headerOf(1), headerOf(2)]).size).toBe(3);
  });

  it('honors a caller-supplied Idempotency-Key', async () => {
    const calls = stubFetch(() => jsonResponse({}));
    const client = createClient(opts);

    await client.post('/posts', { body: {}, idempotencyKey: 'my-key' });

    expect((calls[0].init.headers as Record<string, string>)['Idempotency-Key']).toBe('my-key');
  });

  it('sends JSON bodies and query params; skips undefined query values', async () => {
    const calls = stubFetch(() => jsonResponse({ posts: [], cursor: null }));
    const client = createClient(opts);

    await client.get('/posts', {
      query: { startDate: 'a', endDate: 'b', limit: 100, cursor: undefined },
    });
    await client.post('/upload-from-url', { body: { url: 'https://x/img.png' } });

    const url = new URL(calls[0].url);
    expect(url.searchParams.get('startDate')).toBe('a');
    expect(url.searchParams.get('limit')).toBe('100');
    expect(url.searchParams.has('cursor')).toBe(false);

    const headers = calls[1].init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ url: 'https://x/img.png' });
  });

  it('maps 401 to a friendly invalid-key error', async () => {
    stubFetch(() => jsonResponse({ msg: 'Invalid API key' }, 401));
    const client = createClient(opts);

    const err = await catchApiError(client.get('/posts'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.status).toBe(401);
    expect(err.message).toContain('Invalid API key');
    expect(err.message).toContain('postmill login');
  });

  it('maps 402 to BILLING, 410 to PROVIDER_RETIRED (with latestActive)', async () => {
    stubFetch((url) =>
      url.includes('social')
        ? jsonResponse({ providerId: 'x', version: 'v1', latestActive: 'v2' }, 410)
        : jsonResponse({ msg: 'quota' }, 402),
    );
    const client = createClient(opts);

    const billing = await catchApiError(client.post('/posts', { body: {} }));
    expect(billing.code).toBe('BILLING');
    expect(billing.message).toContain('plan');

    const retired = await catchApiError(client.get('/social/x', { query: { version: 'v1' } }));
    expect(retired.code).toBe('PROVIDER_RETIRED');
    expect(retired.message).toContain('retired');
    expect(retired.message).toContain('v2');
  });

  it('surfaces the server validation message on 400', async () => {
    stubFetch(() => jsonResponse({ msg: 'date must be a valid ISO date' }, 400));
    const client = createClient(opts);

    const err = await catchApiError(client.get('/posts'));
    expect(err.code).toBe('VALIDATION');
    expect(err.message).toContain('date must be a valid ISO date');
  });

  it('retries 429 once after Retry-After, then throws THROTTLED', async () => {
    const sleepCalls: number[] = [];
    const sleep = async (ms: number) => {
      sleepCalls.push(ms);
    };

    // Case 1: retry succeeds.
    let n = 0;
    const calls = stubFetch(() =>
      ++n === 1 ? jsonResponse({}, 429, { 'retry-after': '2' }) : jsonResponse({ ok: true }),
    );
    const client = createClient(opts, { sleep });

    const res = await client.get('/posts');
    expect(res).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(sleepCalls).toEqual([2000]);

    // Case 2: still throttled after the single retry.
    vi.unstubAllGlobals();
    sleepCalls.length = 0;
    stubFetch(() => jsonResponse({}, 429, { 'retry-after': '1' }));
    const err = await catchApiError(createClient(opts, { sleep }).get('/posts'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('THROTTLED');
    expect(sleepCalls).toEqual([1000]);
  });

  it('does not retry other 4xx', async () => {
    const calls = stubFetch(() => jsonResponse({ msg: 'nope' }, 404));
    const client = createClient(opts, { sleep: async () => {} });

    await expect(client.get('/posts')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(calls).toHaveLength(1);
  });

  it('turns connection failures into a NETWORK ApiError', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    const client = createClient(opts);

    const err = await catchApiError(client.get('/posts'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('NETWORK');
    expect(err.message).toContain('api.postmill.ai');
  });
});

describe('paginatePosts', () => {
  it('follows the cursor across pages until maxTotal', async () => {
    const makePosts = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: `p${from + i}` }));
    const calls = stubFetch((url) => {
      const u = new URL(url);
      const cursor = Number(u.searchParams.get('cursor') ?? 0);
      const limit = Number(u.searchParams.get('limit'));
      const posts = makePosts(cursor, Math.min(limit, 250 - cursor));
      const next = cursor + limit;
      return jsonResponse({ posts, cursor: next < 250 ? next : null });
    });
    const client = createClient(opts);

    const { posts, cursor } = await paginatePosts(
      client,
      { startDate: 'a', endDate: 'b' },
      250,
    );

    expect(posts).toHaveLength(250);
    expect(calls).toHaveLength(3); // 100 + 100 + 50
    expect(calls[0].url).toContain('limit=100');
    expect(calls[1].url).toContain('cursor=100');
    expect(calls[2].url).toContain('limit=50');
    expect(cursor).toBeNull();
  });

  it('stops when the server returns no next cursor', async () => {
    const calls = stubFetch(() => jsonResponse({ posts: [{ id: 'p1' }], cursor: null }));
    const client = createClient(opts);

    const { posts } = await paginatePosts(client, { startDate: 'a', endDate: 'b' }, 100);

    expect(posts).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});
