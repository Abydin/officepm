import { Hono } from 'hono';
import type { AppContext, AppEnv } from '../../context.js';
import { requireAuth } from '../../http/auth.js';
import type { SprintService } from '../sprints/service.js';
import { createReportService } from './service.js';

/** Overview, dashboard and My Tickets: read-only views over the other tables. */
export function reportRoutes(ctx: AppContext, sprints: SprintService) {
  const service = createReportService(ctx, sprints);
  const router = new Hono<AppEnv>();
  const auth = requireAuth(ctx);

  router.get('/overview', auth, (c) => c.json(service.overview()));
  router.get('/dashboard', auth, (c) => c.json(service.dashboard(c.get('user'))));
  router.get('/my-tickets', auth, (c) => c.json(service.myTickets(c.get('user'))));

  return router;
}
