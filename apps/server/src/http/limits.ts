import type { MiddlewareHandler } from 'hono';
import { HttpError } from './errors.js';

/** v1: express.json({ limit: '2mb' }). Also the cap for any body that is not an upload. */
export const MAX_JSON_BYTES = 2 * 1024 * 1024;
/** v1: multer's fileSize limit, one file per upload. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** The 25 MB file plus multipart boundaries, part headers and small text fields. */
export const MAX_UPLOAD_REQUEST_BYTES = MAX_FILE_BYTES + 256 * 1024;

/** Thrown from inside the body stream the moment the byte count passes the cap. */
export class BodyTooLargeError extends HttpError {
  constructor() {
    super(413, 'request body too large');
  }
}

const UPLOAD_ROUTE = /^\/api\/(projects|tickets)\/[^/]+\/files\/?$/;

function capFor(method: string, path: string, contentType: string): number {
  const isUpload =
    method === 'POST' && UPLOAD_ROUTE.test(path) && /^multipart\/form-data\b/i.test(contentType);
  return isUpload ? MAX_UPLOAD_REQUEST_BYTES : MAX_JSON_BYTES;
}

/**
 * Caps the request body before anything reads it. A declared Content-Length over
 * the cap is refused at once without touching the body. Whatever is declared, the
 * body is also counted as it streams and errors the instant it passes the cap, so
 * a lying or absent Content-Length (chunked) cannot make the server buffer more
 * than the cap. Hono's own bodyLimit trusts a Content-Length that is under the cap.
 */
export const bodyLimit: MiddlewareHandler = async (c, next) => {
  const body = c.req.raw.body;
  if (!body) return next();
  const cap = capFor(c.req.method, c.req.path, c.req.header('content-type') ?? '');

  const declared = c.req.header('content-length');
  if (declared !== undefined && Number(declared) > cap) {
    // Leaves the unread body to be dropped with the connection.
    void body.cancel().catch(() => {});
    throw new BodyTooLargeError();
  }

  let seen = 0;
  const counted = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > cap) controller.error(new BodyTooLargeError());
        else controller.enqueue(chunk);
      },
    }),
  );
  c.req.raw = new Request(c.req.raw, { body: counted, duplex: 'half' } as RequestInit);
  return next();
};
