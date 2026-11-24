import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppContext, AppEnv } from '../../context.js';
import { DEMO_MAX_STREAMS, DEMO_MAX_STREAMS_PER_SESSION } from '../../demo.js';
import { requireAuth, SESSION_COOKIE } from '../../http/auth.js';

/** GET /api/events: server-sent events (PRD 7.1). */
export function eventRoutes(ctx: AppContext) {
  const router = new Hono<AppEnv>();

  router.get('/events', requireAuth(ctx), (c) => {
    const userId = c.get('user').id;
    const sessionId = getCookie(c, SESSION_COOKIE) ?? '';
    // The public demo holds a bounded number of open streams; an unbounded one is a cheap way to exhaust it.
    if (ctx.config.demoMode) {
      if (ctx.events.size >= DEMO_MAX_STREAMS) {
        return c.json({ error: 'too many open event streams, try again later' }, 503, {
          'Retry-After': '30',
        });
      }
      if (ctx.events.countForSession(sessionId) >= DEMO_MAX_STREAMS_PER_SESSION) {
        return c.json({ error: 'too many open event streams for this session' }, 429, {
          'Retry-After': '30',
        });
      }
    }
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
