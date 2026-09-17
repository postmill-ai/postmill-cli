import { Command } from 'commander';
import { registerAuthCommands } from './commands/auth.js';
import { registerPostsCommands } from './commands/posts.js';
import { registerChannelsCommands } from './commands/channels.js';
import { registerMediaCommands } from './commands/media.js';
import { registerVideoCommands } from './commands/video.js';
import { registerAnalyticsCommands } from './commands/analytics.js';
import { registerNotificationsCommands } from './commands/notifications.js';

// Keep in sync with package.json "version" (the publish workflow gates on the tag).
const VERSION = '0.1.0';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('postmill')
    .description('Official CLI for the Postmill platform')
    .version(VERSION)
    .option('--json', 'Output JSON (automatic when stdout is not a TTY)')
    .option('--api-key <key>', 'API key (overrides POSTMILL_API_KEY and the config file)')
    .option('--base-url <url>', 'API base URL (overrides POSTMILL_BASE_URL and the config file)');

  registerAuthCommands(program);
  registerPostsCommands(program);
  registerChannelsCommands(program);
  registerMediaCommands(program);
  registerVideoCommands(program);
  registerAnalyticsCommands(program);
  registerNotificationsCommands(program);

  return program;
}

// Run only when executed directly (not when imported by tests).
const invokedAsScript = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedAsScript) {
  createProgram().parseAsync(process.argv).catch((err: unknown) => {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
