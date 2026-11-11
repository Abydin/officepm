import { Hono } from 'hono';
import type { AppContext, AppEnv } from '../../context.js';
import { requireAuth } from '../../http/auth.js';

/** GET /api/events: server-sent events (PRD 7.1). */
export function eventRoutes(ctx: AppContext) {
  const router = new Hono<AppEnv>();

  router.get('/events', requireAuth(ctx), () => {
    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('retry: 3000\n\n'));
        unsubscribe = ctx.events.subscribe((chunk) => controller.enqueue(encoder.encode(chunk)));
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
