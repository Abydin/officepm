import { Hono } from 'hono';
import type { Ok } from '@officepm/shared';
import type { AppContext, AppEnv } from '../../context.js';
import { requireAuth } from '../../http/auth.js';
import { createAttachmentService } from './service.js';

/** Project docs and files, ticket links and files. */
export function attachmentRoutes(ctx: AppContext) {
  const service = createAttachmentService(ctx);
  const router = new Hono<AppEnv>();
  const auth = requireAuth(ctx);
  const ok = { ok: true } satisfies Ok;

  router.get('/projects/:slug/docs', auth, (c) => c.json(service.listDocs(c.req.param('slug'))));
  router.post('/projects/:slug/docs', auth, (c) =>
    c.json(service.createDoc(c.req.param('slug'), c.get('body'), c.get('user')), 201),
  );
  router.delete('/projects/:slug/docs/:id', auth, (c) => {
    service.removeDoc(c.req.param('slug'), c.req.param('id'));
    return c.json(ok);
  });

  router.get('/projects/:slug/files', auth, (c) =>
    c.json(service.listProjectFiles(c.req.param('slug'))),
  );
  router.post('/projects/:slug/files', auth, async (c) =>
    c.json(await service.uploadProjectFile(c, c.req.param('slug'), c.get('user')), 201),
  );
  router.get('/projects/:slug/files/:id', auth, (c) =>
    service.downloadProjectFile(c.req.param('slug'), c.req.param('id')),
  );
  router.delete('/projects/:slug/files/:id', auth, (c) => {
    service.removeProjectFile(c.req.param('slug'), c.req.param('id'));
    return c.json(ok);
  });

  router.get('/tickets/:key/links', auth, (c) => c.json(service.listLinks(c.req.param('key'))));
  router.post('/tickets/:key/links', auth, (c) =>
    c.json(service.createLink(c.req.param('key'), c.get('body'), c.get('user')), 201),
  );
  router.delete('/tickets/:key/links/:id', auth, (c) => {
    service.removeLink(c.req.param('key'), c.req.param('id'));
    return c.json(ok);
  });

  router.get('/tickets/:key/files', auth, (c) =>
    c.json(service.listTicketFiles(c.req.param('key'))),
  );
  router.post('/tickets/:key/files', auth, async (c) =>
    c.json(await service.uploadTicketFile(c, c.req.param('key'), c.get('user')), 201),
  );
  router.get('/tickets/:key/files/:id', auth, (c) =>
    service.downloadTicketFile(c.req.param('key'), c.req.param('id')),
  );
  router.delete('/tickets/:key/files/:id', auth, (c) => {
    service.removeTicketFile(c.req.param('key'), c.req.param('id'));
    return c.json(ok);
  });

  return router;
}
