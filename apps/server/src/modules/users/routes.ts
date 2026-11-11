import { Hono } from 'hono';
import type { Ok } from '@officepm/shared';
import type { AppContext, AppEnv } from '../../context.js';
import { requireAdmin, requireAuth } from '../../http/auth.js';
import { createUserService } from './service.js';

export function userRoutes(ctx: AppContext) {
  const service = createUserService(ctx);
  const router = new Hono<AppEnv>();
  const admin = [requireAuth(ctx), requireAdmin] as const;

  router.get('/users', ...admin, (c) => c.json(service.list()));

  router.post('/users', ...admin, async (c) => c.json(await service.create(c.get('body')), 201));

  router.patch('/users/:id/password', ...admin, async (c) => {
    await service.setPassword(c.req.param('id'), c.get('body'));
    return c.json({ ok: true } satisfies Ok);
  });

  return router;
}
