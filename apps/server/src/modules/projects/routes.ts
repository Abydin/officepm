import { Hono } from 'hono';
import type { Ok } from '@officepm/shared';
import type { AppContext, AppEnv } from '../../context.js';
import { requireAdmin, requireAuth } from '../../http/auth.js';
import { createProjectService } from './service.js';

export function projectRoutes(ctx: AppContext) {
  const service = createProjectService(ctx);
  const router = new Hono<AppEnv>();
  const auth = requireAuth(ctx);

  router.get('/projects', auth, (c) => c.json(service.list()));
  router.get('/projects/:slug', auth, (c) => c.json(service.get(c.req.param('slug'))));
  router.get('/projects/:slug/boards/:board', auth, (c) =>
    c.json(service.getBoard(c.req.param('slug'), c.req.param('board'))),
  );
  router.get('/projects/:slug/boards/:board/settings', auth, (c) =>
    c.json(service.getSettings(c.req.param('slug'), c.req.param('board'))),
  );
  router.patch('/projects/:slug/boards/:board/settings', auth, requireAdmin, (c) => {
    service.patchSettings(c.req.param('slug'), c.req.param('board'), c.get('body'));
    return c.json({ ok: true } satisfies Ok);
  });
  // The whole parsed projects.json, defaults filled in, for the admin screen.
  router.get('/admin/projects', auth, requireAdmin, (c) => c.json(ctx.projects.config));

  return router;
}
