import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Ok } from '@officepm/shared';
import type { AppContext, AppEnv } from '../../context.js';
import { requireAuth, SESSION_COOKIE } from '../../http/auth.js';
import { createAuthService } from './service.js';

export function authRoutes(ctx: AppContext) {
  const service = createAuthService(ctx);
  const router = new Hono<AppEnv>();

  router.post('/login', async (c) => {
    const { sid, expires, user } = await service.login(c.get('body'));
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
    service.logout(getCookie(c, SESSION_COOKIE));
    // Same wire form as Express's clearCookie: an empty value that expired in 1970.
    setCookie(c, SESSION_COOKIE, '', { path: '/', expires: new Date(0) });
    return c.json({ ok: true } satisfies Ok);
  });

  router.get('/me', requireAuth(ctx), (c) => c.json(c.get('user')));

  return router;
}
