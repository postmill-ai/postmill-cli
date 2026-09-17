import type { Command } from 'commander';
import { createClient, type Client } from './client.js';
import { resolveCredentials, type ResolvedCredentials } from './config.js';
import { CliError, NOT_LOGGED_IN_MESSAGE, printError } from './output.js';

export interface GlobalOpts {
  json?: boolean;
  apiKey?: string;
  baseUrl?: string;
}

/** Merged local + global options for the command whose action is running. */
export function globalOpts(cmd: Command): GlobalOpts {
  return cmd.optsWithGlobals() as GlobalOpts;
}

export function credentialsFor(cmd: Command): ResolvedCredentials {
  const opts = globalOpts(cmd);
  return resolveCredentials({ apiKey: opts.apiKey, baseUrl: opts.baseUrl });
}

/** Client for the current command; fails with a friendly error when logged out. */
export function requireClient(cmd: Command): Client {
  const creds = credentialsFor(cmd);
  if (!creds.apiKey) {
    throw new CliError(NOT_LOGGED_IN_MESSAGE);
  }
  return createClient({ apiKey: creds.apiKey, baseUrl: creds.baseUrl });
}

type Action<Args extends unknown[] = unknown[]> = (...args: Args) => void | Promise<void>;

/** Wrap a commander action: errors → friendly stderr message + exit code 1. */
export function withErrors<Args extends unknown[]>(fn: Action<Args>): Action<Args> {
  return (async (...args: Args) => {
    try {
      await fn(...args);
    } catch (err) {
      printError(err);
      process.exitCode = 1;
    }
  }) as Action<Args>;
}
