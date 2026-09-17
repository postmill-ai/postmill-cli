import { ApiError } from './client.js';

/** Friendly, non-API CLI error (bad args, not logged in, ...) — no stack trace. */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

export const NOT_LOGGED_IN_MESSAGE =
  'You are not logged in. Run `postmill login`, set POSTMILL_API_KEY, or pass --api-key.';

export interface Column {
  /** Key into each row object. */
  key: string;
  /** Header label (defaults to the key). */
  label?: string;
  /** Max rendered width before truncation. */
  maxWidth?: number;
}

export interface TableData {
  columns: Column[];
  rows: Record<string, unknown>[];
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Hand-rolled aligned table — no table dependency. */
export function formatTable(table: TableData): string {
  const headers = table.columns.map((c) => c.label ?? c.key);
  const widths = table.columns.map((c, i) => {
    const max = Math.max(
      headers[i].length,
      ...table.rows.map((r) => cellText(r[c.key]).length),
    );
    return Math.min(max, c.maxWidth ?? 60);
  });

  const renderRow = (cells: string[]) =>
    cells
      .map((cell, i) => {
        const truncated = cell.length > widths[i] ? cell.slice(0, widths[i] - 1) + '…' : cell;
        return truncated.padEnd(widths[i]);
      })
      .join('  ')
      .trimEnd();

  const lines = [
    renderRow(headers),
    renderRow(widths.map((w) => '─'.repeat(w))),
    ...table.rows.map((row) => renderRow(table.columns.map((c) => cellText(row[c.key])))),
  ];
  return lines.join('\n');
}

/** True when output should be JSON: explicit --json, or stdout is not a TTY. */
export function wantsJson(jsonFlag: boolean | undefined): boolean {
  return Boolean(jsonFlag) || !process.stdout.isTTY;
}

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

/**
 * Print a result: JSON when requested/piped, a table (or plain line) on a TTY.
 * When `table` is omitted the value prints as JSON regardless.
 */
export function printResult(
  value: unknown,
  opts: { json?: boolean; table?: TableData; text?: string },
): void {
  if (wantsJson(opts.json) || (!opts.table && !opts.text)) {
    printJson(value);
    return;
  }
  process.stdout.write((opts.table ? formatTable(opts.table) : opts.text!) + '\n');
}

/** Errors go to stderr; ApiError/CliError never print a stack trace. */
export function printError(err: unknown): void {
  if (err instanceof ApiError || err instanceof CliError) {
    process.stderr.write(`Error: ${err.message}\n`);
    return;
  }
  process.stderr.write(`Error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
}
