import { Hono, type Context } from 'hono';
import type { Ok } from '@officepm/shared';
import type { AppContext, AppEnv } from '../../context.js';
import { requireAdmin, requireAuth } from '../../http/auth.js';
import { clientIp, setSessionCookie } from '../auth/routes.js';
import { TooManyAttempts } from '../auth/service.js';
import { createInviteService } from './service.js';

/** A host as it may appear in a Host or X-Forwarded-Host header: names, dots, an optional port. */
const HOST = /^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/;

/**
 * The origin invite links are built on. PM_PUBLIC_URL wins. Otherwise it is the request's own
 * origin, and X-Forwarded-Proto and X-Forwarded-Host count only behind a trusted proxy
 * (PM_TRUST_PROXY), the way the client address does: the last entry is the one our proxy added.
 */
export function publicOrigin(c: Context, ctx: AppContext): string {
  if (ctx.config.publicUrl) return ctx.config.publicUrl;
  const url = new URL(c.req.url);
  let proto = url.protocol.replace(':', '');
  let host = url.host;
  if (ctx.config.trustProxy) {
    const last = (name: string) => c.req.header(name)?.split(',').pop()?.trim();
    const fProto = last('x-forwarded-proto');
    const fHost = last('x-forwarded-host');
    if (fProto === 'http' || fProto === 'https') proto = fProto;
    if (fHost && HOST.test(fHost)) host = fHost;
  }
  return `${proto}://${host}`;
}

/** Invite links and the CSV import. The accept routes are public: the token is the credential. */
export function inviteRoutes(ctx: AppContext) {
  const service = createInviteService(ctx);
  const router = new Hono<AppEnv>();
  const admin = [requireAuth(ctx), requireAdmin] as const;
  // A response that holds a token or a link is never cached.
  const noStore = (c: Context) => c.header('Cache-Control', 'no-store');

  router.get('/invites', ...admin, (c) => c.json(service.list()));

  router.post('/invites', ...admin, (c) => {
    noStore(c);
    return c.json(service.create(c.get('body'), c.get('user'), publicOrigin(c, ctx)), 201);
  });

  router.post('/invites/import', ...admin, (c) => {
    noStore(c);
    return c.json(service.importStaff(c.get('body'), c.get('user'), publicOrigin(c, ctx)));
  });

  router.delete('/invites/:id', ...admin, (c) => {
    service.revoke(c.req.param('id'));
    return c.json({ ok: true } satisfies Ok);
  });

  const throttled = <T>(c: Context, run: () => T): T => {
    try {
      return run();
    } catch (e) {
      if (e instanceof TooManyAttempts) c.header('Retry-After', String(e.retryAfter));
      throw e;
    }
  };

  router.get('/invites/:token', (c) => {
    noStore(c);
    const ip = clientIp(c, ctx.config.trustProxy);
    return c.json(throttled(c, () => service.preview(c.req.param('token'), ip)));
  });

  router.post('/invites/:token/accept', async (c) => {
    noStore(c);
    const ip = clientIp(c, ctx.config.trustProxy);
    let result;
    try {
      result = await service.accept(c.req.param('token'), c.get('body'), ip);
    } catch (e) {
      if (e instanceof TooManyAttempts) c.header('Retry-After', String(e.retryAfter));
      throw e;
    }
    setSessionCookie(c, result.sid, result.expires);
    return c.json(result.user, 201);
  });

  return router;
}
