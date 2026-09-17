import { homedir } from 'node:os';
import { join } from 'node:path';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

export const DEFAULT_BASE_URL = 'https://api.postmill.ai';

export interface StoredConfig {
  apiKey?: string;
  baseUrl?: string;
}

export interface CliFlags {
  apiKey?: string;
  baseUrl?: string;
}

export interface ResolvedCredentials {
  apiKey?: string;
  baseUrl: string;
  /** Where the api key came from, for display purposes. */
  apiKeySource?: 'flag' | 'env' | 'config';
}

export function defaultConfigPath(): string {
  return join(homedir(), '.config', 'postmill', 'config.json');
}

export function credentialsFileDisplay(): string {
  return defaultConfigPath();
}

export function loadConfig(path: string = defaultConfigPath()): StoredConfig {
  try {
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as StoredConfig) : {};
  } catch {
    return {};
  }
}

export function saveConfig(config: StoredConfig, path: string = defaultConfigPath()): void {
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  // writeFileSync mode only applies on creation — enforce 0600 on re-login too.
  chmodSync(path, 0o600);
}

export function deleteConfig(path: string = defaultConfigPath()): boolean {
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

/**
 * Credential precedence (highest first):
 *   --api-key / --base-url flags  >  POSTMILL_API_KEY / POSTMILL_BASE_URL env  >  config file
 * Base URL falls back to DEFAULT_BASE_URL when nothing sets it.
 */
export function resolveCredentials(
  flags: CliFlags,
  env: NodeJS.ProcessEnv = process.env,
  configPath: string = defaultConfigPath(),
): ResolvedCredentials {
  const file = loadConfig(configPath);

  const apiKey = flags.apiKey ?? env.POSTMILL_API_KEY ?? file.apiKey;
  const apiKeySource = flags.apiKey
    ? 'flag'
    : env.POSTMILL_API_KEY
      ? 'env'
      : file.apiKey
        ? 'config'
        : undefined;

  const baseUrl = flags.baseUrl ?? env.POSTMILL_BASE_URL ?? file.baseUrl ?? DEFAULT_BASE_URL;

  return { apiKey, baseUrl, apiKeySource };
}
