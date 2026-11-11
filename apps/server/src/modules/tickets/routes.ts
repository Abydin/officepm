import { Hono } from 'hono';
import type { Ok } from '@officepm/shared';
import type { AppContext, AppEnv } from '../../context.js';
import { requireAuth } from '../../http/auth.js';
import { createTicketService } from './service.js';

export function ticketRoutes(ctx: AppContext) {
  const service = createTicketService(ctx);
  const router = new Hono<AppEnv>();
  const auth = requireAuth(ctx);

  router.get('/tickets', auth, (c) => c.json(service.list(c.req.query(), c.get('user'))));
  router.post('/tickets', auth, (c) => c.json(service.create(c.get('body')), 201));
  router.get('/tickets/:key', auth, (c) => c.json(service.get(c.req.param('key'))));
  router.patch('/tickets/:key', auth, (c) =>
    c.json(service.patch(c.req.param('key'), c.get('body'))),
  );
  router.delete('/tickets/:key', auth, (c) => {
    service.remove(c.req.param('key'));
    return c.json({ ok: true } satisfies Ok);
  });

  // Not in PRD section 9's list, but 8.4 and 6.9 need them: the DoD checklist.
  router.get('/tickets/:key/dod', auth, (c) => c.json(service.dod(c.req.param('key'))));
  router.patch('/tickets/:key/dod', auth, (c) => {
    service.setDod(c.req.param('key'), c.get('body'));
    return c.json({ ok: true } satisfies Ok);
  });

  return router;
}
