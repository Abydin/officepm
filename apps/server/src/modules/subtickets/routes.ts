import { Hono } from 'hono';
import type { AppContext, AppEnv } from '../../context.js';
import { requireAuth } from '../../http/auth.js';
import type { TicketService } from '../tickets/service.js';
import { createSubticketService } from './service.js';

export function subticketRoutes(ctx: AppContext, tickets: TicketService) {
  const service = createSubticketService(ctx, tickets);
  const router = new Hono<AppEnv>();
  const auth = requireAuth(ctx);

  router.post('/tickets/:key/subtickets', auth, (c) =>
    c.json(service.create(c.req.param('key'), c.get('body')), 201),
  );
  router.put('/tickets/:key/subticket-of', auth, (c) =>
    c.json(service.attach(c.req.param('key'), c.get('body'))),
  );

  return router;
}
