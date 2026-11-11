import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppContext, AppEnv } from '../../context.js';
import { requireAuth, SESSION_COOKIE } from '../../http/auth.js';

/** GET /api/events: server-sent events (PRD 7.1). */
export function eventRoutes(ctx: AppContext) {
  const router = new Hono<AppEnv>();

  router.get('/events', requireAuth(ctx), (c) => {
    const userId = c.get('user').id;
    const sessionId = getCookie(c, SESSION_COOKIE) ?? '';
    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('retry: 3000\n\n'));
        unsubscribe = ctx.events.subscribe((chunk) => controller.enqueue(encoder.encode(chunk)), {
          userId,
          sessionId,
          close: () => controller.close(),
        });
      },
      cancel() {
        unsubscribe();
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    });
  });

  return router;
}
