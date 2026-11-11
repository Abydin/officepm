import { Hono } from 'hono';
import type { Ok } from '@officepm/shared';
import type { AppContext, AppEnv } from '../../context.js';
import { requireAuth } from '../../http/auth.js';
import { createRetroService } from './service.js';

export function retroRoutes(ctx: AppContext) {
  const service = createRetroService(ctx);
  const router = new Hono<AppEnv>();
  const auth = requireAuth(ctx);

  router.get('/projects/:slug/boards/:board/retros', auth, (c) =>
    c.json(service.list(c.req.param('slug'), c.req.param('board'))),
  );
  router.post('/projects/:slug/boards/:board/retros', auth, (c) =>
    c.json(service.create(c.req.param('slug'), c.req.param('board'), c.get('body')), 201),
  );
  router.get('/retros/:id', auth, (c) => c.json(service.get(c.req.param('id'))));
  router.post('/retros/:id/cards', auth, (c) =>
    c.json(service.addCard(c.req.param('id'), c.get('body'), c.get('user')), 201),
  );
  router.patch('/retros/:id/cards/:cardId', auth, (c) =>
    c.json(service.editCard(c.req.param('id'), c.req.param('cardId'), c.get('body'))),
  );
  router.delete('/retros/:id/cards/:cardId', auth, (c) => {
    service.removeCard(c.req.param('id'), c.req.param('cardId'));
    return c.json({ ok: true } satisfies Ok);
  });

  return router;
}
