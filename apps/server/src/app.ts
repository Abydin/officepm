import { Hono } from 'hono';
import type { AppContext, AppEnv } from './context.js';
import { DEMO_LOGIN_THROTTLE, DEMO_MAX_JSON_BYTES, demoGuard, demoWriteLimit } from './demo.js';
import { HttpError } from './http/errors.js';
import { jsonBody } from './http/body.js';
import { bodyLimit, createBodyLimit } from './http/limits.js';
import { buildCsp, readIndexHtml, securityHeaders } from './http/security-headers.js';
import { LoginThrottle } from './http/throttle.js';
import { attachmentRoutes } from './modules/attachments/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { commentRoutes } from './modules/comments/routes.js';
import { createCommentService } from './modules/comments/service.js';
import { eventRoutes } from './modules/events/routes.js';
import { githubRoutes } from './modules/github/routes.js';
import { handoffRoutes } from './modules/handoffs/routes.js';
import { pipelineRoutes } from './modules/pipeline/routes.js';
import { projectRoutes } from './modules/projects/routes.js';
import { reportRoutes } from './modules/reports/routes.js';
import { retroRoutes } from './modules/retros/routes.js';
import { sprintRoutes } from './modules/sprints/routes.js';
import { createSprintService } from './modules/sprints/service.js';
import { staticRoutes } from './modules/static/routes.js';
import { participantRoutes } from './modules/participants/routes.js';
import { subticketRoutes } from './modules/subtickets/routes.js';
import { ticketRoutes } from './modules/tickets/routes.js';
import { createTicketService } from './modules/tickets/service.js';
import { userRoutes } from './modules/users/routes.js';

/** Builds the whole HTTP app over an already-initialised context. */
export function createApp(ctx: AppContext): Hono<AppEnv> {
  // strict: false, so /api/me/ matches like it did under Express.
  const app = new Hono<AppEnv>({ strict: false });
  const demo = ctx.config.demoMode;
  // The public demo's password is public: failed logins are rarer and a flood of them is an attack.
  if (demo && !ctx.loginThrottle) ctx.loginThrottle = new LoginThrottle(DEMO_LOGIN_THROTTLE);

  // First, so that every response, errors and 413s included, carries the headers.
  app.use('*', securityHeaders(buildCsp(readIndexHtml(ctx.config.webDir))));
  // Express labelled JSON "application/json; charset=utf-8"; keep that header exactly.
  app.use('*', async (c, next) => {
    await next();
    if (c.res.headers.get('content-type') === 'application/json') {
      c.res.headers.set('content-type', 'application/json; charset=utf-8');
    }
  });
  if (demo) {
    // Before the body limit and the JSON parser, so a refused upload is never read.
    app.use('/api/*', demoGuard());
    app.use('/api/*', demoWriteLimit(ctx));
  }
  app.use('*', demo ? createBodyLimit(DEMO_MAX_JSON_BYTES) : bodyLimit);
  app.use('*', jsonBody);
  // Any write may change the dashboard, so it never serves a result older than the last write.
  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') ctx.dashboardCache.clear();
    await next();
  });

  const comments = createCommentService(ctx);
  const sprints = createSprintService(ctx);
  const tickets = createTicketService(ctx);

  const api = new Hono<AppEnv>({ strict: false });
  // Liveness for the container healthcheck and uptime checks: no session needed, and it
  // reads the database so a server that cannot reach pm.db reports itself unhealthy.
  api.get('/health', (c) => {
    ctx.db.raw.prepare('SELECT 1').get();
    return c.json({ ok: true });
  });
  // What the page needs to know before anyone signs in. No session, nothing secret.
  api.get('/config', (c) => c.json({ demo }));
  api.route('/', authRoutes(ctx));
  api.route('/', projectRoutes(ctx));
  api.route('/', ticketRoutes(ctx, tickets));
  api.route('/', pipelineRoutes(ctx));
  api.route('/', participantRoutes(ctx));
  api.route('/', subticketRoutes(ctx, tickets));
  api.route('/', commentRoutes(ctx, comments));
  api.route('/', handoffRoutes(ctx, comments));
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
