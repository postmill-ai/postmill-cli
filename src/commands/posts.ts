import type { Command } from 'commander';
import { paginatePosts } from '../client.js';
import { CliError, printResult, type TableData } from '../output.js';
import { globalOpts, requireClient, withErrors } from '../context.js';
import type {
  CreatePostPayload,
  FindSlotResponse,
  PostRecord,
  PostStatus,
} from '../types.js';

function postsTable(posts: PostRecord[]): TableData {
  return {
    columns: [
      { key: 'id', label: 'ID', maxWidth: 28 },
      { key: 'publishDate', label: 'PUBLISH DATE', maxWidth: 24 },
      { key: 'state', label: 'STATE', maxWidth: 12 },
      { key: 'channel', label: 'CHANNEL', maxWidth: 24 },
      { key: 'content', label: 'CONTENT', maxWidth: 50 },
    ],
    rows: posts.map((p) => ({
      ...p,
      channel: p.integration?.name ?? p.integration?.id ?? '',
      content: (p.content ?? '').replace(/\s+/g, ' ').trim(),
    })),
  };
}

/** commander argParser that accumulates repeatable options into an array. */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

interface ListOpts {
  from: string;
  to: string;
  limit?: string;
  cursor?: string;
  page?: boolean;
}

async function listAction(opts: ListOpts, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);

  const limit = opts.limit ? Number(opts.limit) : 100;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new CliError('--limit must be a positive integer.');
  }
  const cursor = opts.cursor !== undefined ? Number(opts.cursor) : undefined;
  if (cursor !== undefined && (!Number.isInteger(cursor) || cursor < 0)) {
    throw new CliError('--cursor must be a non-negative integer.');
  }

  // --page: fetch exactly one page and expose the next cursor for scripting.
  if (opts.page || cursor !== undefined) {
    const page = await client.get<{ posts: PostRecord[]; cursor: number | null }>('/posts', {
      query: {
        startDate: opts.from,
        endDate: opts.to,
        limit: Math.min(limit, 100),
        cursor,
      },
    });
    printResult(page, { json, table: postsTable(page.posts) });
    if (page.cursor !== null && !json && process.stdout.isTTY) {
      process.stdout.write(`Next page: --cursor ${page.cursor}\n`);
    }
    return;
  }

  const { posts } = await paginatePosts(
    client,
    { startDate: opts.from, endDate: opts.to },
    limit,
  );
  printResult({ posts, count: posts.length }, { json, table: postsTable(posts) });
}

interface CreateOpts {
  channel: string[];
  content: string;
  date?: string;
  slot?: boolean;
  draft?: boolean;
  media?: string[];
  tag?: string[];
  shortLink?: boolean;
}

async function createAction(opts: CreateOpts, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);

  if (!opts.channel?.length) {
    throw new CliError('At least one --channel <id> is required (see `postmill channels list`).');
  }
  if (!opts.content) {
    throw new CliError('--content is required.');
  }
  if (opts.slot && opts.date) {
    throw new CliError('Use either --date or --slot, not both.');
  }
  if (!opts.slot && !opts.date) {
    throw new CliError('Either --date <iso> or --slot (next free slot) is required.');
  }

  let date = opts.date;
  if (opts.slot) {
    // Resolve the next free publishing slot for the first channel.
    const slot = await client.get<FindSlotResponse>(`/find-slot/${opts.channel[0]}`);
    date = slot.date;
  }

  const image = (opts.media ?? []).map((path) => ({ id: '', path }));
  const payload: CreatePostPayload = {
    type: opts.draft ? 'draft' : 'schedule',
    date: date!,
    shortLink: Boolean(opts.shortLink),
    tags: (opts.tag ?? []).map((t) => ({ value: t, label: t })),
    creationMethod: 'CLI',
    posts: opts.channel.map((id) => ({
      integration: { id },
      value: [{ content: opts.content, image }],
      settings: {},
    })),
  };

  const created = await client.post('/posts', { body: payload });
  printResult(created, {
    json,
    text: `Post ${opts.draft ? 'saved as draft' : 'scheduled'} for ${date} on ${opts.channel.length} channel(s).`,
  });
}

async function deleteAction(id: string, _opts: unknown, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);
  const res = await client.delete(`/posts/${id}`);
  printResult(res ?? { deleted: id }, { json, text: `Deleted post ${id} (and its group).` });
}

async function deleteGroupAction(group: string, _opts: unknown, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);
  const res = await client.delete(`/posts/group/${group}`);
  printResult(res ?? { deleted: group }, { json, text: `Deleted post group ${group}.` });
}

interface StatusOpts {
  draft?: boolean;
  schedule?: boolean;
}

async function statusAction(id: string, opts: StatusOpts, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);

  if (Boolean(opts.draft) === Boolean(opts.schedule)) {
    throw new CliError('Pass exactly one of --draft or --schedule.');
  }
  const status: PostStatus = opts.draft ? 'draft' : 'schedule';
  const res = await client.put(`/posts/${id}/status`, { body: { status } });
  printResult(res ?? { id, status }, { json, text: `Post ${id} is now "${status}".` });
}

async function missingAction(id: string, _opts: unknown, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);
  const res = await client.get(`/posts/${id}/missing`);
  printResult(res, { json });
}

export function registerPostsCommands(program: Command): void {
  const posts = program.command('posts').description('Create, list, and manage posts');

  posts
    .command('list')
    .description('List posts in a publish-date window (paginates up to --limit)')
    .requiredOption('--from <iso>', 'Start of the window (ISO 8601), e.g. 2026-01-01T00:00:00.000Z')
    .requiredOption('--to <iso>', 'End of the window (ISO 8601); max 92 days after --from')
    .option('--limit <n>', 'Max posts to return in total (fetched in pages of ≤100)', '100')
    .option('--cursor <n>', 'Fetch a single page starting at this cursor (from a previous response)')
    .option('--page', 'Fetch exactly one page and print the next cursor')
    .action(withErrors(listAction));

  posts
    .command('create')
    .description('Create a post on one or more channels (scheduled by default)')
    .option('--channel <id>', 'Channel (integration) id; repeatable', collect, [])
    .requiredOption('--content <text>', 'Post text')
    .option('--date <iso>', 'Publish date (ISO 8601)')
    .option('--slot', 'Use the next free publishing slot for the first channel')
    .option('--draft', 'Save as a draft instead of scheduling')
    .option('--media <url>', 'Media URL to attach (upload first with `postmill media upload`); repeatable', collect, [])
    .option('--tag <tag>', 'Tag to attach; repeatable', collect, [])
    .option('--short-link', 'Shorten links in the content', false)
    .action(withErrors(createAction));

  posts
    .command('delete <id>')
    .description('Delete a post (deletes its whole group, like the app)')
    .action(withErrors(deleteAction));

  posts
    .command('delete-group <group>')
    .description('Delete every post in a group')
    .action(withErrors(deleteGroupAction));

  posts
    .command('status <id>')
    .description('Move a post between draft and scheduled')
    .option('--draft', 'Move to draft')
    .option('--schedule', 'Move to scheduled')
    .action(withErrors(statusAction));

  posts
    .command('missing <id>')
    .description('Show what content a channel post is missing before it can publish')
    .action(withErrors(missingAction));
}
