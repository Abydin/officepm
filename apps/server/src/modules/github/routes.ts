import { Hono } from 'hono';
import type { AppContext, AppEnv } from '../../context.js';
import { requireAuth, requireGithubToken } from '../../http/auth.js';
import type { CommentService } from '../comments/service.js';
import { createGithubService } from './service.js';

export function githubRoutes(ctx: AppContext, comments: CommentService) {
  const service = createGithubService(ctx, comments);
  const router = new Hono<AppEnv>();
  const hook = requireGithubToken(ctx);

  // Read side for the ticket drawer's GitHub panel (session auth).
  router.get('/tickets/:key/github', requireAuth(ctx), (c) =>
    c.json(service.links(c.req.param('key'))),
  );

  // Write side for CI (shared secret, no session).
  router.post('/github/pr-opened', hook, (c) => c.json(service.prOpened(c.get('body'))));
  router.post('/github/deploy', hook, (c) => c.json(service.deploy(c.get('body'))));
  router.post('/github/release', hook, (c) => c.json(service.release(c.get('body'))));

  return router;
}
