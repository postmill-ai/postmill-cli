import type { Command } from 'commander';
import { CliError, printResult } from '../output.js';
import { globalOpts, requireClient, withErrors } from '../context.js';
import type { Notification } from '../types.js';

interface ListOpts {
  page?: string;
}

async function listAction(opts: ListOpts, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);

  const page = opts.page !== undefined ? Number(opts.page) : undefined;
  if (page !== undefined && (!Number.isInteger(page) || page < 0)) {
    throw new CliError(`--page must be a non-negative integer, got "${opts.page}".`);
  }

  const res = await client.get<{ notifications?: Notification[] } | Notification[]>(
    '/notifications',
    { query: { page } },
  );
  const list = Array.isArray(res) ? res : (res.notifications ?? []);
  printResult(res, {
    json,
    table: {
      columns: [
        { key: 'createdAt', label: 'DATE', maxWidth: 24 },
        { key: 'category', label: 'CATEGORY', maxWidth: 18 },
        { key: 'message', label: 'MESSAGE', maxWidth: 70 },
      ],
      rows: list as unknown as Record<string, unknown>[],
    },
  });
}

export function registerNotificationsCommands(program: Command): void {
  const notifications = program
    .command('notifications')
    .description('In-app notifications');

  notifications
    .command('list')
    .description('List notifications (zero-based --page)')
    .option('--page <n>', 'Zero-based page index')
    .action(withErrors(listAction));
}
