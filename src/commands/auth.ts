import { createInterface } from 'node:readline/promises';
import type { Command } from 'commander';
import { createClient } from '../client.js';
import {
  DEFAULT_BASE_URL,
  credentialsFileDisplay,
  deleteConfig,
  saveConfig,
} from '../config.js';
import { CliError, printResult } from '../output.js';
import { credentialsFor, globalOpts, requireClient, withErrors } from '../context.js';
import type { IsConnectedResponse } from '../types.js';

async function loginAction(): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new CliError(
      '`postmill login` is interactive. In scripts, use --api-key or the POSTMILL_API_KEY env var instead.',
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let baseUrl: string;
  let apiKey: string;
  try {
    baseUrl = (await rl.question(`Base URL [${DEFAULT_BASE_URL}]: `)).trim() || DEFAULT_BASE_URL;
    apiKey = (await rl.question('API key (dashboard → Settings → API Keys): ')).trim();
  } finally {
    rl.close();
  }

  if (!apiKey) {
    throw new CliError('No API key entered — login aborted.');
  }

  const client = createClient({ apiKey, baseUrl });
  const res = await client.get<IsConnectedResponse>('/is-connected');
  if (!res.connected) {
    throw new CliError('The server did not accept this API key.');
  }

  saveConfig({ apiKey, baseUrl });
  printResult(
    { connected: true, baseUrl, configFile: credentialsFileDisplay() },
    {
      json: false,
      text: `Logged in. Credentials saved to ${credentialsFileDisplay()} (permissions 0600).`,
    },
  );
}

function statusAction(_opts: unknown, cmd: Command): Promise<void> {
  const opts = globalOpts(cmd);
  const creds = credentialsFor(cmd);
  if (!creds.apiKey) {
    throw new CliError(
      'You are not logged in. Run `postmill login`, set POSTMILL_API_KEY, or pass --api-key.',
    );
  }

  const client = requireClient(cmd);
  return client.get<IsConnectedResponse>('/is-connected').then((res) => {
    printResult(
      { connected: res.connected, baseUrl: creds.baseUrl, apiKeySource: creds.apiKeySource },
      {
        json: opts.json,
        text: res.connected
          ? `Connected to ${creds.baseUrl} (API key from ${creds.apiKeySource}).`
          : 'Not connected.',
      },
    );
  });
}

function logoutAction(_opts: unknown, cmd: Command): void {
  const opts = globalOpts(cmd);
  const removed = deleteConfig();
  printResult(
    { loggedOut: true, configFileRemoved: removed },
    {
      json: opts.json,
      text: removed
        ? `Logged out — removed ${credentialsFileDisplay()}. Env vars (POSTMILL_API_KEY) are untouched.`
        : 'No saved credentials found — nothing to remove. Env vars (POSTMILL_API_KEY) are untouched.',
    },
  );
}

export function registerAuthCommands(program: Command): void {
  program
    .command('login')
    .description('Interactively save an API key (and optional base URL) to the config file')
    .action(withErrors(loginAction));

  program
    .command('status')
    .description('Check whether the saved/provided API key is accepted by the server')
    .action(withErrors(statusAction));

  program
    .command('logout')
    .description('Remove the saved credentials file')
    .action(withErrors(logoutAction));
}
