import crypto from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppContext, AppEnv } from '../context.js';
import { schema } from '../db/index.js';
import { HttpError } from './errors.js';

export const SESSION_COOKIE = 'pm_session';

export function requireAuth(ctx: AppContext): MiddlewareHandler<AppEnv> {
  const { orm } = ctx.db;
  const { sessions, users } = schema;
  return async (c, next) => {
    const sid = getCookie(c, SESSION_COOKIE);
    if (!sid) throw new HttpError(401, 'not authenticated');
    // expires_at is an ISO string with a "T"; datetime('now') has a space. A bare
    // string comparison accepts any session expiring earlier the same day, so both
    // sides go through datetime() first (the 35ba092 fix, pinned by the suite).
    const row = orm
      .select({
        user_id: sessions.user_id,
        email: users.email,
        name: users.name,
        is_admin: users.is_admin,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.user_id))
      .where(and(eq(sessions.id, sid), sql`datetime(${sessions.expires_at}) > datetime('now')`))
      .get();
    if (!row) throw new HttpError(401, 'session expired');
    c.set('user', { id: row.user_id, email: row.email, name: row.name, isAdmin: !!row.is_admin });
    await next();
  };
}

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user').isAdmin) throw new HttpError(403, 'admin only');
  await next();
};

const digest = (value: string) => crypto.createHash('sha256').update(value).digest();

/** Shared-secret check for the CI webhooks. They carry no session. */
export function requireGithubToken(ctx: AppContext): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!ctx.config.pmToken) throw new HttpError(500, 'PM_TOKEN not configured on server');
    const token = c.req.header('x-pm-token');
    // Constant-time compare, free to do and avoids leaking the token by timing.
    if (!token || !crypto.timingSafeEqual(digest(token), digest(ctx.config.pmToken))) {
      throw new HttpError(401, 'invalid or missing x-pm-token');
    }
    await next();
  };
}
