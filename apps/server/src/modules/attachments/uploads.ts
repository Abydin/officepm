import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Context } from 'hono';
import { badRequest } from '../../http/errors.js';
import { BodyTooLargeError, MAX_FILE_BYTES } from '../../http/limits.js';

export const BLOCKED_EXTENSIONS = new Set(['.exe', '.sh', '.bat', '.cmd', '.js', '.html', '.htm']);
export const MAX_FILES_PER_TICKET = 20;
export const MAX_FILES_PER_PROJECT = 100;

/**
 * Extension of an upload's original name, normalised before it is compared with
 * the blocklist: anything after a NUL byte is dropped, then trailing whitespace
 * and dots, which is how "evil.exe " or "evil.exe." would otherwise slip past a
 * plain path.extname() check (extname('evil.exe.') is just '.').
 */
export function safeExt(originalName: string): string {
  const nul = originalName.indexOf('\u0000');
  const clean = (nul === -1 ? originalName : originalName.slice(0, nul)).replace(/[\s.]+$/, '');
  return path.extname(clean).toLowerCase();
}

export interface SavedUpload {
  originalName: string;
  storedPath: string;
  size: number;
  mimetype: string;
}

/**
 * Reads the single `file` field of a multipart request and writes it to
 * `dir` under a generated name. Errors are 400s carrying the same messages v1's
 * multer setup produced. A request that is not multipart, or has no file, yields null.
 */
export async function receiveUpload(
  c: Context,
  dir: string,
  uploadsDir: string,
): Promise<SavedUpload | null> {
  if (!/^multipart\/form-data\b/i.test(c.req.header('content-type') ?? '')) return null;

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch (e) {
    // The body stream errors with this when it passes the request cap (limits.ts).
    if (e instanceof BodyTooLargeError) throw e;
    throw badRequest((e as Error).message);
  }

  let file: File | null = null;
  for (const [field, value] of form.entries()) {
    if (typeof value === 'string') continue;
    // multer's .single('file'): a file under any other name, or a second one, is rejected.
    if (field !== 'file' || file) throw badRequest('Unexpected file field');
    file = value;
  }
  if (!file) return null;

  // Only the final path component of the client's name is kept, as multer does.
  const originalName = file.name.replace(/^.*[\\/]/, '');
  if (originalName === '') return null; // an empty filename means no file was chosen

  const ext = safeExt(originalName);
  if (BLOCKED_EXTENSIONS.has(ext)) throw badRequest('file type ' + ext + ' is not allowed');
  if (file.size > MAX_FILE_BYTES) throw badRequest('file exceeds 25MB limit');

  // The stored name is a UUID, never the client's, so the name cannot steer the path.
  const root = path.resolve(uploadsDir) + path.sep;
  const safeDir = path.resolve(dir);
  if (!(safeDir + path.sep).startsWith(root))
    throw new Error('resolved path escapes uploads/: ' + safeDir);
  fs.mkdirSync(safeDir, { recursive: true });
  const storedPath = path.join(safeDir, crypto.randomUUID() + ext);
  fs.writeFileSync(storedPath, Buffer.from(await file.arrayBuffer()));

  return { originalName, storedPath, size: file.size, mimetype: file.type || 'text/plain' };
}

// RFC 6266 / 5987 header, the same shape express's res.download produced.
function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '?').replace(/["\\]/g, '\\$&');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase(),
  );
  return /^[\x20-\x7e]*$/.test(name)
    ? 'attachment; filename="' + fallback + '"'
    : 'attachment; filename="' + fallback + "\"; filename*=UTF-8''" + encoded;
}

/** Streams a stored file as a download. Always an attachment, never inline (section 12). */
export function downloadResponse(file: string, downloadName: string): Response {
  const size = fs.statSync(file).size;
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(size),
      'content-disposition': contentDisposition(downloadName),
      'cache-control': 'private, max-age=0',
    },
  });
}
