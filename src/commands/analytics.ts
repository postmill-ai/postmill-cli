import type { Command } from 'commander';
import { printResult } from '../output.js';
import { globalOpts, requireClient, withErrors } from '../context.js';

interface RangeOpts {
  from?: string;
  to?: string;
  compare?: boolean;
  integrations?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The API requires from/to — default to the last 30 days when flags are omitted. */
function dateRange(opts: RangeOpts): { from: string; to: string } {
  const to = opts.to ?? new Date().toISOString().slice(0, 10);
  const from = opts.from ?? new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10);
  return { from, to };
}

function rangeQuery(opts: RangeOpts): Record<string, string | undefined> {
  const { from, to } = dateRange(opts);
  return {
    from,
    to,
    integrations: opts.integrations,
    compare: opts.compare ? 'true' : undefined,
  };
}

async function overviewAction(opts: RangeOpts, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);
  const res = await client.get('/analytics/overview', { query: rangeQuery(opts) });
  printResult(res, { json });
}

async function channelAction(id: string, opts: RangeOpts, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);
  const res = await client.get(`/analytics/channel/${id}`, { query: rangeQuery(opts) });
  printResult(res, { json });
}

async function postAction(id: string, opts: { date?: string }, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);
  const res = await client.get(`/analytics/post/${id}`, { query: { date: opts.date } });
  printResult(res, { json });
}

interface PostsOpts extends RangeOpts {
  sort?: string;
  dir?: string;
  page?: string;
  limit?: string;
}

async function postsAction(opts: PostsOpts, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);
  const res = await client.get('/analytics/posts', {
    query: {
      ...rangeQuery(opts),
      sort: opts.sort,
      dir: opts.dir,
      page: opts.page ? Number(opts.page) : undefined,
      limit: opts.limit ? Number(opts.limit) : undefined,
    },
  });
  printResult(res, { json });
}

async function metricAction(metric: string, opts: RangeOpts, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);
  const res = await client.get(`/analytics/metric/${metric}`, { query: rangeQuery(opts) });
  printResult(res, { json });
}

interface DayOpts {
  date: string;
  metric: string;
  integrations?: string;
}

async function dayAction(opts: DayOpts, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);
  const res = await client.get('/analytics/day', {
    query: { date: opts.date, metric: opts.metric, integrations: opts.integrations },
  });
  printResult(res, { json });
}

interface BestTimeOpts {
  integrations?: string;
  channel?: string;
  tz?: string;
}

async function bestTimeAction(opts: BestTimeOpts, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);
  const res = await client.get('/analytics/best-time', {
    query: {
      integrations: opts.integrations,
      integration: opts.channel,
      tz: opts.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });
  printResult(res, { json });
}

async function recommendationsAction(_opts: unknown, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);
  const res = await client.get('/analytics/recommendations');
  printResult(res, { json });
}

interface ExportOpts extends RangeOpts {
  format?: string;
}

async function exportAction(opts: ExportOpts, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);
  const format = opts.format ?? 'json';
  const res = await client.get<unknown>('/analytics/export', {
    query: { ...rangeQuery(opts), format },
  });
  // CSV comes back as text — print it raw so it can be piped to a file.
  if (typeof res === 'string') {
    process.stdout.write(res.endsWith('\n') ? res : res + '\n');
    return;
  }
  printResult(res, { json });
}

export function registerAnalyticsCommands(program: Command): void {
  const analytics = program.command('analytics').description('Channel and post analytics');

  analytics
    .command('overview')
    .description('Org-wide analytics overview (defaults to the last 30 days)')
    .option('--from <date>', 'Start date (default: 30 days ago)')
    .option('--to <date>', 'End date (default: today)')
    .option('--integrations <csv>', 'Comma-separated channel ids')
    .option('--compare', 'Include the previous-period comparison')
    .action(withErrors(overviewAction));

  analytics
    .command('channel <id>')
    .description('Analytics for one channel')
    .option('--from <date>', 'Start date')
    .option('--to <date>', 'End date')
    .option('--compare', 'Include the previous-period comparison')
    .action(withErrors(channelAction));

  analytics
    .command('post <id>')
    .description('Analytics for one post')
    .option('--date <date>', 'Limit to a single date')
    .action(withErrors(postAction));

  analytics
    .command('posts')
    .description('Per-post analytics table for a date range')
    .option('--from <date>', 'Start date')
    .option('--to <date>', 'End date')
    .option('--integrations <csv>', 'Comma-separated channel ids')
    .option('--sort <field>', 'Metric to sort by (or publishedAt)')
    .option('--dir <dir>', 'asc or desc (default: desc)')
    .option('--page <n>', 'Page number (default: 1)')
    .option('--limit <n>', 'Page size (max 100, default: 20)')
    .action(withErrors(postsAction));

  analytics
    .command('metric <metric>')
    .description('Time series for one metric (e.g. followers, likes)')
    .option('--from <date>', 'Start date')
    .option('--to <date>', 'End date')
    .option('--integrations <csv>', 'Comma-separated channel ids')
    .option('--compare', 'Include the previous-period comparison')
    .action(withErrors(metricAction));

  analytics
    .command('day')
    .description('Breakdown of one metric on one date')
    .requiredOption('--date <date>', 'The date to inspect')
    .requiredOption('--metric <metric>', 'The metric to inspect')
    .option('--integrations <csv>', 'Comma-separated channel ids')
    .action(withErrors(dayAction));

  analytics
    .command('best-time')
    .description('Best times to post (engagement heatmap)')
    .option('--integrations <csv>', 'Comma-separated channel ids')
    .option('--channel <id>', 'Single channel to group by')
    .option('--tz <iana>', 'IANA timezone (default: your system timezone)')
    .action(withErrors(bestTimeAction));

  analytics
    .command('recommendations')
    .description('Posting recommendations for your channels')
    .action(withErrors(recommendationsAction));

  analytics
    .command('export')
    .description('Export analytics data (prints to stdout — pipe to a file)')
    .option('--from <date>', 'Start date')
    .option('--to <date>', 'End date')
    .option('--integrations <csv>', 'Comma-separated channel ids')
    .option('--format <format>', 'csv or json (default: json)')
    .action(withErrors(exportAction));
}
