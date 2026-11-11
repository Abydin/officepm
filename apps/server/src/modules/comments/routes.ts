import { Hono } from 'hono';
import type { AppContext, AppEnv } from '../../context.js';
import { requireAuth } from '../../http/auth.js';
import type { CommentService } from './service.js';

export function commentRoutes(ctx: AppContext, service: CommentService) {
  const router = new Hono<AppEnv>();
  const auth = requireAuth(ctx);

  router.get('/tickets/:key/comments', auth, (c) => c.json(service.list(c.req.param('key'))));
  router.post('/tickets/:key/comments', auth, (c) =>
    c.json(service.create(c.req.param('key'), c.get('body'), c.get('user')), 201),
  );

  return router;
}
