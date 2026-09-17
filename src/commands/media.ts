import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { Command } from 'commander';
import { CliError, printResult } from '../output.js';
import { globalOpts, requireClient, withErrors } from '../context.js';
import type { UploadedFile } from '../types.js';

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
};

function printUploaded(file: UploadedFile, json?: boolean): void {
  printResult(file, {
    json,
    table: {
      columns: [
        { key: 'id', label: 'ID', maxWidth: 28 },
        { key: 'name', label: 'NAME', maxWidth: 32 },
        { key: 'path', label: 'PATH', maxWidth: 60 },
      ],
      rows: [file as unknown as Record<string, unknown>],
    },
  });
}

async function uploadAction(filePath: string, _opts: unknown, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);

  const ext = extname(filePath).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    throw new CliError(
      `Unsupported file type "${ext || '(none)'}". Allowed: ${Object.keys(MIME_BY_EXT).join(', ')}.`,
    );
  }

  const buffer = await readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), basename(filePath));

  const uploaded = await client.post<UploadedFile>('/upload', { form });
  printUploaded(uploaded, json);
}

async function uploadUrlAction(url: string, _opts: unknown, cmd: Command): Promise<void> {
  const client = requireClient(cmd);
  const { json } = globalOpts(cmd);
  const uploaded = await client.post<UploadedFile>('/upload-from-url', { body: { url } });
  printUploaded(uploaded, json);
}

export function registerMediaCommands(program: Command): void {
  const media = program.command('media').description('Upload media for use in posts');

  media
    .command('upload <file>')
    .description('Upload a local image/video (jpeg, png, gif, webp, avif, bmp, tiff, mp4)')
    .action(withErrors(uploadAction));

  media
    .command('upload-url <url>')
    .description('Import media from a public HTTPS URL')
    .action(withErrors(uploadUrlAction));
}
