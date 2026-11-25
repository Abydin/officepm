import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Ok } from '@officepm/shared';
import type { AppContext, AppEnv } from '../../context.js';
import { findSessionUser, requireAuth, SESSION_COOKIE } from '../../http/auth.js';
import { createAuthService, TooManyAttempts } from './service.js';

/** The client address the throttle keys on. X-Forwarded-For counts only behind a trusted proxy. */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    // The rightmost entry is the one our own proxy appended; the rest the client can forge.
    const last = c.req.header('x-forwarded-for')?.split(',').pop()?.trim();
    if (last) return last;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Sets the session cookie on a response. Login and invite accept both sign the person in with it. */
export function setSessionCookie(c: Context, sid: string, expires: Date): void {
  setCookie(c, SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: 'Lax',
    // TLS terminates at a local proxy (Tailscale), so the forwarded header is the signal.
    secure: c.req.header('x-forwarded-proto') === 'https',
    expires,
    path: '/',
  });
}

export function authRoutes(ctx: AppContext) {
  const service = createAuthService(ctx);
  const router = new Hono<AppEnv>();

  router.post('/login', async (c) => {
    let result;
    try {
      result = await service.login(c.get('body'), clientIp(c, ctx.config.trustProxy));
    } catch (e) {
      if (e instanceof TooManyAttempts) c.header('Retry-After', String(e.retryAfter));
      throw e;
    }
    const { sid, expires, user } = result;
    setSessionCookie(c, sid, expires);
    return c.json(user);
  });

  router.post('/logout', (c) => {
    const sid = getCookie(c, SESSION_COOKIE);
    service.logout(sid);
    if (sid) ctx.events.closeForSession(sid);
    // Same wire form as Express's clearCookie: an empty value that expired in 1970.
    setCookie(c, SESSION_COOKIE, '', { path: '/', expires: new Date(0) });
    return c.json({ ok: true } satisfies Ok);
  });

  // The two routes a person who must change their password can still reach (see requireAuth).
  const forced = requireAuth(ctx, { allowPasswordChange: true });

  router.get('/me', forced, (c) => c.json(c.get('user')));

  router.post('/me/password', forced, async (c) => {
    try {
      await service.changePassword(
        c.get('user'),
        getCookie(c, SESSION_COOKIE) ?? '',
        c.get('body'),
        clientIp(c, ctx.config.trustProxy),
      );
    } catch (e) {
      if (e instanceof TooManyAttempts) c.header('Retry-After', String(e.retryAfter));
      throw e;
    }
    return c.json({ ok: true } satisfies Ok);
  });

  // The page's first question on load. Signed out is a normal answer to it, so it is a
  // 200 with null here, where /me stays a 401 and the browser console stays quiet.
  router.get('/session', (c) => {
    const sid = getCookie(c, SESSION_COOKIE);
    return c.json(sid ? findSessionUser(ctx, sid) : null);
  });

  return router;
}
