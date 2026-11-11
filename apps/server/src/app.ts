import { Hono } from 'hono';
import type { AppContext, AppEnv } from './context.js';
import { HttpError } from './http/errors.js';
import { jsonBody } from './http/body.js';
import { bodyLimit } from './http/limits.js';
import { buildCsp, readIndexHtml, securityHeaders } from './http/security-headers.js';
import { attachmentRoutes } from './modules/attachments/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { commentRoutes } from './modules/comments/routes.js';
import { createCommentService } from './modules/comments/service.js';
import { eventRoutes } from './modules/events/routes.js';
import { githubRoutes } from './modules/github/routes.js';
import { projectRoutes } from './modules/projects/routes.js';
import { reportRoutes } from './modules/reports/routes.js';
import { retroRoutes } from './modules/retros/routes.js';
import { sprintRoutes } from './modules/sprints/routes.js';
import { createSprintService } from './modules/sprints/service.js';
import { staticRoutes } from './modules/static/routes.js';
import { ticketRoutes } from './modules/tickets/routes.js';
import { userRoutes } from './modules/users/routes.js';

/** Builds the whole HTTP app over an already-initialised context. */
export function createApp(ctx: AppContext): Hono<AppEnv> {
  // strict: false, so /api/me/ matches like it did under Express.
  const app = new Hono<AppEnv>({ strict: false });

  // First, so that every response, errors and 413s included, carries the headers.
  app.use('*', securityHeaders(buildCsp(readIndexHtml(ctx.config.webDir))));
  // Express labelled JSON "application/json; charset=utf-8"; keep that header exactly.
  app.use('*', async (c, next) => {
    await next();
    if (c.res.headers.get('content-type') === 'application/json') {
      c.res.headers.set('content-type', 'application/json; charset=utf-8');
    }
  });
  app.use('*', bodyLimit);
  app.use('*', jsonBody);
  // Any write may change the dashboard, so it never serves a result older than the last write.
  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') ctx.dashboardCache.clear();
    await next();
  });

  const comments = createCommentService(ctx);
  const sprints = createSprintService(ctx);

  const api = new Hono<AppEnv>({ strict: false });
  api.route('/', authRoutes(ctx));
  api.route('/', projectRoutes(ctx));
  api.route('/', ticketRoutes(ctx));
  api.route('/', commentRoutes(ctx, comments));
  api.route('/', sprintRoutes(ctx, sprints));
  api.route('/', retroRoutes(ctx));
  api.route('/', attachmentRoutes(ctx));
  api.route('/', githubRoutes(ctx, comments));
  api.route('/', reportRoutes(ctx, sprints));
  api.route('/', eventRoutes(ctx));
  api.route('/', userRoutes(ctx));
  app.route('/api', api);
  app.route('/', staticRoutes(ctx));

  app.notFound((c) => c.json({ error: 'not found' }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError && err.status !== 500) return c.json(err.toBody(), err.status);
    if (err instanceof HttpError) return c.json(err.toBody(), 500);
    console.error('[OfficePM] unhandled error:', err);
    return c.json({ error: 'internal server error' }, 500);
  });

  return app;
}
