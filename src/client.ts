import { randomUUID } from 'node:crypto';
import type { PostRecord, PostsPage } from './types.js';

export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'BILLING'
  | 'PROVIDER_RETIRED'
  | 'THROTTLED'
  | 'CONFLICT'
  | 'SERVER'
  | 'NETWORK'
  | 'UNKNOWN';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  /** Raw parsed response body, when it was JSON. */
  readonly body: unknown;

  constructor(status: number, code: ErrorCode, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export interface ClientOptions {
  apiKey: string;
  baseUrl: string;
}

export interface ClientDeps {
  /** Injectable for tests — defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  form?: FormData;
  /** Override the auto-generated Idempotency-Key on mutating requests. */
  idempotencyKey?: string;
}

export interface Client {
  request<T = unknown>(method: string, path: string, options?: RequestOptions): Promise<T>;
  get<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  post<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  put<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  delete<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
}

const API_PREFIX = '/public/v1';
const MUTATING = new Set(['POST', 'PUT', 'DELETE']);
const MAX_429_RETRIES = 1;
const DEFAULT_RETRY_BACKOFF_MS = 1000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const base = baseUrl.replace(/\/+$/, '');
  const url = new URL(`${base}${API_PREFIX}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** Pull the most useful human message out of an error response body. */
function serverMessage(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  for (const key of ['msg', 'message', 'error']) {
    const v = b[key];
    if (typeof v === 'string' && v) return v;
    if (Array.isArray(v) && v.length) return v.map(String).join('; ');
  }
  return undefined;
}

function friendlyError(status: number, body: unknown, retryAfter?: string | null): { code: ErrorCode; message: string } {
  const server = serverMessage(body);
  switch (status) {
    case 400:
      return {
        code: 'VALIDATION',
        message: `Invalid request${server ? `: ${server}` : '. The server rejected the payload.'}`,
      };
    case 401:
      return {
        code: 'UNAUTHORIZED',
        message:
          `Invalid API key${server ? ` (${server})` : ''}. ` +
          'Create a key in the dashboard (Settings → API Keys) or run `postmill login`.',
      };
    case 402:
      return {
        code: 'BILLING',
        message:
          `This action is not available on the current plan${server ? `: ${server}` : ''}. ` +
          'Upgrade in the dashboard under Settings → Billing.',
      };
    case 403:
      return { code: 'FORBIDDEN', message: `Forbidden${server ? `: ${server}` : ''}` };
    case 404:
      return { code: 'NOT_FOUND', message: `Not found${server ? `: ${server}` : ''}` };
    case 409:
      return { code: 'CONFLICT', message: `Conflict${server ? `: ${server}` : ''}` };
    case 410: {
      const b = (body ?? {}) as Record<string, unknown>;
      const latest = typeof b.latestActive === 'string' ? ` Use version "${b.latestActive}" instead.` : '';
      return {
        code: 'PROVIDER_RETIRED',
        message: `The requested provider version has been retired.${latest}${server ? ` (${server})` : ''}`,
      };
    }
    case 429:
      return {
        code: 'THROTTLED',
        message:
          `Rate limit exceeded${retryAfter ? ` — retry after ${retryAfter}s` : ''}. ` +
          'The public API is throttled (600 req/hour; analytics 60/min).',
      };
    default:
      return status >= 500
        ? { code: 'SERVER', message: `Postmill server error (${status})${server ? `: ${server}` : ''}` }
        : { code: 'UNKNOWN', message: `Unexpected response (${status})${server ? `: ${server}` : ''}` };
  }
}

function retryAfterMs(header: string | null, attempt: number): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  return DEFAULT_RETRY_BACKOFF_MS * (attempt + 1);
}

export function createClient(options: ClientOptions, deps: ClientDeps = {}): Client {
  const sleep = deps.sleep ?? defaultSleep;
  const { apiKey, baseUrl } = options;

  async function rawRequest(method: string, path: string, req: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = {
      // Public API keys are sent raw — NO `Bearer` prefix
      // (apps/backend/src/services/auth/public.auth.middleware.ts).
      Authorization: apiKey,
      Accept: 'application/json',
    };
    if (MUTATING.has(method)) {
      headers['Idempotency-Key'] = req.idempotencyKey ?? randomUUID();
    }

    let body: string | FormData | undefined;
    if (req.form) {
      body = req.form; // fetch sets the multipart boundary itself
    } else if (req.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(req.body);
    }

    let res: Response;
    try {
      res = await fetch(buildUrl(baseUrl, path, req.query), { method, headers, body });
    } catch (err) {
      throw new ApiError(
        0,
        'NETWORK',
        `Could not reach ${baseUrl} (${err instanceof Error ? err.message : String(err)}). ` +
          'Check the base URL and your network connection.',
      );
    }
    return res;
  }

  async function request<T>(method: string, path: string, req: RequestOptions = {}): Promise<T> {
    const verb = method.toUpperCase();

    // Generate the idempotency key once per logical operation so a 429 retry
    // replays under the SAME key instead of looking like a new operation.
    if (MUTATING.has(verb) && !req.idempotencyKey) {
      req = { ...req, idempotencyKey: randomUUID() };
    }

    let res = await rawRequest(verb, path, req);

    // One retry on 429, honoring Retry-After, then give up.
    for (let attempt = 0; res.status === 429 && attempt < MAX_429_RETRIES; attempt++) {
      await sleep(retryAfterMs(res.headers.get('retry-after'), attempt));
      res = await rawRequest(verb, path, req);
    }

    const contentType = res.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    const parsed: unknown = isJson
      ? await res.json().catch(() => undefined)
      : await res.text().catch(() => undefined);

    if (!res.ok) {
      const { code, message } = friendlyError(res.status, parsed, res.headers.get('retry-after'));
      throw new ApiError(res.status, code, message, parsed);
    }

    return parsed as T;
  }

  return {
    request,
    get: (path, options) => request('GET', path, options),
    post: (path, options) => request('POST', path, options),
    put: (path, options) => request('PUT', path, options),
    delete: (path, options) => request('DELETE', path, options),
  };
}

/**
 * Cursor pagination helper for GET /posts (`{ posts, cursor }`, page size ≤ 100).
 * Fetches pages until `maxTotal` posts are collected or the cursor runs out.
 */
export async function paginatePosts(
  client: Client,
  query: { startDate: string; endDate: string },
  maxTotal = 100,
  startCursor?: number,
): Promise<{ posts: PostRecord[]; cursor: number | null }> {
  const collected: PostRecord[] = [];
  let cursor: number | null = startCursor ?? null;

  while (collected.length < maxTotal) {
    const limit = Math.min(100, maxTotal - collected.length);
    const page = await client.get<PostsPage>('/posts', {
      query: { ...query, limit, cursor: cursor ?? undefined },
    });
    collected.push(...page.posts);
    cursor = page.cursor;
    if (cursor === null || page.posts.length === 0) break;
  }

  return { posts: collected, cursor };
}
