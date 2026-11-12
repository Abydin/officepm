import { Hono } from 'hono';
import type { Ok } from '@officepm/shared';
import type { AppContext, AppEnv } from '../../context.js';
import { requireAuth } from '../../http/auth.js';
import { createParticipantService } from './service.js';

export function participantRoutes(ctx: AppContext) {
  const service = createParticipantService(ctx);
  const router = new Hono<AppEnv>();
  const auth = requireAuth(ctx);

  router.get('/tickets/:key/participants', auth, (c) => c.json(service.list(c.req.param('key'))));
  router.post('/tickets/:key/participants', auth, (c) => {
    const { person, created } = service.add(c.req.param('key'), c.get('body'), c.get('user'));
    return c.json(person, created ? 201 : 200);
  });
  router.delete('/tickets/:key/participants/:userId', auth, (c) => {
    service.remove(c.req.param('key'), c.req.param('userId'));
    return c.json({ ok: true } satisfies Ok);
  });
  router.get('/my-tickets/participating', auth, (c) =>
    c.json(service.participating(c.get('user'))),
  );

  return router;
}
