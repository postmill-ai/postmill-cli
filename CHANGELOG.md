# Changelog

All notable changes to `@postmill-ai/postmill-cli` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-17

Initial release.

### Added

- `postmill login` / `status` / `logout` — interactive login with credential verification,
  config file at `~/.config/postmill/config.json` (mode 0600).
- `postmill posts` — `list` (cursor pagination), `create` (multi-channel, `--slot`, `--draft`,
  sends `creationMethod: 'CLI'`), `delete`, `delete-group`, `status`, `missing`.
- `postmill channels` — `list`, `connect` (OAuth URL, versioned providers), `settings`, `delete`.
- `postmill media` — `upload` (multipart) and `upload-url`.
- `postmill video` — `generate` (with `--wait` polling: 3 s interval, 5 min timeout, non-zero exit
  on failure), `status`, `voices`.
- `postmill analytics` — `overview`, `channel`, `post`, `posts`, `metric`, `day`, `best-time`,
  `recommendations`, `export` (csv/json).
- `postmill notifications list`.
- Thin typed HTTP client: raw API-key auth header, automatic `Idempotency-Key` on mutations,
  friendly error mapping (401/402/410/429/400), one 429 retry honoring `Retry-After`.
- Output: aligned tables on a TTY; `--json` flag and automatic JSON when piped.
- Credential precedence: `--api-key`/`--base-url` flags > `POSTMILL_API_KEY`/`POSTMILL_BASE_URL`
  env > config file; default base URL `https://api.postmill.ai`.
