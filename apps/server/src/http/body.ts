import type { MiddlewareHandler } from 'hono';
import type { AppEnv, JsonBody } from '../context.js';
import { badRequest } from './errors.js';

/**
 * Parses an application/json body before routing, like express.json did, so a
 * malformed body fails the same way whatever route it was sent to. The size cap
 * is enforced earlier, while the body streams (limits.ts). Like v1, only objects
 * and arrays are accepted. Unlike v1, which answered 500 for anything else, a
 * body that is not valid JSON, or is JSON but not an object or array, is a 400.
 */
export const jsonBody: MiddlewareHandler<AppEnv> = async (c, next) => {
  let body: JsonBody = {};
  const type = c.req.header('content-type') ?? '';
  if (/^application\/json\b/i.test(type)) {
    const text = await c.req.text();
    if (text.trim() !== '') {
      if (!/^\s*[{[]/.test(text)) throw badRequest('request body must be a JSON object');
      try {
        body = JSON.parse(text) as JsonBody;
      } catch {
        throw badRequest('request body is not valid JSON');
      }
    }
  }
  c.set('body', body);
  await next();
};
