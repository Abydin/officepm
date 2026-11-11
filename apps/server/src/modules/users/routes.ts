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

  // Name and department only, so the handoff picker works for people who are not admins.
  router.get('/people', requireAuth(ctx), (c) => c.json(service.people()));

  router.post('/users', ...admin, async (c) => c.json(await service.create(c.get('body')), 201));

  router.patch('/users/:id/department', ...admin, (c) =>
    c.json(service.setDepartment(c.req.param('id'), c.get('body'))),
  );

  router.patch('/users/:id/password', ...admin, async (c) => {
    await service.setPassword(c.req.param('id'), c.get('body'));
    return c.json({ ok: true } satisfies Ok);
  });

  return router;
}
