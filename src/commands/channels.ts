import type { Command } from 'commander';
import { printResult } from '../output.js';
import { globalOpts, requireClient, withErrors } from '../context.js';
import type { ConnectUrlResponse, Integration } from '../types.js';

async function listAction(_opts: unknown, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);
  const integrations = await client.get<Integration[]>('/integrations');
  printResult(integrations, {
    json,
    table: {
      columns: [
        { key: 'id', label: 'ID', maxWidth: 28 },
        { key: 'name', label: 'NAME', maxWidth: 24 },
        { key: 'identifier', label: 'PROVIDER', maxWidth: 16 },
        { key: 'profile', label: 'PROFILE', maxWidth: 24 },
        { key: 'disabled', label: 'DISABLED', maxWidth: 8 },
      ],
      rows: integrations as unknown as Record<string, unknown>[],
    },
  });
}

interface ConnectOpts {
  providerVersion?: string;
  refresh?: string;
}

async function connectAction(identifier: string, opts: ConnectOpts, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);
  // The provider must be versioned — either "id@version" in the path or ?version=.
  const res = await client.get<ConnectUrlResponse>(`/social/${identifier}`, {
    query: { version: opts.providerVersion, refresh: opts.refresh },
  });
  printResult(res, {
    json,
    text: `Open this URL in a browser to connect the channel:\n\n${res.url}`,
  });
}

async function settingsAction(id: string, _opts: unknown, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);
  const res = await client.get(`/integration-settings/${id}`);
  printResult(res, { json });
}

async function deleteAction(id: string, _opts: unknown, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);
  const res = await client.delete(`/integrations/${id}`);
  printResult(res ?? { deleted: id }, { json, text: `Deleted channel ${id} (and its posts).` });
}

export function registerChannelsCommands(program: Command): void {
  const channels = program.command('channels').description('Manage connected channels');

  channels
    .command('list')
    .description('List connected channels')
    .action(withErrors(listAction));

  channels
    .command('connect <identifier>')
    .description('Print the OAuth URL to connect a channel (e.g. `x` with --version v1, or `x@v1`)')
    .option('--provider-version <v>', 'Provider version, e.g. v1 (required unless the id is qualified as id@version)')
    .option('--refresh <id>', 'Existing channel id to re-authenticate')
    .action(withErrors(connectAction));

  channels
    .command('settings <id>')
    .description('Show a channel\'s provider rules, max length, and available settings')
    .action(withErrors(settingsAction));

  channels
    .command('delete <id>')
    .description('Delete a channel (also deletes its scheduled posts)')
    .action(withErrors(deleteAction));
}
