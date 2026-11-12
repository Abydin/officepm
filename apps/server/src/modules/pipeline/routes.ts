import { Hono } from 'hono';
import type { AppContext, AppEnv } from '../../context.js';
import { requireAdmin, requireAuth } from '../../http/auth.js';
import { createPipelineService } from './service.js';

/**
 * Reading a pipeline, and starting an epic on one, is open to any signed-in user (v1 has
 * no per-ticket permissions). Configuring a project's phases is admin only, like the
 * other project settings. Moving an epic along is the handoff route.
 */
export function pipelineRoutes(ctx: AppContext) {
  const service = createPipelineService(ctx);
  const router = new Hono<AppEnv>();
  const auth = requireAuth(ctx);

  router.get('/projects/:slug/pipeline', auth, (c) => {
    const slug = c.req.param('slug');
    if (!ctx.projects.findProject(slug)) return c.json({ error: 'project not found' }, 404);
    return c.json(service.config(slug));
  });
  router.put('/projects/:slug/pipeline', auth, requireAdmin, (c) =>
    c.json(service.put(c.req.param('slug'), c.get('body'))),
  );
  router.get('/tickets/:key/pipeline', auth, (c) => c.json(service.forEpic(c.req.param('key'))));
  router.post('/tickets/:key/pipeline/start', auth, (c) =>
    c.json(service.start(c.req.param('key'))),
  );

  return router;
}
