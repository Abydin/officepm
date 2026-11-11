import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Hono, type Context } from 'hono';
import type { AppContext, AppEnv } from '../../context.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.mjs': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.map': 'application/json; charset=UTF-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function fileResponse(file: string, cacheControl = 'public, max-age=0'): Response | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
      headers: {
        'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-length': String(stat.size),
        'cache-control': cacheControl,
      },
    });
  } catch {
    return null;
  }
}

/**
 * The browser client, served from `webDir` (PM_WEB_DIR). Until the v2 web app
 * lands this is the v1 client in legacy/, which is why the default points there.
 * Never serves uploads/: only three fixed files and the vendor and assets directories.
 */
export function staticRoutes(ctx: AppContext) {
  const router = new Hono<AppEnv>();
  const webDir = ctx.config.webDir;
  const send = (name: string) => () =>
    fileResponse(path.join(webDir, name)) ??
    new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });

  router.get('/', send('index.html'));
  router.get('/app.js', send('app.js'));
  router.get('/styles.css', send('styles.css'));

  /** A directory of files under webDir, with the path kept inside it. */
  const serveDir = (name: string, cacheControl?: string) => (c: Context) => {
    const root = path.join(webDir, name);
    let rel: string;
    try {
      rel = decodeURIComponent(c.req.path.slice(('/' + name + '/').length));
    } catch {
      return c.json({ error: 'not found' }, 404); // a malformed %-escape, not a server error
    }
    const file = path.resolve(root, rel);
    const res =
      rel.includes('\0') || !file.startsWith(root + path.sep)
        ? null
        : fileResponse(file, cacheControl);
    return res ?? c.json({ error: 'not found' }, 404);
  };

  router.get('/vendor/*', serveDir('vendor'));
  // Lazily loaded screens of the v2 client. The file names carry a content hash,
  // so they can be cached for good.
  router.get('/assets/*', serveDir('assets', 'public, max-age=31536000, immutable'));

  return router;
}
