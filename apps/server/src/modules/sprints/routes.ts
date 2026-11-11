import { Hono } from 'hono';
import type { Ok } from '@officepm/shared';
import type { AppContext, AppEnv } from '../../context.js';
import { requireAuth } from '../../http/auth.js';
import type { SprintService } from './service.js';

export function sprintRoutes(ctx: AppContext, service: SprintService) {
  const router = new Hono<AppEnv>();
  const auth = requireAuth(ctx);

  router.get('/projects/:slug/boards/:board/sprints', auth, (c) =>
    c.json(service.list(c.req.param('slug'), c.req.param('board'))),
  );
  router.post('/projects/:slug/boards/:board/sprints', auth, (c) =>
    c.json(service.create(c.req.param('slug'), c.req.param('board'), c.get('body')), 201),
  );
  router.patch('/sprints/:id', auth, (c) =>
    c.json(service.patch(c.req.param('id'), c.get('body'))),
  );
  router.delete('/sprints/:id', auth, (c) => {
    service.remove(c.req.param('id'));
    return c.json({ ok: true } satisfies Ok);
  });
  router.get('/sprints/:id/burndown', auth, (c) => c.json(service.burndown(c.req.param('id'))));
  router.get('/projects/:slug/boards/:board/velocity', auth, (c) =>
    c.json(service.velocity(c.req.param('slug'), c.req.param('board'))),
  );

  return router;
}
