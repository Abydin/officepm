import type { MiddlewareHandler } from 'hono';
import type { AppEnv, JsonBody } from '../context.js';

const MAX_JSON_BYTES = 2 * 1024 * 1024; // v1: express.json({ limit: '2mb' })

/**
 * Parses an application/json body before routing, like express.json did, so a
 * malformed body fails the same way whatever route it was sent to. Like v1, only
 * objects and arrays are accepted. Anything else is not JSON this API understands
 * and surfaces as a 500 through the shared error handler, exactly as in v1.
 */
export const jsonBody: MiddlewareHandler<AppEnv> = async (c, next) => {
  let body: JsonBody = {};
  const type = c.req.header('content-type') ?? '';
  if (/^application\/json\b/i.test(type)) {
    const text = await c.req.text();
    if (Buffer.byteLength(text) > MAX_JSON_BYTES) throw new Error('request entity too large');
    if (text.trim() !== '') {
      if (!/^\s*[{[]/.test(text)) throw new SyntaxError('Unexpected token in JSON body');
      body = JSON.parse(text) as JsonBody;
    }
  }
  c.set('body', body);
  await next();
};
