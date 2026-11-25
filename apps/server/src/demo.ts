import net from 'node:net';
import type { MiddlewareHandler } from 'hono';
import { seedBoards } from './bootstrap.js';
import type { AppContext } from './context.js';
import { MIGRATIONS_TABLE, type OpenDatabase } from './db/index.js';
import { LoginThrottle, type ThrottleOptions } from './http/throttle.js';
import { clientIp } from './modules/auth/routes.js';
import { inspectTarget, seedDemo } from './seed/demo.js';

// The hosted public demo (DEMO_MODE=true). Everything here is inert unless the config says
// demo: the guard, limiter and scheduler are only mounted by app.ts and main.ts when it does.

/** The demo workspace is wiped and reseeded every day at this hour, UTC. */
export const DEMO_RESET_HOUR_UTC = 3;

/** JSON bodies in the demo. The stock limit is 2 MB; a demo ticket or comment is far smaller. */
export const DEMO_MAX_JSON_BYTES = 64 * 1024;

/** The demo password is public, so failures are rare and a flood of them is an attack: tighter than stock. */
export const DEMO_LOGIN_THROTTLE: Partial<ThrottleOptions> = {
  perIp: 10,
  perNet: 40,
  perEmail: 5,
  perEmailGlobal: 40,
};

const WRITE_WINDOW_MS = 60_000;
/** Writes (every non-GET request except logins, which have their own buckets) per client address per minute. */
export const DEMO_WRITES_PER_CLIENT = 60;
/** Writes per minute across all clients, so a crowd of addresses cannot starve the 0.1 CPU. */
export const DEMO_WRITES_OVERALL = 120;
/**
 * Logins have buckets of their own, so a few addresses hammering POST /login cannot use up the
 * budget everyone else's writes share. Tighter than writes: a visitor signs in once.
 */
export const DEMO_LOGINS_PER_CLIENT = 10;
export const DEMO_LOGINS_OVERALL = 60;

/** Open event streams, per session and across the whole demo. */
export const DEMO_MAX_STREAMS_PER_SESSION = 5;
export const DEMO_MAX_STREAMS = 200;

/** The database may not grow past this, so a public write endpoint cannot fill the disk. */
export const DEMO_MAX_DB_BYTES = 25 * 1024 * 1024;

/** The only email domain a demo database may hold. Anything else is somebody's real data. */
export const DEMO_EMAIL_SUFFIX = '@officepm.demo';

/**
 * What the demo refuses, by path, for any method that writes. Three kinds:
 * uploads (attachments), account changes (create user, set a password, set a department)
 * and anything that puts an arbitrary URL in front of the next visitor (ticket links,
 * project docs), which a public demo would otherwise relay. The GitHub webhooks go too:
 * they are for CI, not visitors. There is no user delete, role change, webhook token
 * regeneration, email or other outbound code in the server to block.
 */
const BLOCKED: readonly RegExp[] = [
  /^\/api\/(projects|tickets)\/[^/]+\/files(\/|$)/,
  /^\/api\/users\/?$/,
  /^\/api\/users\/[^/]+\/(password|department)\/?$/,
  /^\/api\/github(\/|$)/,
  /^\/api\/tickets\/[^/]+\/links(\/|$)/,
  /^\/api\/projects\/[^/]+\/docs(\/|$)/,
];

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isDemoBlocked(method: string, path: string): boolean {
  return !READ_METHODS.has(method) && BLOCKED.some((re) => re.test(path));
}

/**
 * The ErrorBody contract is exactly `{ error }`, so the code travels as the message prefix
 * and a client can match on `demo_mode`.
 */
export const DEMO_REFUSAL = 'demo_mode: this is turned off in the public demo';

/** Refuses the blocked routes with a 403 before anything reads the request body. */
export function demoGuard(): MiddlewareHandler {
  return async (c, next) => {
    if (isDemoBlocked(c.req.method, c.req.path)) return c.json({ error: DEMO_REFUSAL }, 403);
    await next();
  };
}

/** How many write requests log what the client address resolved to (see logClientResolution). */
const CLIENT_LOG_LIMIT = 5;

/** Loopback, link-local, RFC 1918, CGNAT and unique-local addresses: what a proxy's own address looks like. */
export function looksPrivate(ip: string): boolean {
  const bare = ip.trim().toLowerCase().split('%')[0] as string;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(bare)?.[1];
  const addr = mapped ?? bare;
  if (net.isIPv4(addr)) {
    const [a = 0, b = 0] = addr.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (net.isIPv6(addr)) {
    return addr === '::1' || /^f[cd]/.test(addr) || /^fe[89ab]/.test(addr);
  }
  return false;
}

/**
 * The first few writes log how the client address was resolved, so the first deploy shows whether
 * the platform's X-Forwarded-For arrives as assumed. Counts and a yes/no only: no addresses go
 * into a long-lived log.
 */
function logClientResolution(
  n: number,
  ctx: AppContext,
  c: Parameters<MiddlewareHandler>[0],
): void {
  const header = c.req.header('x-forwarded-for');
  const entries = header ? header.split(',').filter((e) => e.trim() !== '').length : 0;
  const ip = clientIp(c, ctx.config.trustProxy);
  console.log(
    `[OfficePM] demo: write request ${n}/${CLIENT_LOG_LIMIT}: trustProxy=${ctx.config.trustProxy}, ` +
      `x-forwarded-for entries=${entries}, client resolved=${ip === 'unknown' ? 'unknown' : 'address'}, ` +
      `looks private=${looksPrivate(ip)}`,
  );
}

/**
 * Caps writes per client and overall, reusing the login throttle's bounded, windowed counting.
 * POST /login is counted in its own, tighter buckets and not in the write ones.
 */
export function demoWriteLimit(ctx: AppContext): MiddlewareHandler {
  const writes = new LoginThrottle({
    windowMs: WRITE_WINDOW_MS,
    perIp: DEMO_WRITES_PER_CLIENT,
    perNet: DEMO_WRITES_PER_CLIENT * 5,
  });
  const writesAll = new LoginThrottle({ windowMs: WRITE_WINDOW_MS, perIp: DEMO_WRITES_OVERALL });
  const logins = new LoginThrottle({
    windowMs: WRITE_WINDOW_MS,
    perIp: DEMO_LOGINS_PER_CLIENT,
    perNet: DEMO_LOGINS_PER_CLIENT * 5,
  });
  const loginsAll = new LoginThrottle({ windowMs: WRITE_WINDOW_MS, perIp: DEMO_LOGINS_OVERALL });
  let logged = 0;
  return async (c, next) => {
    if (READ_METHODS.has(c.req.method)) return next();
    if (logged < CLIENT_LOG_LIMIT) logClientResolution(++logged, ctx, c);
    const isLogin = c.req.method === 'POST' && /^\/api\/login\/?$/.test(c.req.path);
    const [perClient, overall] = isLogin ? [logins, loginsAll] : [writes, writesAll];
    const mine = perClient.begin(clientIp(c, ctx.config.trustProxy), 'write', false);
    const wait = mine.wait || overall.begin('all', 'write', false).wait;
    if (wait > 0) {
      return c.json({ error: 'too many requests, slow down' }, 429, {
        'Retry-After': String(wait),
      });
    }
    await next();
  };
}

export class DemoGuardError extends Error {}

/**
 * The demo wipes its database every night, so it must never be pointed at one that holds
 * anything but demo data. Refuses (throws DemoGuardError) when any user's email is not
 * @officepm.demo, or when there are tickets and no demo user at all. An empty database
 * passes. Reads only.
 */
export function assertDemoDatabase(db: OpenDatabase): void {
  const one = (sql: string): number => (db.raw.prepare(sql).get() as { n: number }).n;
  const foreign = one(
    `SELECT COUNT(*) AS n FROM users WHERE lower(email) NOT LIKE '%${DEMO_EMAIL_SUFFIX}'`,
  );
  const demoUsers = one(
    `SELECT COUNT(*) AS n FROM users WHERE lower(email) LIKE '%${DEMO_EMAIL_SUFFIX}'`,
  );
  const tickets = one('SELECT COUNT(*) AS n FROM tickets');
  if (foreign > 0 || (tickets > 0 && demoUsers === 0)) {
    throw new DemoGuardError(
      'DEMO_MODE refused: this database holds data that is not demo data ' +
        `(${foreign} user(s) outside ${DEMO_EMAIL_SUFFIX}, ${tickets} ticket(s), ${demoUsers} demo user(s)). ` +
        'The demo wipes its database every night. Point PM_DATA_DIR at an empty directory of its own.',
    );
  }
}

/**
 * Caps the database file for this connection (it is a per-connection setting, so it is applied at
 * every start). A write past the cap fails with SQLITE_FULL instead of growing the disk.
 */
export function limitDemoDatabaseSize(db: OpenDatabase, maxBytes = DEMO_MAX_DB_BYTES): number {
  const pageSize = db.raw.pragma('page_size', { simple: true }) as number;
  const current = db.raw.pragma('page_count', { simple: true }) as number;
  const pages = Math.max(Math.floor(maxBytes / pageSize), current);
  db.raw.pragma(`max_page_count = ${pages}`);
  return pages;
}

/**
 * Boot: seeds the demo workspace when the database has no tickets and no users, which
 * is every cold start on a platform with an ephemeral disk. Returns true when it seeded.
 * A database that already has data is left alone until the nightly reset, but one that holds
 * anything other than demo data is refused (assertDemoDatabase).
 */
export function ensureDemoWorkspace(ctx: AppContext): boolean {
  assertDemoDatabase(ctx.db);
  const { tickets, users } = inspectTarget(ctx.db);
  if (tickets > 0 || users > 0) return false;
  const summary = seedDemo(ctx.db, ctx.projects);
  console.log(
    `[OfficePM] demo: seeded ${summary.tickets} tickets, ${summary.users} users. Demo login: ${summary.login.email} / ${summary.login.password}`,
  );
  return true;
}

/**
 * Wipes every application table and seeds the demo workspace again, on the open connection.
 * In place rather than exit-and-restart: services hold the database handle they were built
 * with, so a new handle would not reach them, and an exit relies on the platform restarting
 * a clean exit with a clean disk. The wipe and the reseed are ONE transaction, so a reseed that
 * fails rolls the wipe back and yesterday's data stays. It checks assertDemoDatabase first, and
 * throws without deleting anything when the database is not demo data.
 */
export function resetDemoWorkspace(ctx: AppContext): void {
  const { raw } = ctx.db;
  raw.transaction(() => {
    assertDemoDatabase(ctx.db);
    const tables = (
      raw
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> ?`,
        )
        .all(MIGRATIONS_TABLE) as { name: string }[]
    ).map((t) => t.name);
    // Rows reference each other; the order of the deletes should not matter.
    raw.pragma('defer_foreign_keys = ON');
    for (const name of tables) raw.exec(`DELETE FROM "${name}"`);
    const hasSequence = raw
      .prepare(`SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'`)
      .get();
    if (hasSequence) raw.exec('DELETE FROM sqlite_sequence');
    // Nested transactions here become savepoints of this one.
    seedBoards(ctx);
    seedDemo(ctx.db, ctx.projects);
  })();
  ctx.dashboardCache.clear();
  // Every session is gone, so every open event stream belongs to nobody.
  ctx.events.closeAll();
  try {
    // Outside the transaction, where they are allowed: give the freed pages back to the disk.
    raw.pragma('wal_checkpoint(TRUNCATE)');
    raw.exec('VACUUM');
  } catch (e) {
    console.error('[OfficePM] demo: reset done, but compacting the database failed:', e);
  }
  console.log('[OfficePM] demo: workspace reset and reseeded');
}

/** The next DEMO_RESET_HOUR_UTC o'clock strictly after `now`. */
export function nextResetAt(now: Date): Date {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DEMO_RESET_HOUR_UTC),
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** Resets the workspace every night. Returns a function that stops the schedule. */
export function startDemoReset(ctx: AppContext): () => void {
  let timer: NodeJS.Timeout | undefined;
  const arm = (from: number) => {
    const delay = nextResetAt(new Date(from)).getTime() - Date.now();
    timer = setTimeout(
      () => {
        try {
          resetDemoWorkspace(ctx);
        } catch (e) {
          console.error('[OfficePM] demo reset failed:', e);
        }
        // A timer can fire a few ms early; a minute on keeps it from resetting twice.
        arm(Date.now() + 60_000);
      },
      Math.max(delay, 0),
    );
    timer.unref();
  };
  arm(Date.now());
  return () => clearTimeout(timer);
}
