import { Hono } from 'hono';
import type { Ok } from '@officepm/shared';
import type { AppContext, AppEnv } from '../../context.js';
import { requireAuth } from '../../http/auth.js';
import type { CommentService } from '../comments/service.js';
import { createHandoffService } from './service.js';

/**
 * Status-change handoffs. Who may use them is who may PATCH a ticket today: any
 * signed-in user (v1 has no per-ticket permissions).
 */
export function handoffRoutes(ctx: AppContext, comments: CommentService) {
  const service = createHandoffService(ctx, comments);
  const router = new Hono<AppEnv>();
  const auth = requireAuth(ctx);

  router.post('/tickets/:key/handoff', auth, (c) =>
    c.json(service.create(c.req.param('key'), c.get('body'), c.get('user'))),
  );
  router.get('/handoffs/unread', auth, (c) => c.json(service.unread(c.get('user'))));
  router.post('/tickets/:key/handoffs/read', auth, (c) => {
    service.markRead(c.req.param('key'), c.get('user'));
    return c.json({ ok: true } satisfies Ok);
  });

  return router;
}
