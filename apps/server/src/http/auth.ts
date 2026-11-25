import crypto from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { PASSWORD_CHANGE_REQUIRED } from '@officepm/shared';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppContext, AppEnv, SessionUser } from '../context.js';
import { schema } from '../db/index.js';
import { HttpError } from './errors.js';

export const SESSION_COOKIE = 'pm_session';

/**
 * The user a live session id belongs to, or null for an unknown or expired one. A deactivated
 * account has no live session: deactivating deletes its sessions, and this refuses any that
 * somehow remain.
 */
export function findSessionUser(ctx: AppContext, sid: string): SessionUser | null {
  const { orm } = ctx.db;
  const { sessions, users } = schema;
  // expires_at is an ISO string with a "T"; datetime('now') has a space. A bare
  // string comparison accepts any session expiring earlier the same day, so both
  // sides go through datetime() first (the 35ba092 fix, pinned by the suite).
  const row = orm
    .select({
      user_id: sessions.user_id,
      email: users.email,
      name: users.name,
      is_admin: users.is_admin,
      must_change_password: users.must_change_password,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.user_id))
    .where(
      and(
        eq(sessions.id, sid),
        sql`datetime(${sessions.expires_at}) > datetime('now')`,
        isNull(users.deactivated_at),
      ),
    )
    .get();
  return row
    ? {
        id: row.user_id,
        email: row.email,
        name: row.name,
        isAdmin: !!row.is_admin,
        mustChangePassword: !!row.must_change_password,
      }
    : null;
}

export interface RequireAuthOptions {
  /**
   * Let a person who still has to choose a password through. Only the two routes that let them
   * do it (GET /me and POST /me/password) set this; every other route refuses them with a 403.
   * Because the refusal is the default, a route added later is covered without anyone remembering.
   */
  allowPasswordChange?: boolean;
}

export function requireAuth(
  ctx: AppContext,
  options: RequireAuthOptions = {},
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const sid = getCookie(c, SESSION_COOKIE);
    if (!sid) throw new HttpError(401, 'not authenticated');
    const user = findSessionUser(ctx, sid);
    if (!user) throw new HttpError(401, 'session expired');
    if (user.mustChangePassword && !options.allowPasswordChange) {
      throw new HttpError(403, PASSWORD_CHANGE_REQUIRED);
    }
    c.set('user', user);
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
