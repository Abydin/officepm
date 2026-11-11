import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Ok } from '@officepm/shared';
import type { AppContext, AppEnv } from '../../context.js';
import { requireAuth, SESSION_COOKIE } from '../../http/auth.js';
import { createAuthService, TooManyAttempts } from './service.js';

/** The client address the throttle keys on. X-Forwarded-For counts only behind a trusted proxy. */
function clientIp(c: Context, trustProxy: boolean): string {
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
    setCookie(c, SESSION_COOKIE, sid, {
      httpOnly: true,
      sameSite: 'Lax',
      // TLS terminates at a local proxy (Tailscale), so the forwarded header is the signal.
      secure: c.req.header('x-forwarded-proto') === 'https',
      expires,
      path: '/',
    });
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

  router.get('/me', requireAuth(ctx), (c) => c.json(c.get('user')));

  return router;
}
