import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BASE_URL,
  deleteConfig,
  loadConfig,
  resolveCredentials,
  saveConfig,
} from '../src/config.js';

function tempConfigDir(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'postmill-cli-test-'));
  return { dir, path: join(dir, 'config.json') };
}

describe('config file', () => {
  it('returns {} when the file is missing or invalid', () => {
    const { path } = tempConfigDir();
    expect(loadConfig(path)).toEqual({});
    writeFileSync(path, 'not json');
    expect(loadConfig(path)).toEqual({});
  });

  it('saves with mode 0600 and reloads', () => {
    const { path } = tempConfigDir();
    saveConfig({ apiKey: 'pm_live_x', baseUrl: 'https://self.hosted' }, path);

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadConfig(path)).toEqual({ apiKey: 'pm_live_x', baseUrl: 'https://self.hosted' });

    // re-save keeps 0600 even though the file already exists
    saveConfig({ apiKey: 'pm_live_y' }, path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('deleteConfig removes the file and reports whether it existed', () => {
    const { path } = tempConfigDir();
    expect(deleteConfig(path)).toBe(false);
    saveConfig({ apiKey: 'k' }, path);
    expect(deleteConfig(path)).toBe(true);
    expect(loadConfig(path)).toEqual({});
  });
});

describe('credential precedence', () => {
  it('flag > env > config file; base URL defaults to hosted', () => {
    const { path } = tempConfigDir();
    writeFileSync(path, JSON.stringify({ apiKey: 'file-key', baseUrl: 'https://file.url' }));

    // file only
    expect(resolveCredentials({}, {}, path)).toEqual({
      apiKey: 'file-key',
      baseUrl: 'https://file.url',
      apiKeySource: 'config',
    });

    // env beats file
    expect(
      resolveCredentials({}, { POSTMILL_API_KEY: 'env-key', POSTMILL_BASE_URL: 'https://env.url' }, path),
    ).toEqual({ apiKey: 'env-key', baseUrl: 'https://env.url', apiKeySource: 'env' });

    // flag beats env
    expect(
      resolveCredentials(
        { apiKey: 'flag-key', baseUrl: 'https://flag.url' },
        { POSTMILL_API_KEY: 'env-key', POSTMILL_BASE_URL: 'https://env.url' },
        path,
      ),
    ).toEqual({ apiKey: 'flag-key', baseUrl: 'https://flag.url', apiKeySource: 'flag' });
  });

  it('falls back to the hosted default base URL', () => {
    const { path } = tempConfigDir();
    const res = resolveCredentials({}, {}, path);
    expect(res.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(res.apiKey).toBeUndefined();
    expect(res.apiKeySource).toBeUndefined();
  });

  it('keeps file contents readable on disk as plain JSON', () => {
    const { path } = tempConfigDir();
    saveConfig({ apiKey: 'k' }, path);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ apiKey: 'k' });
  });
});
