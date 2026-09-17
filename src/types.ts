/**
 * DTO mirrors for the Postmill Public REST API (`/public/v1/*`).
 * Shapes verified against postmill-app:
 *  - apps/backend/src/public-api/routes/v1/public.integrations.controller.ts
 *  - apps/backend/src/public-api/routes/v1/public.analytics.v1.controller.ts
 *  - libraries/nestjs-libraries/src/dtos/... and the generated openapi.yml
 */

// ── Channels (GET /integrations) ─────────────────────────────────────────────

export interface Integration {
  id: string;
  name: string;
  identifier: string;
  picture: string | null;
  disabled: boolean;
  profile: string | null;
}

// ── Media upload (POST /upload, POST /upload-from-url) ───────────────────────

export interface MediaItem {
  id: string;
  path: string;
  alt?: string;
  thumbnail?: string;
}

/** Saved file record returned by both upload routes (FileService.saveFile). */
export interface UploadedFile {
  id: string;
  name: string;
  path: string;
  [key: string]: unknown;
}

// ── Posts ────────────────────────────────────────────────────────────────────

export interface PostRecord {
  id: string;
  state: string;
  publishDate: string;
  content: string;
  group: string;
  integration?: { id: string; name: string; providerIdentifier?: string };
  [key: string]: unknown;
}

export interface PostsPage {
  posts: PostRecord[];
  cursor: number | null;
}

/** CreatePostDto (POST /posts). */
export interface CreatePostPayload {
  type: 'draft' | 'schedule' | 'now' | 'update';
  date: string;
  shortLink: boolean;
  tags: { value: string; label: string }[];
  creationMethod: 'CLI';
  posts: {
    integration: { id: string };
    value: { content: string; image: MediaItem[] }[];
    settings: Record<string, unknown>;
  }[];
}

/** GET /find-slot/:id */
export interface FindSlotResponse {
  date: string;
}

/** ChangePostStatusDto (PUT /posts/:id/status). */
export type PostStatus = 'draft' | 'schedule';

// ── Video (POST /generate-video, GET /generate-video/:id) ────────────────────

/** VideoDto (POST /generate-video). */
export interface GenerateVideoPayload {
  type: string;
  output: 'vertical' | 'horizontal';
  customParams?: Record<string, unknown>;
}

/** Public job contract shared by POST /generate-video and GET /generate-video/:id. */
export interface VideoJob {
  id: string | null;
  status: 'pending' | 'completed' | 'failed';
  artifactUrl: string | null;
  provider: string | null;
  error: string | null;
}

/** VideoFunctionDto (POST /video/function) — only `loadVoices` is supported. */
export interface VideoFunctionPayload {
  identifier: string;
  functionName: 'loadVoices';
  params?: Record<string, unknown>;
}

export interface Voice {
  id: string;
  name: string;
  preview_url: string;
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export interface IsConnectedResponse {
  connected: boolean;
}

export interface ConnectUrlResponse {
  url: string;
}

export interface Notification {
  id: string;
  category?: string;
  message?: string;
  createdAt?: string;
  [key: string]: unknown;
}
