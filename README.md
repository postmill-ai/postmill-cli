# postmill-cli

Official command-line interface for the [Postmill](https://github.com/postmill-ai/postmill) platform.
Talks to the Postmill Public REST API (`/public/v1/*`) of any Postmill instance — hosted
(`https://api.postmill.ai`) or self-hosted — using a user API key.

Requires Node.js ≥ 20.

## Install

```bash
npm i -g @postmill-ai/postmill-cli
```

## Quick start

1. Create an API key in the Postmill dashboard under **Settings → API Keys**.
2. Log in:

   ```bash
   postmill login
   ```

   This prompts for the base URL (default `https://api.postmill.ai`) and your API key, verifies the
   key against the server, and saves it to `~/.config/postmill/config.json` (permissions `0600`).

3. Use it:

   ```bash
   postmill status
   postmill channels list
   postmill posts list --from 2026-01-01 --to 2026-01-31
   ```

### Non-interactive credentials (CI, scripts)

Instead of `postmill login`, set environment variables or pass flags:

```bash
export POSTMILL_API_KEY=pm_live_...
postmill channels list --json

# or per-invocation
postmill channels list --api-key pm_live_... --base-url https://postmill.example.com
```

**Precedence:** `--api-key` / `--base-url` flags > `POSTMILL_API_KEY` / `POSTMILL_BASE_URL`
environment variables > `~/.config/postmill/config.json`. The base URL defaults to
`https://api.postmill.ai`.

### Self-hosted instances

Point the CLI at your instance in any of these ways:

```bash
postmill login                                  # enter your instance URL when prompted
export POSTMILL_BASE_URL=https://postmill.example.com
postmill channels list --base-url https://postmill.example.com
```

## Output

- On a TTY, list/get commands print simple aligned tables.
- `--json` forces JSON output; JSON is also used automatically when stdout is not a TTY (pipes,
  files), so scripts never need the flag.
- Errors are printed to stderr with exit code 1 (friendly messages, no stack traces).
- Mutating requests send an automatic `Idempotency-Key` (safe to retry within 24 h).
- Rate-limited (429) requests are retried once, honoring `Retry-After`.

## Command reference

Global flags (usable before or after the subcommand): `--json`, `--api-key <key>`, `--base-url <url>`.

### Auth

| Command | Description |
|---|---|
| `postmill login` | Interactively save an API key (+ base URL) to the config file |
| `postmill status` | Check that the current credentials are accepted by the server |
| `postmill logout` | Remove the saved credentials file |

### Posts

| Command | Description |
|---|---|
| `postmill posts list --from <iso> --to <iso> [--limit n] [--cursor n] [--page]` | List posts in a publish-date window (max 92 days). Follows pages up to `--limit` (default 100); `--cursor`/`--page` fetch a single page |
| `postmill posts create --channel <id> [--channel <id>…] --content <text> (--date <iso> \| --slot) [--draft] [--media <url>…] [--tag <t>…] [--short-link]` | Create a post on one or more channels. Scheduled by default; `--draft` saves a draft. `--slot` uses the next free publishing slot for the first channel |
| `postmill posts delete <id>` | Delete a post (deletes its whole group) |
| `postmill posts delete-group <group>` | Delete every post in a group |
| `postmill posts status <id> (--draft \| --schedule)` | Move a post between draft and scheduled |
| `postmill posts missing <id>` | Show what a channel post is missing before it can publish |

Example:

```bash
postmill posts create --channel clx123 --content "Shipping today!" --slot
```

### Channels

| Command | Description |
|---|---|
| `postmill channels list` | List connected channels |
| `postmill channels connect <identifier> [--provider-version <v>] [--refresh <id>]` | Print the OAuth URL to connect a channel. The provider must be versioned: pass e.g. `x --provider-version v1` or a qualified id like `x@v1`. `--refresh` re-authenticates an existing channel |
| `postmill channels settings <id>` | Show a channel's provider rules, max length, and settings schema |
| `postmill channels delete <id>` | Delete a channel (also deletes its scheduled posts) |

### Media

| Command | Description |
|---|---|
| `postmill media upload <file>` | Upload a local image/video (jpeg, png, gif, webp, avif, bmp, tiff, mp4) |
| `postmill media upload-url <url>` | Import media from a public HTTPS URL |

### Video

| Command | Description |
|---|---|
| `postmill video generate [--type <t>] [--output vertical\|horizontal] [--prompt <text>] [--image-url <url>] [--video-url <url>] [--wait]` | Start an AI video job. Defaults to text-to-video, vertical. `--wait` polls every 3 s (up to 5 min) and exits non-zero if the job fails |
| `postmill video status <id>` | Check a video generation job |
| `postmill video voices --provider <id>` | List narrator voices for a video provider |

### Analytics

Date-range flags are `--from` / `--to` (default: last 30 days). Window is capped at 400 days by the API.

| Command | Description |
|---|---|
| `postmill analytics overview [--from --to] [--integrations <csv>] [--compare]` | Org-wide analytics overview |
| `postmill analytics channel <id> [--from --to] [--compare]` | Analytics for one channel |
| `postmill analytics post <id> [--date <date>]` | Analytics for one post |
| `postmill analytics posts [--from --to] [--integrations <csv>] [--sort <field>] [--dir asc\|desc] [--page n] [--limit n]` | Per-post analytics table |
| `postmill analytics metric <metric> [--from --to] [--integrations <csv>] [--compare]` | Time series for one metric |
| `postmill analytics day --date <date> --metric <metric> [--integrations <csv>]` | One metric on one date |
| `postmill analytics best-time [--integrations <csv>] [--channel <id>] [--tz <iana>]` | Best times to post (engagement heatmap) |
| `postmill analytics recommendations` | Posting recommendations |
| `postmill analytics export [--from --to] [--integrations <csv>] [--format csv\|json]` | Export analytics to stdout (pipe to a file) |

### Notifications

| Command | Description |
|---|---|
| `postmill notifications list [--page n]` | List notifications (zero-based page) |

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm build       # tsup → dist/cli.js
```

## Releasing (maintainers)

Releases are tag-driven: push a `cli-vX.Y.Z` tag whose version matches `package.json`, and
`.github/workflows/publish.yml` typechecks, tests, builds, and publishes to npm with provenance via
**OIDC trusted publishing** (no npm token secret), then creates the GitHub Release.

One-time manual step: a maintainer must configure the **Trusted Publisher** for
`@postmill-ai/postmill-cli` on npmjs.com (package settings → Trusted Publisher → GitHub Actions,
naming this repo and the `publish.yml` workflow filename). Without it the npm publish step fails.

## License

AGPL-3.0 — see [LICENSE](./LICENSE).
